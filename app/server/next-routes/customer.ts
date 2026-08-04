import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { error, json, readJson } from '@/server/http';
import { withUser } from '@/server/route-handler';
import { normalizePhone } from '@/server/lib/phone';
import { encryptText } from '@/server/lib/crypto';
import { customerPriceBreakdown, toCents } from '@/server/lib/money';
import { writeAudit } from '@/server/lib/audit';

const services = ['Ride', 'Transportation', 'Food Delivery', 'Store Delivery', 'Grocery Delivery', 'Pharmacy Delivery', 'Package Delivery', 'Courier Service'];
const number = (prefix: string) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
const customer = (userId: string) => prisma.customerProfile.findUnique({ where: { userId } });

export async function getServices() {
  return withUser('CUSTOMER', async () => json({ services }));
}

export async function createRide(request: Request) {
  return withUser('CUSTOMER', async (user) => {
    const body = z.object({
      pickup: z.string().min(2), destination: z.string().min(2), pickupDate: z.string().min(4),
      pickupTime: z.string().min(2), riderCount: z.number().int().min(1).max(6),
      customerPhone: z.string().min(7), emergencyContactName: z.string().min(2),
      emergencyContactPhone: z.string().min(7), accessibilityNeeds: z.string().optional(),
      tripNote: z.string().optional(), estimatedFareLd: z.union([z.number(), z.string()]),
      paymentMethod: z.enum(['MTN_MOMO', 'ORANGE_MONEY']), tipLd: z.union([z.number(), z.string()]).optional(),
      safetyConsent: z.literal(true),
    }).parse(await readJson(request));
    const profile = await customer(user.id);
    if (!profile) return error('Customer profile not found', 404);
    const fareCents = toCents(body.estimatedFareLd);
    const tipCents = body.tipLd == null ? 0 : toCents(body.tipLd);
    const taxCents = Math.round(fareCents * 0.05);
    const breakdown = customerPriceBreakdown({ subtotalCents: fareCents, deliveryOrRideCents: 0, taxCents, tipCents });
    const ride = await prisma.rideRequest.create({ data: {
      requestNumber: number('RIDE'), customerId: profile.id, serviceType: 'RIDE', pickup: body.pickup,
      destination: body.destination, pickupDate: body.pickupDate, pickupTime: body.pickupTime,
      riderCount: body.riderCount, customerPhone: normalizePhone(body.customerPhone),
      accessibilityNeeds: body.accessibilityNeeds, tripNote: body.tripNote, estimatedFareCents: fareCents,
      paymentMethod: body.paymentMethod, safetyConsent: true, adminStatus: 'PENDING', paymentStatus: 'PENDING',
      distanceKm: 5.2, durationMin: 18,
      emergencyContacts: { create: { customerId: profile.id, nameEncrypted: encryptText(body.emergencyContactName), phoneEncrypted: encryptText(normalizePhone(body.emergencyContactPhone)) } },
      payment: { create: { method: body.paymentMethod, status: 'PENDING', amountCents: breakdown.totalCents } },
      taxes: { create: { amountCents: taxCents } },
    } });
    await writeAudit({ actorId: user.id, action: 'CREATE_RIDE', entityType: 'RideRequest', entityId: ride.id });
    return json({ requestNumber: ride.requestNumber, id: ride.id, priceBreakdown: breakdown, note: 'Payment integrations (MTN MoMo / Orange Money) are not operational in this environment.' }, 201);
  });
}

export async function createDelivery(request: Request) {
  return withUser('CUSTOMER', async (user) => {
    const body = z.object({
      serviceType: z.enum(['TRANSPORTATION', 'FOOD_DELIVERY', 'STORE_DELIVERY', 'GROCERY_DELIVERY', 'PHARMACY_DELIVERY', 'PACKAGE_DELIVERY', 'COURIER_SERVICE']),
      pickup: z.string().min(2), destination: z.string().min(2), instructions: z.string().optional(),
      subtotalLd: z.union([z.number(), z.string()]), deliveryChargeLd: z.union([z.number(), z.string()]),
      tipLd: z.union([z.number(), z.string()]).optional(), paymentMethod: z.enum(['MTN_MOMO', 'ORANGE_MONEY']),
    }).parse(await readJson(request));
    const profile = await customer(user.id);
    if (!profile) return error('Customer profile not found', 404);
    const subtotalCents = toCents(body.subtotalLd), deliveryCents = toCents(body.deliveryChargeLd);
    const tipCents = body.tipLd == null ? 0 : toCents(body.tipLd), taxCents = Math.round(subtotalCents * 0.05);
    const breakdown = customerPriceBreakdown({ subtotalCents, deliveryOrRideCents: deliveryCents, taxCents, tipCents });
    const delivery = await prisma.deliveryRequest.create({ data: {
      requestNumber: number('DEL'), customerId: profile.id, serviceType: body.serviceType, pickup: body.pickup,
      destination: body.destination, instructions: body.instructions, estimatedEarnCents: deliveryCents,
      paymentStatus: 'PENDING', adminStatus: 'PENDING', distanceKm: 4.1, durationMin: 25,
      payment: { create: { method: body.paymentMethod, status: 'PENDING', amountCents: breakdown.totalCents } },
      taxes: { create: { amountCents: taxCents } },
      fees: { create: { type: 'DELIVERY', amountCents: deliveryCents, appliedAtComplete: false } },
    } });
    return json({ id: delivery.id, requestNumber: delivery.requestNumber, priceBreakdown: breakdown }, 201);
  });
}

