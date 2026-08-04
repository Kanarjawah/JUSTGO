import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { canTransition, type FulfillmentStageName } from '../lib/status.js';
import { driverEarningsBreakdown, PLATFORM_FEE_CENTS } from '../lib/money.js';

const router = Router();
router.use(requireAuth, requireRole('DRIVER'));

async function getDriver(userId: string) {
  return prisma.driverProfile.findUnique({
    where: { userId },
    include: { availability: true },
  });
}

router.get('/dashboard', async (req, res) => {
  const driver = await getDriver(req.user!.id);
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  const tips = await prisma.tip.aggregate({
    where: { driverId: driver.id },
    _sum: { amountCents: true },
  });

  res.json({
    menu: [
      'Dashboard',
      'Availability',
      'Current Requests',
      'Earnings',
      'Reviews',
      'Profile',
      'Support',
    ],
    availability: driver.availability?.status ?? 'OFF',
    applicationStatus: driver.applicationStatus,
    tipTotalCents: tips._sum.amountCents ?? 0,
  });
});

router.get('/availability', async (req, res) => {
  const driver = await getDriver(req.user!.id);
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
  res.json({ status: driver.availability?.status ?? 'OFF' });
});

router.post('/availability', async (req, res) => {
  const body = z.object({ status: z.enum(['ONLINE', 'OFF']) }).parse(req.body);
  const driver = await getDriver(req.user!.id);
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  const active = await prisma.driverAssignment.findFirst({
    where: { driverId: driver.id, active: true },
    include: { rideRequest: true, deliveryRequest: true },
  });

  const activeIncomplete =
    active &&
    ((active.rideRequest && active.rideRequest.fulfillmentStage !== 'DELIVERED') ||
      (active.deliveryRequest && active.deliveryRequest.fulfillmentStage !== 'DELIVERED'));

  let warning: string | undefined;
  if (body.status === 'OFF' && activeIncomplete) {
    warning =
      'You have an active request. Going offline will pause new requests, but you must complete the active request.';
  }

  const availability = await prisma.driverAvailability.upsert({
    where: { driverId: driver.id },
    create: { driverId: driver.id, status: body.status },
    update: { status: body.status },
  });

  await writeAudit({
    actorId: req.user!.id,
    action: 'DRIVER_AVAILABILITY',
    entityType: 'DriverAvailability',
    entityId: availability.id,
    metadata: { status: body.status },
  });

  res.json({
    status: availability.status,
    message:
      body.status === 'OFF'
        ? 'You are offline. New requests are paused.'
        : 'You are online and available for new assignments.',
    warning,
  });
});

/** Driver-facing request cards — never include emergency contacts. */
function sanitizeForDriver(reqRow: {
  id: string;
  requestNumber: string;
  serviceType: string;
  pickup: string;
  destination: string;
  distanceKm: number | null;
  durationMin: number | null;
  paymentStatus: string;
  instructions: string | null;
  fulfillmentStage: string | null;
  adminStatus: string;
  customer: { user: { firstName: string } };
  estimatedEarnCents?: number;
  estimatedFareCents?: number;
}) {
  return {
    id: reqRow.id,
    requestNumber: reqRow.requestNumber,
    requestType: reqRow.serviceType,
    customerDisplayName: reqRow.customer.user.firstName,
    pickup: reqRow.pickup,
    destination: reqRow.destination,
    distance: reqRow.distanceKm != null ? `${reqRow.distanceKm} km` : null,
    estimatedDuration: reqRow.durationMin != null ? `${reqRow.durationMin} min` : null,
    estimatedDriverEarningsCents: reqRow.estimatedEarnCents ?? reqRow.estimatedFareCents ?? 0,
    paymentStatus: reqRow.paymentStatus,
    customerInstructions: reqRow.instructions,
    currentStatus: reqRow.fulfillmentStage,
    adminStatus: reqRow.adminStatus,
    // Explicitly omit emergency contacts — not for ordinary driver cards
  };
}

