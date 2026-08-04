import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { merchantSettlementBreakdown } from '../lib/money.js';
import { writeAudit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth, requireRole('MERCHANT'));

const uploadDir = path.resolve('uploads/private/products');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Invalid file type'));
    }
    cb(null, true);
  },
});

async function getMerchant(userId: string) {
  return prisma.merchantProfile.findUnique({
    where: { userId },
    include: { store: { include: { products: true } } },
  });
}

router.get('/dashboard', async (req, res) => {
  const merchant = await getMerchant(req.user!.id);
  if (!merchant) return res.status(404).json({ error: 'Merchant profile not found' });
  res.json({
    menu: [
      'Dashboard',
      'Current Requests',
      'Store',
      'Products or Menu',
      'Preparation Times',
      'Earnings',
      'Reviews',
      'Profile',
      'Support',
    ],
    currentRequestTabs: ['Store'],
    businessName: merchant.businessName,
    applicationStatus: merchant.applicationStatus,
    store: merchant.store,
  });
});

router.get('/requests', async (req, res) => {
  const merchant = await getMerchant(req.user!.id);
  if (!merchant?.store) return res.json({ requests: [], tabs: ['Store'] });

  const orders = await prisma.order.findMany({
    where: { storeId: merchant.store.id },
    include: {
      items: true,
      customer: { include: { user: true } },
      deliveryRequest: {
        include: { assignment: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({
    tabs: ['Store'],
    supported: [
      'Food orders',
      'Restaurant orders',
      'Grocery orders',
      'Pharmacy orders',
      'Retail-store orders',
      'Store-delivery requests',
    ],
    requests: orders.map((o) => ({
      requestNumber: o.requestNumber,
      customerDisplayName: o.customer.user.firstName,
      products: o.items.map((i) => ({ name: i.name, quantity: i.quantity, priceCents: i.priceCents })),
      totalCents: o.totalCents,
      paymentStatus: o.paymentStatus,
      preparationEstimate: o.prepEstimateMin,
      driverAssignmentStatus: o.deliveryRequest?.assignment ? 'Assigned' : 'Unassigned',
      fulfillmentStage: o.deliveryRequest?.fulfillmentStage ?? null,
      merchantPrepStatus: o.merchantPrepStatus,
      deliveryId: o.deliveryRequestId,
      orderId: o.id,
    })),
  });
});

router.post('/orders/:id/prep', async (req, res) => {
  const status = z
    .enum(['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'])
    .parse(req.body.status);
  const merchant = await getMerchant(req.user!.id);
  if (!merchant?.store) return res.status(404).json({ error: 'Store not found' });

  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order || order.storeId !== merchant.store.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { merchantPrepStatus: status },
  });

  if (order.deliveryRequestId) {
    await prisma.deliveryRequest.update({
      where: { id: order.deliveryRequestId },
      data: { merchantPrepStatus: status, adminStatus: status === 'ACCEPTED' ? 'ACCEPTED' : undefined },
    });
  }

  await writeAudit({
    actorId: req.user!.id,
    action: 'MERCHANT_PREP_STATUS',
    entityType: 'Order',
    entityId: order.id,
    metadata: { status },
  });

  res.json({ orderId: updated.id, merchantPrepStatus: updated.merchantPrepStatus });
});

router.post('/orders/:id/reject', async (req, res) => {
  const confirm = z.object({ confirm: z.literal(true) }).parse(req.body);
  void confirm;
  const merchant = await getMerchant(req.user!.id);
  if (!merchant?.store) return res.status(404).json({ error: 'Store not found' });
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order || order.storeId !== merchant.store.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (order.deliveryRequestId) {
    await prisma.deliveryRequest.update({
      where: { id: order.deliveryRequestId },
      data: { adminStatus: 'REJECTED' },
    });
  }
  await writeAudit({
    actorId: req.user!.id,
    action: 'MERCHANT_REJECT_ORDER',
    entityType: 'Order',
    entityId: order.id,
  });
  res.json({ ok: true });
});

router.put('/store', async (req, res) => {
  const body = z
    .object({
      name: z.string().min(2),
      description: z.string().optional(),
      address: z.string().optional(),
      preparationMins: z.number().int().min(1).max(240).optional(),
    })
    .parse(req.body);
  const merchant = await getMerchant(req.user!.id);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

  const store = await prisma.store.upsert({
    where: { merchantId: merchant.id },
    create: {
      merchantId: merchant.id,
      name: body.name,
      description: body.description,
      address: body.address,
      preparationMins: body.preparationMins ?? 20,
    },
    update: {
      name: body.name,
      description: body.description,
      address: body.address,
      preparationMins: body.preparationMins,
    },
  });
  res.json({ store });
});

router.post('/products', upload.single('image'), async (req, res) => {
  try {
    const body = z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        priceCents: z.coerce.number().int().positive(),
        available: z.coerce.boolean().optional(),
        prepMins: z.coerce.number().int().optional(),
      })
      .parse(req.body);
    const merchant = await getMerchant(req.user!.id);
    if (!merchant?.store) return res.status(400).json({ error: 'Create store first' });

    const product = await prisma.product.create({
      data: {
        storeId: merchant.store.id,
        name: body.name,
        description: body.description,
        priceCents: body.priceCents,
        available: body.available ?? true,
        prepMins: body.prepMins ?? 15,
        imagePath: req.file ? req.file.filename : null,
      },
    });
    res.status(201).json({ product });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid product';
    res.status(400).json({ error: message });
  }
});

router.patch('/products/:id', async (req, res) => {
  const body = z
    .object({
      name: z.string().optional(),
      priceCents: z.number().int().positive().optional(),
      available: z.boolean().optional(),
      outOfStock: z.boolean().optional(),
      prepMins: z.number().int().optional(),
      description: z.string().optional(),
    })
    .parse(req.body);
  const merchant = await getMerchant(req.user!.id);
  if (!merchant?.store) return res.status(404).json({ error: 'Store not found' });
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product || product.storeId !== merchant.store.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const updated = await prisma.product.update({ where: { id: product.id }, data: body });
  res.json({ product: updated });
});

router.get('/earnings', async (req, res) => {
  const merchant = await getMerchant(req.user!.id);
  if (!merchant?.store) return res.json({ settlement: merchantSettlementBreakdown(0, 0, 0, 0) });
  const orders = await prisma.order.findMany({ where: { storeId: merchant.store.id } });
  const productSubtotal = orders.reduce((s, o) => s + o.subtotalCents, 0);
  res.json({
    settlement: merchantSettlementBreakdown(productSubtotal, 0, 0, 0),
  });
});

router.get('/reviews', async (req, res) => {
  const merchant = await getMerchant(req.user!.id);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
  const reviews = await prisma.review.findMany({
    where: { merchantId: merchant.id, hidden: false },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ reviews });
});

export default router;