export async function getRequests() {
  return withUser('CUSTOMER', async (user) => {
    const profile = await customer(user.id);
    if (!profile) return error('Customer profile not found', 404);
    const [rides, deliveries] = await Promise.all([
      prisma.rideRequest.findMany({ where: { customerId: profile.id }, include: { assignment: { include: { driver: { include: { user: true } } } }, payment: true, fees: true, taxes: true, tips: true, statusHistory: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' } }),
      prisma.deliveryRequest.findMany({ where: { customerId: profile.id }, include: { assignment: { include: { driver: { include: { user: true } } } }, order: { include: { store: { include: { merchant: true } } } }, payment: true, fees: true, taxes: true, tips: true, statusHistory: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const mappedRides = rides.map((r) => ({
      requestNumber: r.requestNumber, serviceType: r.serviceType,
      driverStatus: r.assignment?.driver.user.firstName ? `${r.assignment.driver.user.firstName} · ${r.fulfillmentStage ?? 'Assigned'}` : 'Unassigned',
      merchantStatus: null, pickup: r.pickup, destination: r.destination,
      priceBreakdown: customerPriceBreakdown({ subtotalCents: r.estimatedFareCents, deliveryOrRideCents: 0, taxCents: r.taxes.reduce((s,t)=>s+t.amountCents,0), tipCents: r.tips.reduce((s,t)=>s+t.amountCents,0) }),
      customerPlatformFeeAppliedCents: r.fees.filter(f=>f.type==='CUSTOMER_PLATFORM'&&f.appliedAtComplete).reduce((s,f)=>s+f.amountCents,0),
      paymentStatus: r.paymentStatus, currentStage: r.fulfillmentStage, estimatedCompletion: r.durationMin == null ? null : `${r.durationMin} min`,
      canReview: r.fulfillmentStage === 'DELIVERED', history: r.statusHistory, id: r.id, kind: 'ride' as const,
    }));
    const mappedDeliveries = deliveries.map((d) => ({
      requestNumber: d.requestNumber, serviceType: d.serviceType,
      driverStatus: d.assignment?.driver.user.firstName ? `${d.assignment.driver.user.firstName} · ${d.fulfillmentStage ?? 'Assigned'}` : 'Unassigned',
      merchantStatus: d.merchantPrepStatus, pickup: d.pickup, destination: d.destination,
      priceBreakdown: customerPriceBreakdown({ subtotalCents: d.order?.subtotalCents ?? 0, deliveryOrRideCents: d.fees.filter(f=>f.type==='DELIVERY').reduce((s,f)=>s+f.amountCents,0), taxCents: d.taxes.reduce((s,t)=>s+t.amountCents,0), tipCents: d.tips.reduce((s,t)=>s+t.amountCents,0) }),
      paymentStatus: d.paymentStatus, currentStage: d.fulfillmentStage, estimatedCompletion: d.durationMin == null ? null : `${d.durationMin} min`,
      canReview: d.fulfillmentStage === 'DELIVERED', history: d.statusHistory, id: d.id, kind: 'delivery' as const,
    }));
    return json({ requests: [...mappedRides, ...mappedDeliveries] });
  });
}

export async function createReview(request: Request) {
  return withUser('CUSTOMER', async (user) => {
    const body = z.object({ kind: z.enum(['ride','delivery']), requestId: z.string(), rating: z.number().int().min(1).max(5), comment: z.string().optional(), target: z.enum(['driver','merchant','overall']) }).parse(await readJson(request));
    if (body.kind === 'ride') {
      const ride = await prisma.rideRequest.findUnique({ where: { id: body.requestId }, include: { assignment: true, customer: true } });
      if (!ride || ride.customer.userId !== user.id) return error('Forbidden', 403);
      if (ride.fulfillmentStage !== 'DELIVERED') return error('Reviews are allowed only after delivery is complete');
      const review = await prisma.review.create({ data: { rating: body.rating, comment: body.comment, reviewerId: user.id, rideRequestId: ride.id, driverId: body.target === 'driver' ? ride.assignment?.driverId : undefined, overall: body.target === 'overall' } });
      return json({ review }, 201);
    }
    const delivery = await prisma.deliveryRequest.findUnique({ where: { id: body.requestId }, include: { assignment: true, customer: true, order: { include: { store: true } } } });
    if (!delivery || delivery.customer.userId !== user.id) return error('Forbidden', 403);
    if (delivery.fulfillmentStage !== 'DELIVERED') return error('Reviews are allowed only after delivery is complete');
    const review = await prisma.review.create({ data: { rating: body.rating, comment: body.comment, reviewerId: user.id, deliveryRequestId: delivery.id, driverId: body.target === 'driver' ? delivery.assignment?.driverId : undefined, merchantId: body.target === 'merchant' ? delivery.order?.store?.merchantId : undefined, overall: body.target === 'overall' } });
    return json({ review }, 201);
  });
}

export async function createIncident(request: Request) {
  return withUser('CUSTOMER', async (user) => {
    const body = z.object({ category: z.enum(['Unsafe behavior','Harassment','Payment dispute','Item missing','Wrong order','Driver issue','Merchant issue','Emergency','Other']), details: z.string().min(3), kind: z.enum(['ride','delivery']).optional(), requestId: z.string().optional() }).parse(await readJson(request));
    const incident = await prisma.safetyIncident.create({ data: { reporterId: user.id, category: body.category, details: body.details, rideRequestId: body.kind === 'ride' ? body.requestId : undefined, deliveryRequestId: body.kind === 'delivery' ? body.requestId : undefined } });
    return json({ incident: { id: incident.id, category: incident.category }, emergencyNotice: body.category === 'Emergency' ? 'If you are in immediate danger, contact local emergency services (police/ambulance) now. JUSTGO support does not replace emergency responders.' : undefined }, 201);
  });
}