router.get('/requests', async (req, res) => {
  const driver = await getDriver(req.user!.id);
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  const categories = [
    'TRANSPORTATION',
    'RIDE',
    'FOOD_DELIVERY',
    'STORE_DELIVERY',
    'PACKAGE_DELIVERY',
    'GROCERY_DELIVERY',
    'PHARMACY_DELIVERY',
    'COURIER_SERVICE',
  ];

  const assignments = await prisma.driverAssignment.findMany({
    where: { driverId: driver.id },
    include: {
      rideRequest: {
        include: { customer: { include: { user: true } } },
      },
      deliveryRequest: {
        include: { customer: { include: { user: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const requests = assignments
    .map((a) => {
      if (a.rideRequest) {
        return {
          ...sanitizeForDriver({
            ...a.rideRequest,
            estimatedFareCents: a.rideRequest.estimatedFareCents,
          }),
          assignmentId: a.id,
          active: a.active,
        };
      }
      if (a.deliveryRequest) {
        return {
          ...sanitizeForDriver(a.deliveryRequest),
          assignmentId: a.id,
          active: a.active,
        };
      }
      return null;
    })
    .filter(Boolean);

  // Eligible new offers only when ONLINE
  let offers: unknown[] = [];
  if (driver.availability?.status === 'ONLINE') {
    const openRides = await prisma.rideRequest.findMany({
      where: {
        adminStatus: 'ACCEPTED',
        assignment: null,
        fulfillmentStage: null,
      },
      include: { customer: { include: { user: true } } },
      take: 20,
    });
    const openDeliveries = await prisma.deliveryRequest.findMany({
      where: {
        adminStatus: 'ACCEPTED',
        assignment: null,
        fulfillmentStage: null,
      },
      include: { customer: { include: { user: true } } },
      take: 20,
    });
    offers = [
      ...openRides.map((r) => sanitizeForDriver({ ...r, estimatedFareCents: r.estimatedFareCents })),
      ...openDeliveries.map((d) => sanitizeForDriver(d)),
    ];
  }

  res.json({ categories, requests, offers });
});

router.post('/requests/:kind/:id/stage', async (req, res) => {
  const stage = z
    .enum(['ARRIVED', 'PICKUP', 'IN_TRANSIT', 'DELIVERED'])
    .parse(req.body.stage) as FulfillmentStageName;
  const kind = req.params.kind;
  const id = req.params.id;
  const driver = await getDriver(req.user!.id);
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

  if (kind === 'ride') {
    const ride = await prisma.rideRequest.findUnique({
      where: { id },
      include: { assignment: true, tips: true },
    });
    if (!ride || ride.assignment?.driverId !== driver.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const check = canTransition(ride.fulfillmentStage as FulfillmentStageName | null, stage);
    if (!check.ok) return res.status(400).json({ error: check.error });

    await prisma.$transaction(async (tx) => {
      await tx.rideRequest.update({
        where: { id },
        data: { fulfillmentStage: stage },
      });
      await tx.requestStatusHistory.create({
        data: {
          rideRequestId: id,
          previousStage: ride.fulfillmentStage,
          newStage: stage,
          changedById: req.user!.id,
        },
      });
      if (stage === 'DELIVERED') {
        await tx.fee.create({
          data: {
            type: 'CUSTOMER_PLATFORM',
            amountCents: PLATFORM_FEE_CENTS,
            rideRequestId: id,
            appliedAtComplete: true,
          },
        });
        await tx.fee.create({
          data: {
            type: 'DRIVER_PLATFORM',
            amountCents: PLATFORM_FEE_CENTS,
            rideRequestId: id,
            appliedAtComplete: true,
          },
        });
        if (ride.assignment) {
          await tx.driverAssignment.update({
            where: { id: ride.assignment.id },
            data: { active: false },
          });
        }
      }
    });

    const tipCents = ride.tips.reduce((s, t) => s + t.amountCents, 0);
    res.json({
      stage,
      earnings: driverEarningsBreakdown(ride.estimatedFareCents, tipCents, stage === 'DELIVERED'),
    });
    return;
  }

  if (kind === 'delivery') {
    const delivery = await prisma.deliveryRequest.findUnique({
      where: { id },
      include: { assignment: true, tips: true },
    });
    if (!delivery || delivery.assignment?.driverId !== driver.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const check = canTransition(delivery.fulfillmentStage as FulfillmentStageName | null, stage);
    if (!check.ok) return res.status(400).json({ error: check.error });

    await prisma.$transaction(async (tx) => {
      await tx.deliveryRequest.update({
        where: { id },
        data: { fulfillmentStage: stage },
      });
      await tx.requestStatusHistory.create({
        data: {
          deliveryRequestId: id,
          previousStage: delivery.fulfillmentStage,
          newStage: stage,
          changedById: req.user!.id,
        },
      });
      if (stage === 'DELIVERED') {
        await tx.fee.create({
          data: {
            type: 'CUSTOMER_PLATFORM',
            amountCents: PLATFORM_FEE_CENTS,
            deliveryRequestId: id,
            appliedAtComplete: true,
          },
        });
        await tx.fee.create({
          data: {
            type: 'DRIVER_PLATFORM',
            amountCents: PLATFORM_FEE_CENTS,
            deliveryRequestId: id,
            appliedAtComplete: true,
          },
        });
        if (delivery.assignment) {
          await tx.driverAssignment.update({
            where: { id: delivery.assignment.id },
            data: { active: false },
          });
        }
      }
    });

    const tipCents = delivery.tips.reduce((s, t) => s + t.amountCents, 0);
    res.json({
      stage,
      earnings: driverEarningsBreakdown(
        delivery.estimatedEarnCents,
        tipCents,
        stage === 'DELIVERED',
      ),
    });
    return;
  }

  res.status(400).json({ error: 'Invalid request kind' });
});

router.get('/earnings', async (req, res) => {
  const driver = await getDriver(req.user!.id);
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
  const tips = await prisma.tip.findMany({ where: { driverId: driver.id } });
  const tipTotal = tips.reduce((s, t) => s + t.amountCents, 0);
  const driverFees = await prisma.fee.aggregate({
    where: { type: 'DRIVER_PLATFORM', appliedAtComplete: true },
    _sum: { amountCents: true },
  });
  res.json({
    tipTotalCents: tipTotal,
    driverPlatformFeesCents: driverFees._sum.amountCents ?? 0,
    note: 'Tips belong entirely to the driver and are not platform revenue.',
  });
});

router.get('/reviews', async (req, res) => {
  const driver = await getDriver(req.user!.id);
  if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
  const reviews = await prisma.review.findMany({
    where: { driverId: driver.id, hidden: false },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ reviews });
});

export default router;
