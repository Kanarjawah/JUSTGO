import { z } from 'zod';
import { prisma } from '@/server/db';
import { error, json, readJson } from '@/server/http';
import { withAdmin } from '@/server/route-handler';
import { writeAudit } from '@/server/lib/audit';
import { decryptText } from '@/server/lib/crypto';
import { platformRevenueFromFees } from '@/server/lib/money';

const sections = ['Dashboard overview','Customer management','Driver management','Merchant management','Driver applications','Merchant applications','Identity and document-verification queue','Orders and current requests','Ride requests','Food-delivery requests','Store-delivery requests','Package and courier requests','Transportation requests','Payment records','Refund and cancellation management','Platform-fee records','Tax records','Driver tips','Wallet and Payments','Reviews and moderation','Complaints and incidents','Support requests','SMS delivery status','System settings','Audit logs'];

export async function getControlCenter(request: Request) {
  return withAdmin(request, async () => {
    const [customers,drivers,merchants,rides,deliveries,payments,fees,taxes,tips,incidents,tickets,sms,audits,docs] = await Promise.all([
      prisma.customerProfile.count(), prisma.driverProfile.count(), prisma.merchantProfile.count(),
      prisma.rideRequest.count(), prisma.deliveryRequest.count(), prisma.payment.count(),
      prisma.fee.findMany({ where: { appliedAtComplete: true } }), prisma.tax.findMany(), prisma.tip.findMany(),
      prisma.safetyIncident.count(), prisma.supportTicket.count(), prisma.smsDeliveryLog.count(),
      prisma.auditLog.count(), prisma.identityDocument.count({ where: { status: 'PENDING' } }),
    ]);
    const sum = (type: 'CUSTOMER_PLATFORM'|'DRIVER_PLATFORM'|'MERCHANT') => fees.filter(f=>f.type===type).reduce((s,f)=>s+f.amountCents,0);
    return json({ title: 'Admin Control Center', sections, overview: { customers, drivers, merchants, rides, deliveries, payments, incidents, tickets, smsLogs: sms, auditEntries: audits, pendingDocuments: docs, platformRevenueCents: platformRevenueFromFees(sum('CUSTOMER_PLATFORM'),sum('DRIVER_PLATFORM'),sum('MERCHANT')), tipTotalCents: tips.reduce((s,t)=>s+t.amountCents,0), tipNote: 'Tips belong entirely to drivers and are excluded from platform revenue.', taxTotalCents: taxes.reduce((s,t)=>s+t.amountCents,0) } });
  });
}

