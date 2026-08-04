import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { decryptText } from '../lib/crypto.js';
import { platformRevenueFromFees } from '../lib/money.js';

const router = Router();

/** All admin routes require authenticated ADMIN role — not merely a hidden UI button. */
router.use(requireAuth, requireRole('ADMIN'));

const SECTIONS = [
  'Dashboard overview',
  'Customer management',
  'Driver management',
  'Merchant management',
  'Driver applications',
  'Merchant applications',
  'Identity and document-verification queue',
  'Orders and current requests',
  'Ride requests',
  'Food-delivery requests',
  'Store-delivery requests',
  'Package and courier requests',
  'Transportation requests',
  'Payment records',
  'Refund and cancellation management',
  'Platform-fee records',
  'Tax records',
  'Driver tips',
  'Reviews and moderation',
  'Complaints and incidents',
  'Support requests',
  'SMS delivery status',
  'System settings',
  'Audit logs',
] as const;

router.get('/control-center', async (_req, res) => {
  const [
    customers,
    drivers,
    merchants,
    rides,
    deliveries,
    payments,
    fees,
    taxes,
    tips,
    incidents,
    tickets,
    sms,
    audits,
    docs,
  ] = await Promise.all([
    prisma.customerProfile.count(),
    prisma.driverProfile.count(),
    prisma.merchantProfile.count(),
    prisma.rideRequest.count(),
    prisma.deliveryRequest.count(),
    prisma.payment.count(),
    prisma.fee.findMany({ where: { appliedAtComplete: true } }),
    prisma.tax.findMany(),
    prisma.tip.findMany(),
    prisma.safetyIncident.count(),
    prisma.supportTicket.count(),
    prisma.smsDeliveryLog.count(),
    prisma.auditLog.count(),
    prisma.identityDocument.count({ where: { status: 'PENDING' } }),
  ]);

  const customerFees = fees
    .filter((f) => f.type === 'CUSTOMER_PLATFORM')
    .reduce((s, f) => s + f.amountCents, 0);
  const driverFees = fees
    .filter((f) => f.type === 'DRIVER_PLATFORM')
    .reduce((s, f) => s + f.amountCents, 0);
  const merchantFees = fees
    .filter((f) => f.type === 'MERCHANT')
    .reduce((s, f) => s + f.amountCents, 0);
  const tipTotal = tips.reduce((s, t) => s + t.amountCents, 0);

  res.json({
    title: 'Admin Control Center',
    sections: SECTIONS,
    overview: {
      customers,
      drivers,
      merchants,
      rides,
      deliveries,
      payments,
      incidents,
      tickets,
      smsLogs: sms,
      auditEntries: audits,
      pendingDocuments: docs,
      platformRevenueCents: platformRevenueFromFees(customerFees, driverFees, merchantFees),
      tipTotalCents: tipTotal,
      tipNote: 'Tips belong entirely to drivers and are excluded from platform revenue.',
      taxTotalCents: taxes.reduce((s, t) => s + t.amountCents, 0),
    },
  });
});

router.get('/customers', async (_req, res) => {
  const rows = await prisma.user.findMany({
    where: { role: 'CUSTOMER' },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      status: true,
      createdAt: true,
    },
  });
  res.json({ customers: rows });
});

router.get('/drivers', async (_req, res) => {
  const rows = await prisma.driverProfile.findMany({
    include: {
      user: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } },
      availability: true,
    },
  });
  res.json({ drivers: rows });
});

router.get('/merchants', async (_req, res) => {
  const rows = await prisma.merchantProfile.findMany({
    include: {
      user: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } },
      store: true,
    },
  });
  res.json({ merchants: rows });
});

router.post('/drivers/:id/application', async (req, res) => {
  const body = z
    .object({
      decision: z.enum(['APPROVED', 'REJECTED']),
      confirm: z.literal(true),
    })
    .parse(req.body);
  const driver = await prisma.driverProfile.update({
    where: { id: req.params.id },
    data: { applicationStatus: body.decision },
  });
  await writeAudit({
    actorId: req.user!.id,
    action: `DRIVER_APPLICATION_${body.decision}`,
    entityType: 'DriverProfile',
    entityId: driver.id,
  });
  res.json({ driver });
});

