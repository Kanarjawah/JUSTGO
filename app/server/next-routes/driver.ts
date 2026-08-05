import { z } from 'zod';
import { prisma } from '@/server/db';
import { error, json, readJson } from '@/server/http';
import { withUser } from '@/server/route-handler';
import { writeAudit } from '@/server/lib/audit';
import { canTransition, type FulfillmentStageName } from '@/server/lib/status';
import { driverEarningsBreakdown, PLATFORM_FEE_CENTS } from '@/server/lib/money';
import { sendServiceStatusSms, sendTransactionStatusSms } from '@/server/lib/sms-notifications';

const driver = (userId: string) => prisma.driverProfile.findUnique({ where: { userId }, include: { availability: true } });

function notifyCustomerStatus(phone: string | undefined, requestNumber: string, stage: string) {
  if (!phone) return;
  void sendServiceStatusSms(phone, { status: stage.replaceAll('_', ' ') }).catch(() => undefined);
  void sendTransactionStatusSms(phone, { requestNumber, status: stage.replaceAll('_', ' ') }).catch(() => undefined);
}

export async function getDashboard() {
  return withUser('DRIVER', async (user) => {
    const profile = await driver(user.id);
    if (!profile) return error('Driver profile not found', 404);
    const tips = await prisma.tip.aggregate({ where: { driverId: profile.id }, _sum: { amountCents: true } });
    return json({ menu: ['Dashboard','Availability','Current Requests','Earnings','Reviews','Profile','Support'], availability: profile.availability?.status ?? 'OFF', applicationStatus: profile.applicationStatus, tipTotalCents: tips._sum.amountCents ?? 0 });
  });
}

export async function getAvailability() {
  return withUser('DRIVER', async (user) => {
    const profile = await driver(user.id);
    return profile ? json({ status: profile.availability?.status ?? 'OFF' }) : error('Driver profile not found', 404);
  });
}

export async function setAvailability(request: Request) {
  return withUser('DRIVER', async (user) => {
    const body = z.object({ status: z.enum(['ONLINE','OFF']) }).parse(await readJson(request));
    const profile = await driver(user.id);
    if (!profile) return error('Driver profile not found', 404);
    const active = await prisma.driverAssignment.findFirst({ where: { driverId: profile.id, active: true }, include: { rideRequest: true, deliveryRequest: true } });
    const incomplete = active && ((active.rideRequest && active.rideRequest.fulfillmentStage !== 'DELIVERED') || (active.deliveryRequest && active.deliveryRequest.fulfillmentStage !== 'DELIVERED'));
    const availability = await prisma.driverAvailability.upsert({ where: { driverId: profile.id }, create: { driverId: profile.id, status: body.status }, update: { status: body.status } });
    await writeAudit({ actorId: user.id, action: 'DRIVER_AVAILABILITY', entityType: 'DriverAvailability', entityId: availability.id, metadata: { status: body.status } });
    return json({ status: availability.status, message: body.status === 'OFF' ? 'You are offline. New requests are paused.' : 'You are online and available for new assignments.', warning: body.status === 'OFF' && incomplete ? 'You have an active request. Going offline will pause new requests, but you must complete the active request.' : undefined });
  });
}

type CardRow = {
  id: string; requestNumber: string; serviceType: string; pickup: string; destination: string;
  distanceKm: number | null; durationMin: number | null; paymentStatus: string; instructions: string | null;
  fulfillmentStage: string | null; adminStatus: string; customer: { user: { firstName: string } };
  estimatedEarnCents?: number; estimatedFareCents?: number;
};
const card = (r: CardRow) => ({ id: r.id, requestNumber: r.requestNumber, requestType: r.serviceType, customerDisplayName: r.customer.user.firstName, pickup: r.pickup, destination: r.destination, distance: r.distanceKm == null ? null : `${r.distanceKm} km`, estimatedDuration: r.durationMin == null ? null : `${r.durationMin} min`, estimatedDriverEarningsCents: r.estimatedEarnCents ?? r.estimatedFareCents ?? 0, paymentStatus: r.paymentStatus, customerInstructions: r.instructions, currentStatus: r.fulfillmentStage, adminStatus: r.adminStatus });

export async function getRequests() {
  return withUser('DRIVER', async (user) => {
    const profile = await driver(user.id);
    if (!profile) return error('Driver profile not found', 404);
    const assignments = await prisma.driverAssignment.findMany({ where: { driverId: profile.id }, include: { rideRequest: { include: { customer: { include: { user: true } } } }, deliveryRequest: { include: { customer: { include: { user: true } } } } }, orderBy: { createdAt: 'desc' } });
    const requests = assignments.map(a => a.rideRequest ? { ...card(a.rideRequest), assignmentId: a.id, active: a.active } : a.deliveryRequest ? { ...card(a.deliveryRequest), assignmentId: a.id, active: a.active } : null).filter(Boolean);
    let offers: ReturnType<typeof card>[] = [];
    if (profile.availability?.status === 'ONLINE') {
      const [rides, deliveries] = await Promise.all([
        prisma.rideRequest.findMany({ where: { adminStatus: 'ACCEPTED', assignment: null, fulfillmentStage: null }, include: { customer: { include: { user: true } } }, take: 20 }),
        prisma.deliveryRequest.findMany({ where: { adminStatus: 'ACCEPTED', assignment: null, fulfillmentStage: null }, include: { customer: { include: { user: true } } }, take: 20 }),
      ]);
      offers = [...rides.map(card), ...deliveries.map(card)];
    }
    return json({ categories: ['TRANSPORTATION','RIDE','FOOD_DELIVERY','STORE_DELIVERY','PACKAGE_DELIVERY','GROCERY_DELIVERY','PHARMACY_DELIVERY','COURIER_SERVICE'], requests, offers });
  });
}