export async function getDrivers(request: Request) {
  return withAdmin(request, async () => json({ drivers: await prisma.driverProfile.findMany({ include: { user: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } }, availability: true } }) }));
}
export async function getMerchants(request: Request) {
  return withAdmin(request, async () => json({ merchants: await prisma.merchantProfile.findMany({ include: { user: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } }, store: true } }) }));
}
export async function getRequests(request: Request) {
  return withAdmin(request, async () => {
    const [rides, deliveries] = await Promise.all([
      prisma.rideRequest.findMany({ include: { customer: { include: { user: true } }, assignment: { include: { driver: { include: { user: true } } } }, statusHistory: { orderBy: { createdAt: 'asc' } }, emergencyContacts: true }, orderBy: { createdAt: 'desc' } }),
      prisma.deliveryRequest.findMany({ include: { customer: { include: { user: true } }, assignment: { include: { driver: { include: { user: true } } } }, statusHistory: { orderBy: { createdAt: 'asc' } }, order: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    return json({ rides: rides.map(r => ({ ...r, emergencyContacts: r.emergencyContacts.map(ec => ({ id: ec.id, name: decryptText(ec.nameEncrypted), phone: decryptText(ec.phoneEncrypted), retentionNote: ec.retentionNote })) })), deliveries });
  });
}
export async function getAuditLogs(request: Request) {
  return withAdmin(request, async () => json({ logs: await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { actor: { select: { firstName: true, lastName: true, role: true } } } }) }));
}

export async function decideDriver(request: Request, id: string) {
  return withAdmin(request, async (user) => {
    const body = z.object({ decision: z.enum(['APPROVED','REJECTED']), confirm: z.literal(true) }).parse(await readJson(request));
    const driver = await prisma.driverProfile.update({ where: { id }, data: { applicationStatus: body.decision } });
    await writeAudit({ actorId: user.id, action: `DRIVER_APPLICATION_${body.decision}`, entityType: 'DriverProfile', entityId: id });
    return json({ driver });
  });
}
export async function decideMerchant(request: Request, id: string) {
  return withAdmin(request, async (user) => {
    const body = z.object({ decision: z.enum(['APPROVED','REJECTED']), confirm: z.literal(true) }).parse(await readJson(request));
    const merchant = await prisma.merchantProfile.update({ where: { id }, data: { applicationStatus: body.decision } });
    await writeAudit({ actorId: user.id, action: `MERCHANT_APPLICATION_${body.decision}`, entityType: 'MerchantProfile', entityId: id });
    return json({ merchant });
  });
}
export async function setAccountStatus(request: Request, userId: string) {
  return withAdmin(request, async (admin) => {
    const body = z.object({ status: z.enum(['ACTIVE','SUSPENDED','DEACTIVATED']), confirm: z.literal(true) }).parse(await readJson(request));
    const user = await prisma.user.update({ where: { id: userId }, data: { status: body.status } });
    await writeAudit({ actorId: admin.id, action: 'ACCOUNT_STATUS_CHANGE', entityType: 'User', entityId: userId, metadata: { status: body.status } });
    return json({ user: { id: user.id, status: user.status, role: user.role, firstName: user.firstName } });
  });
}
export async function cancelRequest(request: Request) {
  return withAdmin(request, async (user) => {
    const body = z.object({ kind: z.enum(['ride','delivery']), requestId: z.string(), confirm: z.literal(true) }).parse(await readJson(request));
    if (body.kind === 'ride') await prisma.rideRequest.update({ where: { id: body.requestId }, data: { adminStatus: 'CANCELED' } });
    else await prisma.deliveryRequest.update({ where: { id: body.requestId }, data: { adminStatus: 'CANCELED' } });
    await writeAudit({ actorId: user.id, action: 'CANCEL_REQUEST', entityType: body.kind === 'ride' ? 'RideRequest' : 'DeliveryRequest', entityId: body.requestId });
    return json({ ok: true });
  });
}
export async function assignDriver(request: Request) {
  return withAdmin(request, async (user) => {
    const body = z.object({ driverId: z.string(), kind: z.enum(['ride','delivery']), requestId: z.string() }).parse(await readJson(request));
    const driver = await prisma.driverProfile.findUnique({ where: { id: body.driverId }, include: { availability: true } });
    if (!driver) return error('Driver not found', 404);
    if (driver.availability?.status !== 'ONLINE') return error('Driver is OFF and cannot receive new requests');
    if (body.kind === 'ride') {
      const assignment = await prisma.driverAssignment.upsert({ where: { rideRequestId: body.requestId }, create: { driverId: driver.id, rideRequestId: body.requestId, active: true }, update: { driverId: driver.id, active: true } });
      await prisma.rideRequest.update({ where: { id: body.requestId }, data: { adminStatus: 'ACCEPTED' } });
      await writeAudit({ actorId: user.id, action: 'ASSIGN_DRIVER', entityType: 'RideRequest', entityId: body.requestId, metadata: { driverId: driver.id } });
      return json({ assignment });
    }
    const assignment = await prisma.driverAssignment.upsert({ where: { deliveryRequestId: body.requestId }, create: { driverId: driver.id, deliveryRequestId: body.requestId, active: true }, update: { driverId: driver.id, active: true } });
    await prisma.deliveryRequest.update({ where: { id: body.requestId }, data: { adminStatus: 'ACCEPTED' } });
    await writeAudit({ actorId: user.id, action: 'ASSIGN_DRIVER', entityType: 'DeliveryRequest', entityId: body.requestId, metadata: { driverId: driver.id } });
    return json({ assignment });
  });
}
