import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { normalizePhone } from '../lib/phone.js';
import { encryptText } from '../lib/crypto.js';
import { customerPriceBreakdown, toCents } from '../lib/money.js';
import { writeAudit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth, requireRole('CUSTOMER'));

const SERVICES = [
  'Ride',
  'Transportation',
  'Food Delivery',
  'Store Delivery',
  'Grocery Delivery',
  'Pharmacy Delivery',
  'Package Delivery',
  'Courier Service',
] as const;

function requestNumber(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
}

async function getCustomer(userId: string) {
  return prisma.customerProfile.findUnique({ where: { userId } });
}

router.get('/services', (_req, res) => {
  res.json({ services: SERVICES });
});

router.post('/rides', async (req, res) => {
  try {
    const body = z
      .object({
        pickup: z.string().min(2),
        destination: z.string().min(2),
        pickupDate: z.string().min(4),
        pickupTime: z.string().min(2),
        riderCount: z.number().int().min(1).max(6),
        customerPhone: z.string().min(7),
        emergencyContactName: z.string().min(2),
        emergencyContactPhone: z.string().min(7),
        accessibilityNeeds: z.string().optional(),
        tripNote: z.string().optional(),
        estimatedFareLd: z.union([z.number(), z.string()]),
        paymentMethod: z.enum(['MTN_MOMO', 'ORANGE_MONEY']),
        tipLd: z.union([z.number(), z.string()]).optional(),
        safetyConsent: z.literal(true),
      })
      .parse(req.body);

    const customer = await getCustomer(req.user!.id);
    if (!customer) return res.status(404).json({ error: 'Customer profile not found' });

    const fareCents = toCents(body.estimatedFareLd);
    const tipCents = body.tipLd != null ? toCents(body.tipLd) : 0;
    const taxCents = Math.round(fareCents * 0.05);
    const breakdown = customerPriceBreakdown({
      subtotalCents: fareCents,
      deliveryOrRideCents: 0,
      taxCents,
      tipCents,
    });

    const ride = await prisma.rideRequest.create({
      data: {
        requestNumber: requestNumber('RIDE'),
        customerId: customer.id,
        serviceType: 'RIDE',
        pickup: body.pickup,
        destination: body.destination,
        pickupDate: body.pickupDate,
        pickupTime: body.pickupTime,
        riderCount: body.riderCount,
        customerPhone: normalizePhone(body.customerPhone),
        accessibilityNeeds: body.accessibilityNeeds,
        tripNote: body.tripNote,
        estimatedFareCents: fareCents,
        paymentMethod: body.paymentMethod,
        safetyConsent: true,
        adminStatus: 'PENDING',
        paymentStatus: 'PENDING',
        distanceKm: 5.2,
        durationMin: 18,
        emergencyContacts: {
          create: {
            customerId: customer.id,
            nameEncrypted: encryptText(body.emergencyContactName),
            phoneEncrypted: encryptText(normalizePhone(body.emergencyContactPhone)),
          },
        },
        payment: {
          create: {
            method: body.paymentMethod,
            status: 'PENDING',
            amountCents: breakdown.totalCents,
          },
        },
        taxes: { create: { amountCents: taxCents } },
        ...(tipCents > 0
          ? {
              // Tip assigned after driver assignment; stored against ride for settlement
            }
          : {}),
      },
    });

    await writeAudit({
      actorId: req.user!.id,
      action: 'CREATE_RIDE',
      entityType: 'RideRequest',
      entityId: ride.id,
    });

    res.status(201).json({
      requestNumber: ride.requestNumber,
      id: ride.id,
      priceBreakdown: breakdown,
      note: 'Payment integrations (MTN MoMo / Orange Money) are not operational in this environment.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid request';
    res.status(400).json({ error: message });
  }
});

router.post('/deliveries', async (req, res) => {
  try {
    const body = z
      .object({
        serviceType: z.enum([
          'TRANSPORTATION',
          'FOOD_DELIVERY',
          'STORE_DELIVERY',
          'GROCERY_DELIVERY',
          'PHARMACY_DELIVERY',
          'PACKAGE_DELIVERY',
          'COURIER_SERVICE',
        ]),
        pickup: z.string().min(2),
        destination: z.string().min(2),
        instructions: z.string().optional(),
        subtotalLd: z.union([z.number(), z.string()]),
        deliveryChargeLd: z.union([z.number(), z.string()]),
        tipLd: z.union([z.number(), z.string()]).optional(),
        paymentMethod: z.enum(['MTN_MOMO', 'ORANGE_MONEY']),
      })
      .parse(req.body);

    const customer = await getCustomer(req.user!.id);
    if (!customer) return res.status(404).json({ error: 'Customer profile not found' });

    const subtotalCents = toCents(body.subtotalLd);
    const deliveryCents = toCents(body.deliveryChargeLd);
    const tipCents = body.tipLd != null ? toCents(body.tipLd) : 0;
    const taxCents = Math.round(subtotalCents * 0.05);
    const breakdown = customerPriceBreakdown({
      subtotalCents,
      deliveryOrRideCents: deliveryCents,
      taxCents,
      tipCents,
    });

    const delivery = await prisma.deliveryRequest.create({
      data: {
        requestNumber: requestNumber('DEL'),
        customerId: customer.id,
        serviceType: body.serviceType,
        pickup: body.pickup,
        destination: body.destination,
        instructions: body.instructions,
        estimatedEarnCents: deliveryCents,
        paymentStatus: 'PENDING',
        adminStatus: 'PENDING',
        distanceKm: 4.1,
        durationMin: 25,
        payment: {
          create: {
            method: body.paymentMethod,
            status: 'PENDING',
            amountCents: breakdown.totalCents,
          },
        },
        taxes: { create: { amountCents: taxCents } },
        fees: {
          create: {
            type: 'DELIVERY',
            amountCents: deliveryCents,
            appliedAtComplete: false,
          },
        },
      },
    });

    res.status(201).json({
      id: delivery.id,
      requestNumber: delivery.requestNumber,
      priceBreakdown: breakdown,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid request';
    res.status(400).json({ error: message });
  }
});

router.get('/requests', async (req, res) => {
  const customer = await getCustomer(req.user!.id);
  if (!customer) return res.status(404).json({ error: 'Customer profile not found' });

  const rides = await prisma.rideRequest.findMany({
    where: { customerId: customer.id },
    include: {
      assignment: { include: { driver: { include: { user: true } } } },
      payment: true,
      fees: true,
      taxes: true,
      tips: true,
      statusHistory: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const deliveries = await prisma.deliveryRequest.findMany({
    where: { customerId: customer.id },
    include: {
      assignment: { include: { driver: { include: { user: true } } } },
      order: { include: { store: { include: { merchant: true } } } },
      payment: true,
      fees: true,
      taxes: true,
      tips: true,
      statusHistory: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const mapRide = (r: (typeof rides)[number]) => {
    const tip = r.tips.reduce((s, t) => s + t.amountCents, 0);
    const tax = r.taxes.reduce((s, t) => s + t.amountCents, 0);
    const platform = r.fees
      .filter((f) => f.type === 'CUSTOMER_PLATFORM' && f.appliedAtComplete)
      .reduce((s, f) => s + f.amountCents, 0);
    return {
      requestNumber: r.requestNumber,
      serviceType: r.serviceType,
      driverStatus: r.assignment?.driver.user.firstName
        ? `${r.assignment.driver.user.firstName} · ${r.fulfillmentStage ?? 'Assigned'}`
        : 'Unassigned',
      merchantStatus: null,
      pickup: r.pickup,
      destination: r.destination,
      priceBreakdown: customerPriceBreakdown({
        subtotalCents: r.estimatedFareCents,
        deliveryOrRideCents: 0,
        taxCents: tax,
        tipCents: tip,
      }),
      customerPlatformFeeAppliedCents: platform,
      paymentStatus: r.paymentStatus,
      currentStage: r.fulfillmentStage,
      estimatedCompletion: r.durationMin != null ? `${r.durationMin} min` : null,
      canReview: r.fulfillmentStage === 'DELIVERED',
      history: r.statusHistory,
      id: r.id,
      kind: 'ride' as const,
    };
  };

  const mapDelivery = (d: (typeof deliveries)[number]) => {
    const tip = d.tips.reduce((s, t) => s + t.amountCents, 0);
    const tax = d.taxes.reduce((s, t) => s + t.amountCents, 0);
    const deliveryFee = d.fees
      .filter((f) => f.type === 'DELIVERY')
      .reduce((s, f) => s + f.amountCents, 0);
    return {
      requestNumber: d.requestNumber,
      serviceType: d.serviceType,
      driverStatus: d.assignment?.driver.user.firstName
        ? `${d.assignment.driver.user.firstName} · ${d.fulfillmentStage ?? 'Assigned'}`
        : 'Unassigned',
      merchantStatus: d.merchantPrepStatus,
      pickup: d.pickup,
      destination: d.destination,
      priceBreakdown: customerPriceBreakdown({
        subtotalCents: d.order?.subtotalCents ?? 0,
        deliveryOrRideCents: deliveryFee,
        taxCents: tax,
        tipCents: tip,
      }),
      paymentStatus: d.paymentStatus,
      currentStage: d.fulfillmentStage,
      estimatedCompletion: d.durationMin != null ? `${d.durationMin} min` : null,
      canReview: d.fulfillmentStage === 'DELIVERED',
      history: d.statusHistory,
      id: d.id,
      kind: 'delivery' as const,
    };
  };

  res.json({
    requests: [...rides.map(mapRide), ...deliveries.map(mapDelivery)],
  });
});

router.post('/reviews', async (req, res) => {
  try {
    const body = z
      .object({
        kind: z.enum(['ride', 'delivery']),
        requestId: z.string(),
        rating: z.number().int().min(1).max(5),
        comment: z.string().optional(),
        target: z.enum(['driver', 'merchant', 'overall']),
      })
      .parse(req.body);

    if (body.kind === 'ride') {
      const ride = await prisma.rideRequest.findUnique({
        where: { id: body.requestId },
        include: { assignment: true, customer: true },
      });
      if (!ride || ride.customer.userId !== req.user!.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (ride.fulfillmentStage !== 'DELIVERED') {
        return res.status(400).json({ error: 'Reviews are allowed only after delivery is complete' });
      }
      const review = await prisma.review.create({
        data: {
          rating: body.rating,
          comment: body.comment,
          reviewerId: req.user!.id,
          rideRequestId: ride.id,
          driverId: body.target === 'driver' ? ride.assignment?.driverId : undefined,
          overall: body.target === 'overall',
        },
      });
      return res.status(201).json({ review });
    }

    const delivery = await prisma.deliveryRequest.findUnique({
      where: { id: body.requestId },
      include: { assignment: true, customer: true, order: { include: { store: true } } },
    });
    if (!delivery || delivery.customer.userId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (delivery.fulfillmentStage !== 'DELIVERED') {
      return res.status(400).json({ error: 'Reviews are allowed only after delivery is complete' });
    }
    const review = await prisma.review.create({
      data: {
        rating: body.rating,
        comment: body.comment,
        reviewerId: req.user!.id,
        deliveryRequestId: delivery.id,
        driverId: body.target === 'driver' ? delivery.assignment?.driverId : undefined,
        merchantId:
          body.target === 'merchant' ? delivery.order?.store?.merchantId : undefined,
        overall: body.target === 'overall',
      },
    });
    res.status(201).json({ review });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid request';
    res.status(400).json({ error: message });
  }
});

router.post('/incidents', async (req, res) => {
  const body = z
    .object({
      category: z.enum([
        'Unsafe behavior',
        'Harassment',
        'Payment dispute',
        'Item missing',
        'Wrong order',
        'Driver issue',
        'Merchant issue',
        'Emergency',
        'Other',
      ]),
      details: z.string().min(3),
      kind: z.enum(['ride', 'delivery']).optional(),
      requestId: z.string().optional(),
    })
    .parse(req.body);

  const incident = await prisma.safetyIncident.create({
    data: {
      reporterId: req.user!.id,
      category: body.category,
      details: body.details,
      rideRequestId: body.kind === 'ride' ? body.requestId : undefined,
      deliveryRequestId: body.kind === 'delivery' ? body.requestId : undefined,
    },
  });

  res.status(201).json({
    incident: { id: incident.id, category: incident.category },
    emergencyNotice:
      body.category === 'Emergency'
        ? 'If you are in immediate danger, contact local emergency services (police/ambulance) now. JUSTGO support does not replace emergency responders.'
        : undefined,
  });
});

export default router;
