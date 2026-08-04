import { z } from 'zod';
import { prisma } from '@/server/db';
import { error, json, readJson } from '@/server/http';
import { withUser } from '@/server/route-handler';
import { merchantSettlementBreakdown } from '@/server/lib/money';
import { writeAudit } from '@/server/lib/audit';

const merchant = (userId: string) => prisma.merchantProfile.findUnique({ where: { userId }, include: { store: { include: { products: true } } } });

export async function getDashboard() {
  return withUser('MERCHANT', async (user) => {
    const profile = await merchant(user.id);
    if (!profile) return error('Merchant profile not found', 404);
    return json({ menu: ['Dashboard','Current Requests','Store','Products or Menu','Preparation Times','Earnings','Reviews','Profile','Support'], currentRequestTabs: ['Store'], businessName: profile.businessName, applicationStatus: profile.applicationStatus, store: profile.store });
  });
}

export async function getRequests() {
  return withUser('MERCHANT', async (user) => {
    const profile = await merchant(user.id);
    if (!profile?.store) return json({ requests: [], tabs: ['Store'] });
    const orders = await prisma.order.findMany({ where: { storeId: profile.store.id }, include: { items: true, customer: { include: { user: true } }, deliveryRequest: { include: { assignment: true } } }, orderBy: { createdAt: 'desc' } });
    return json({ tabs: ['Store'], supported: ['Food orders','Restaurant orders','Grocery orders','Pharmacy orders','Retail-store orders','Store-delivery requests'], requests: orders.map(o => ({ requestNumber: o.requestNumber, customerDisplayName: o.customer.user.firstName, products: o.items.map(i => ({ name: i.name, quantity: i.quantity, priceCents: i.priceCents })), totalCents: o.totalCents, paymentStatus: o.paymentStatus, preparationEstimate: o.prepEstimateMin, driverAssignmentStatus: o.deliveryRequest?.assignment ? 'Assigned' : 'Unassigned', fulfillmentStage: o.deliveryRequest?.fulfillmentStage ?? null, merchantPrepStatus: o.merchantPrepStatus, deliveryId: o.deliveryRequestId, orderId: o.id })) });
  });
}

export async function setPrep(request: Request, id: string) {
  return withUser('MERCHANT', async (user) => {
    const status = z.enum(['ACCEPTED','PREPARING','READY_FOR_PICKUP']).parse((await readJson<{status: unknown}>(request)).status);
    const profile = await merchant(user.id);
    if (!profile?.store) return error('Store not found', 404);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order || order.storeId !== profile.store.id) return error('Forbidden', 403);
    const updated = await prisma.order.update({ where: { id }, data: { merchantPrepStatus: status } });
    if (order.deliveryRequestId) await prisma.deliveryRequest.update({ where: { id: order.deliveryRequestId }, data: { merchantPrepStatus: status, adminStatus: status === 'ACCEPTED' ? 'ACCEPTED' : undefined } });
    await writeAudit({ actorId: user.id, action: 'MERCHANT_PREP_STATUS', entityType: 'Order', entityId: id, metadata: { status } });
    return json({ orderId: updated.id, merchantPrepStatus: updated.merchantPrepStatus });
  });
}

export async function rejectOrder(request: Request, id: string) {
  return withUser('MERCHANT', async (user) => {
    z.object({ confirm: z.literal(true) }).parse(await readJson(request));
    const profile = await merchant(user.id);
    if (!profile?.store) return error('Store not found', 404);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order || order.storeId !== profile.store.id) return error('Forbidden', 403);
    if (order.deliveryRequestId) await prisma.deliveryRequest.update({ where: { id: order.deliveryRequestId }, data: { adminStatus: 'REJECTED' } });
    await writeAudit({ actorId: user.id, action: 'MERCHANT_REJECT_ORDER', entityType: 'Order', entityId: id });
    return json({ ok: true });
  });
}

export async function updateStore(request: Request) {
  return withUser('MERCHANT', async (user) => {
    const body = z.object({ name: z.string().min(2), description: z.string().optional(), address: z.string().optional(), preparationMins: z.number().int().min(1).max(240).optional() }).parse(await readJson(request));
    const profile = await merchant(user.id);
    if (!profile) return error('Merchant not found', 404);
    const store = await prisma.store.upsert({ where: { merchantId: profile.id }, create: { merchantId: profile.id, name: body.name, description: body.description, address: body.address, preparationMins: body.preparationMins ?? 20 }, update: body });
    return json({ store });
  });
}

export async function createProduct(request: Request) {
  return withUser('MERCHANT', async (user) => {
    const body = z.object({ name: z.string().min(1), description: z.string().optional(), priceCents: z.coerce.number().int().positive(), available: z.coerce.boolean().optional(), prepMins: z.coerce.number().int().optional(), imagePath: z.string().optional() }).parse(await readJson(request));
    const profile = await merchant(user.id);
    if (!profile?.store) return error('Create store first');
    const product = await prisma.product.create({ data: { storeId: profile.store.id, name: body.name, description: body.description, priceCents: body.priceCents, available: body.available ?? true, prepMins: body.prepMins ?? 15, imagePath: body.imagePath ?? null } });
    return json({ product }, 201);
  });
}

export async function updateProduct(request: Request, id: string) {
  return withUser('MERCHANT', async (user) => {
    const body = z.object({ name: z.string().optional(), priceCents: z.number().int().positive().optional(), available: z.boolean().optional(), outOfStock: z.boolean().optional(), prepMins: z.number().int().optional(), description: z.string().optional() }).parse(await readJson(request));
    const profile = await merchant(user.id);
    if (!profile?.store) return error('Store not found', 404);
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product || product.storeId !== profile.store.id) return error('Forbidden', 403);
    return json({ product: await prisma.product.update({ where: { id }, data: body }) });
  });
}

export async function getEarnings() {
  return withUser('MERCHANT', async (user) => {
    const profile = await merchant(user.id);
    if (!profile?.store) return json({ settlement: merchantSettlementBreakdown(0,0,0,0) });
    const orders = await prisma.order.findMany({ where: { storeId: profile.store.id } });
    return json({ settlement: merchantSettlementBreakdown(orders.reduce((s,o)=>s+o.subtotalCents,0),0,0,0) });
  });
}

export async function getReviews() {
  return withUser('MERCHANT', async (user) => {
    const profile = await merchant(user.id);
    if (!profile) return error('Merchant not found', 404);
    return json({ reviews: await prisma.review.findMany({ where: { merchantId: profile.id, hidden: false }, orderBy: { createdAt: 'desc' } }) });
  });
}