router.post('/merchants/:id/application', async (req, res) => {
  const body = z
    .object({
      decision: z.enum(['APPROVED', 'REJECTED']),
      confirm: z.literal(true),
    })
    .parse(req.body);
  const merchant = await prisma.merchantProfile.update({
    where: { id: req.params.id },
    data: { applicationStatus: body.decision },
  });
  await writeAudit({
    actorId: req.user!.id,
    action: `MERCHANT_APPLICATION_${body.decision}`,
    entityType: 'MerchantProfile',
    entityId: merchant.id,
  });
  res.json({ merchant });
});

router.post('/accounts/:userId/status', async (req, res) => {
  const body = z
    .object({
      status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
      confirm: z.literal(true),
    })
    .parse(req.body);
  const user = await prisma.user.update({
    where: { id: req.params.userId },
    data: { status: body.status },
  });
  await writeAudit({
    actorId: req.user!.id,
    action: 'ACCOUNT_STATUS_CHANGE',
    entityType: 'User',
    entityId: user.id,
    metadata: { status: body.status },
  });
  res.json({
    user: {
      id: user.id,
      status: user.status,
      role: user.role,
      firstName: user.firstName,
    },
  });
});

router.get('/requests', async (_req, res) => {
  const rides = await prisma.rideRequest.findMany({
    include: {
      customer: { include: { user: true } },
      assignment: { include: { driver: { include: { user: true } } } },
      statusHistory: { orderBy: { createdAt: 'asc' } },
      emergencyContacts: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  const deliveries = await prisma.deliveryRequest.findMany({
    include: {
      customer: { include: { user: true } },
      assignment: { include: { driver: { include: { user: true } } } },
      statusHistory: { orderBy: { createdAt: 'asc' } },
      order: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({
    rides: rides.map((r) => ({
      ...r,
      emergencyContacts: r.emergencyContacts.map((ec) => ({
        id: ec.id,
        name: decryptText(ec.nameEncrypted),
        phone: decryptText(ec.phoneEncrypted),
        retentionNote: ec.retentionNote,
      })),
    })),
    deliveries,
  });
});

router.post('/assign-driver', async (req, res) => {
  const body = z
    .object({
      driverId: z.string(),
      kind: z.enum(['ride', 'delivery']),
      requestId: z.string(),
    })
    .parse(req.body);

  const driver = await prisma.driverProfile.findUnique({
    where: { id: body.driverId },
    include: { availability: true },
  });
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  if (driver.availability?.status !== 'ONLINE') {
    return res.status(400).json({ error: 'Driver is OFF and cannot receive new requests' });
  }

  if (body.kind === 'ride') {
    const assignment = await prisma.driverAssignment.upsert({
      where: { rideRequestId: body.requestId },
      create: { driverId: driver.id, rideRequestId: body.requestId, active: true },
      update: { driverId: driver.id, active: true },
    });
    await prisma.rideRequest.update({
      where: { id: body.requestId },
      data: { adminStatus: 'ACCEPTED' },
    });
    await writeAudit({
      actorId: req.user!.id,
      action: 'ASSIGN_DRIVER',
      entityType: 'RideRequest',
      entityId: body.requestId,
      metadata: { driverId: driver.id },
    });
    return res.json({ assignment });
  }

  const assignment = await prisma.driverAssignment.upsert({
    where: { deliveryRequestId: body.requestId },
    create: { driverId: driver.id, deliveryRequestId: body.requestId, active: true },
    update: { driverId: driver.id, active: true },
  });
  await prisma.deliveryRequest.update({
    where: { id: body.requestId },
    data: { adminStatus: 'ACCEPTED' },
  });
  await writeAudit({
    actorId: req.user!.id,
    action: 'ASSIGN_DRIVER',
    entityType: 'DeliveryRequest',
    entityId: body.requestId,
    metadata: { driverId: driver.id },
  });
  res.json({ assignment });
});

router.post('/cancel', async (req, res) => {
  const body = z
    .object({
      kind: z.enum(['ride', 'delivery']),
      requestId: z.string(),
      confirm: z.literal(true),
    })
    .parse(req.body);

  if (body.kind === 'ride') {
    await prisma.rideRequest.update({
      where: { id: body.requestId },
      data: { adminStatus: 'CANCELED' },
    });
  } else {
    await prisma.deliveryRequest.update({
      where: { id: body.requestId },
      data: { adminStatus: 'CANCELED' },
    });
  }
  await writeAudit({
    actorId: req.user!.id,
    action: 'CANCEL_REQUEST',
    entityType: body.kind === 'ride' ? 'RideRequest' : 'DeliveryRequest',
    entityId: body.requestId,
  });
  res.json({ ok: true });
});

router.post('/refunds', async (req, res) => {
  const body = z
    .object({
      paymentId: z.string(),
      amountCents: z.number().int().positive(),
      reason: z.string().min(3),
      confirm: z.literal(true),
      kind: z.enum(['ride', 'delivery']).optional(),
      requestId: z.string().optional(),
    })
    .parse(req.body);

  const refund = await prisma.refund.create({
    data: {
      paymentId: body.paymentId,
      amountCents: body.amountCents,
      reason: body.reason,
      rideRequestId: body.kind === 'ride' ? body.requestId : undefined,
      deliveryRequestId: body.kind === 'delivery' ? body.requestId : undefined,
    },
  });
  await prisma.payment.update({
    where: { id: body.paymentId },
    data: { status: 'REFUNDED' },
  });
  await writeAudit({
    actorId: req.user!.id,
    action: 'PROCESS_REFUND',
    entityType: 'Refund',
    entityId: refund.id,
  });
  res.json({ refund });
});

router.get('/payments', async (_req, res) => {
  const payments = await prisma.payment.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ payments });
});

router.get('/fees', async (_req, res) => {
  const fees = await prisma.fee.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ fees });
});

router.get('/taxes', async (_req, res) => {
  const taxes = await prisma.tax.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ taxes });
});