export async function setStage(request: Request, kind: string, id: string) {
  return withUser('DRIVER', async (user) => {
    const stage = z.enum(['ARRIVED','PICKUP','IN_TRANSIT','DELIVERED']).parse((await readJson<{ stage: unknown }>(request)).stage) as FulfillmentStageName;
    const profile = await driver(user.id);
    if (!profile) return error('Driver profile not found', 404);
    if (kind !== 'ride' && kind !== 'delivery') return error('Invalid request kind');
    if (kind === 'ride') {
      const row = await prisma.rideRequest.findUnique({
        where: { id },
        include: { assignment: true, tips: true, customer: { include: { user: true } } },
      });
      if (!row || row.assignment?.driverId !== profile.id) return error('Forbidden', 403);
      const check = canTransition(row.fulfillmentStage as FulfillmentStageName | null, stage);
      if (!check.ok) return error(check.error);
      await prisma.$transaction(async tx => {
        await tx.rideRequest.update({ where: { id }, data: { fulfillmentStage: stage } });
        await tx.requestStatusHistory.create({ data: { rideRequestId: id, previousStage: row.fulfillmentStage, newStage: stage, changedById: user.id } });
        if (stage === 'DELIVERED') {
          await tx.fee.createMany({ data: [{ type: 'CUSTOMER_PLATFORM', amountCents: PLATFORM_FEE_CENTS, rideRequestId: id, appliedAtComplete: true }, { type: 'DRIVER_PLATFORM', amountCents: PLATFORM_FEE_CENTS, rideRequestId: id, appliedAtComplete: true }] });
          if (row.assignment) await tx.driverAssignment.update({ where: { id: row.assignment.id }, data: { active: false } });
        }
      });
      notifyCustomerStatus(row.customer.user.phone, row.requestNumber, stage);
      return json({ stage, earnings: driverEarningsBreakdown(row.estimatedFareCents, row.tips.reduce((s,t)=>s+t.amountCents,0), stage === 'DELIVERED') });
    }
    const row = await prisma.deliveryRequest.findUnique({
      where: { id },
      include: { assignment: true, tips: true, customer: { include: { user: true } } },
    });
    if (!row || row.assignment?.driverId !== profile.id) return error('Forbidden', 403);
    const check = canTransition(row.fulfillmentStage as FulfillmentStageName | null, stage);
    if (!check.ok) return error(check.error);
    await prisma.$transaction(async tx => {
      await tx.deliveryRequest.update({ where: { id }, data: { fulfillmentStage: stage } });
      await tx.requestStatusHistory.create({ data: { deliveryRequestId: id, previousStage: row.fulfillmentStage, newStage: stage, changedById: user.id } });
      if (stage === 'DELIVERED') {
        await tx.fee.createMany({ data: [{ type: 'CUSTOMER_PLATFORM', amountCents: PLATFORM_FEE_CENTS, deliveryRequestId: id, appliedAtComplete: true }, { type: 'DRIVER_PLATFORM', amountCents: PLATFORM_FEE_CENTS, deliveryRequestId: id, appliedAtComplete: true }] });
        if (row.assignment) await tx.driverAssignment.update({ where: { id: row.assignment.id }, data: { active: false } });
      }
    });
    notifyCustomerStatus(row.customer.user.phone, row.requestNumber, stage);
    return json({ stage, earnings: driverEarningsBreakdown(row.estimatedEarnCents, row.tips.reduce((s,t)=>s+t.amountCents,0), stage === 'DELIVERED') });
  });
}

export async function getEarnings() {
  return withUser('DRIVER', async (user) => {
    const profile = await driver(user.id);
    if (!profile) return error('Driver profile not found', 404);
    const [tips, fees] = await Promise.all([prisma.tip.findMany({ where: { driverId: profile.id } }), prisma.fee.aggregate({ where: { type: 'DRIVER_PLATFORM', appliedAtComplete: true }, _sum: { amountCents: true } })]);
    return json({ tipTotalCents: tips.reduce((s,t)=>s+t.amountCents,0), driverPlatformFeesCents: fees._sum.amountCents ?? 0, note: 'Tips belong entirely to the driver and are not platform revenue.' });
  });
}

export async function getReviews() {
  return withUser('DRIVER', async (user) => {
    const profile = await driver(user.id);
    if (!profile) return error('Driver profile not found', 404);
    return json({ reviews: await prisma.review.findMany({ where: { driverId: profile.id, hidden: false }, orderBy: { createdAt: 'desc' } }) });
  });
}