router.get('/tips', async (_req, res) => {
  const tips = await prisma.tip.findMany({
    include: { driver: { include: { user: { select: { firstName: true, lastName: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ tips, note: 'Tips are not platform revenue.' });
});

router.get('/reviews', async (_req, res) => {
  const reviews = await prisma.review.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ reviews });
});

router.post('/reviews/:id/moderate', async (req, res) => {
  const body = z.object({ hidden: z.boolean() }).parse(req.body);
  const review = await prisma.review.update({
    where: { id: req.params.id },
    data: { moderated: true, hidden: body.hidden },
  });
  await writeAudit({
    actorId: req.user!.id,
    action: 'MODERATE_REVIEW',
    entityType: 'Review',
    entityId: review.id,
    metadata: { hidden: body.hidden },
  });
  res.json({ review });
});

router.get('/incidents', async (_req, res) => {
  const incidents = await prisma.safetyIncident.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ incidents });
});

router.get('/support', async (_req, res) => {
  const tickets = await prisma.supportTicket.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ tickets });
});

router.get('/sms', async (_req, res) => {
  const logs = await prisma.smsDeliveryLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({
    logs,
    note: 'Orange SMS is not an operational production integration in this environment.',
  });
});

router.get('/settings', async (_req, res) => {
  const settings = await prisma.systemSetting.findMany();
  res.json({ settings });
});

router.put('/settings/:key', async (req, res) => {
  const body = z.object({ value: z.string() }).parse(req.body);
  const setting = await prisma.systemSetting.upsert({
    where: { key: req.params.key },
    create: { key: req.params.key, value: body.value },
    update: { value: body.value },
  });
  await writeAudit({
    actorId: req.user!.id,
    action: 'UPDATE_SETTING',
    entityType: 'SystemSetting',
    entityId: setting.id,
    metadata: { key: setting.key },
  });
  res.json({ setting });
});

router.get('/audit-logs', async (_req, res) => {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { actor: { select: { firstName: true, lastName: true, role: true } } },
  });
  res.json({ logs });
});

router.get('/documents', async (_req, res) => {
  const docs = await prisma.identityDocument.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ documents: docs });
});

router.post('/documents/:id/review', async (req, res) => {
  const body = z.object({ status: z.enum(['APPROVED', 'REJECTED']) }).parse(req.body);
  const doc = await prisma.identityDocument.update({
    where: { id: req.params.id },
    data: { status: body.status, reviewedAt: new Date() },
  });
  await writeAudit({
    actorId: req.user!.id,
    action: 'REVIEW_DOCUMENT',
    entityType: 'IdentityDocument',
    entityId: doc.id,
    metadata: { status: body.status },
  });
  res.json({ document: doc });
});

export default router;
