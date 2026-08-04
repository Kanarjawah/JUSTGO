import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { error, json, readJson } from '@/server/http';
import { requireUser } from '@/server/authz';
import { normalizePhone } from '@/server/lib/phone';
import { rateLimit } from '@/server/lib/rate-limit';
import { ensureCustomerWallet, refreshWalletCaches } from '@/server/lib/wallet-ledger';
import { writeAudit } from '@/server/lib/audit';
import { toCents } from '@/server/lib/money';

async function requireCustomerOrAdmin() {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (auth.user.role !== 'CUSTOMER' && auth.user.role !== 'ADMIN') {
    return { ok: false as const, response: error('Forbidden', 403) };
  }
  return auth;
}

export async function GET(request: Request) {
  const auth = await requireCustomerOrAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const targetUserId =
    auth.user.role === 'ADMIN' && url.searchParams.get('userId')
      ? url.searchParams.get('userId')!
      : auth.user.id;

  if (auth.user.role === 'CUSTOMER' && targetUserId !== auth.user.id) {
    return error('Forbidden', 403);
  }

  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) return error('User not found', 404);
  if (auth.user.role === 'ADMIN' && target.role !== 'CUSTOMER') {
    return error('Admin wallet lookup is limited to customer accounts', 400);
  }

  const wallet = await ensureCustomerWallet(targetUserId);
  await refreshWalletCaches(wallet.id);

  const fresh = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
  const [transactions, methods, attempts, refunds] = await Promise.all([
    prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.paymentMethodReference.findMany({
      where: { userId: targetUserId, active: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.paymentAttempt.findMany({
      where: { userId: targetUserId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.refund.findMany({
      where: { walletTransaction: { walletId: wallet.id } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  return json({
    wallet: {
      id: fresh.id,
      currency: fresh.currency,
      availableCents: fresh.availableCents,
      pendingCents: fresh.pendingCents,
    },
    transactions,
    paymentMethods: methods,
    paymentAttempts: attempts,
    refunds,
    rechargeMethods: [
      { id: 'MTN_MOMO', label: 'MTN MoMo', status: 'Integration pending' },
      { id: 'ORANGE_MONEY', label: 'Orange Money', status: 'Integration pending' },
      { id: 'CARD', label: 'Debit or credit card', status: 'Unavailable in development' },
    ],
    securityNotice:
      'JUSTGO never collects or stores full card numbers, CVV codes, or mobile-money PINs. Card payments must use a PCI-compliant hosted provider. Wallet balances change only through verified server-side ledger entries.',
  });
}

export async function POST(request: Request) {
  const limited = rateLimit(request, 'wallet-recharge', 15, 15 * 60_000);
  if (!limited.ok) {
    return error(`Too many recharge attempts. Retry in ${limited.retryAfterSec}s`, 429);
  }

  const auth = await requireUser(['CUSTOMER']);
  if (!auth.ok) return auth.response;

  try {
    const body = z
      .object({
        amountLd: z.union([z.number(), z.string()]),
        method: z.enum(['MTN_MOMO', 'ORANGE_MONEY', 'CARD']),
        momoPhone: z.string().optional(),
        idempotencyKey: z.string().min(8).max(80).optional(),
      })
      .parse(await readJson(request));

    const amountCents = toCents(body.amountLd);
    if (amountCents < 100) return error('Minimum recharge is L$1.00', 400);

    if (body.method === 'MTN_MOMO' || body.method === 'ORANGE_MONEY') {
      if (!body.momoPhone) return error('Mobile-money telephone number is required', 400);
      normalizePhone(body.momoPhone);
    }

    const wallet = await ensureCustomerWallet(auth.user.id);
    const idempotencyKey =
      body.idempotencyKey || `recharge:${auth.user.id}:${randomBytes(8).toString('hex')}`;

    const provider =
      body.method === 'MTN_MOMO'
        ? 'MTN_MOMO'
        : body.method === 'ORANGE_MONEY'
          ? 'ORANGE_MONEY'
          : 'CARD_HOSTED';

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.paymentAttempt.findUnique({ where: { idempotencyKey } });
      if (existing) return { attempt: existing, duplicate: true };

      const ledger = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'RECHARGE',
          amountCents,
          currency: 'LRD',
          status: 'PENDING',
          provider,
          description: `Recharge via ${body.method} (awaiting provider confirmation)`,
          idempotencyKey: `tx:${idempotencyKey}`,
          createdById: auth.user.id,
        },
      });

      const attempt = await tx.paymentAttempt.create({
        data: {
          walletId: wallet.id,
          userId: auth.user.id,
          amountCents,
          currency: 'LRD',
          method: body.method,
          provider,
          status: 'PENDING',
          momoPhone: body.momoPhone ? normalizePhone(body.momoPhone) : null,
          idempotencyKey,
          walletTxId: ledger.id,
          failureReason:
            'Payment provider integration pending — balance will not increase until a verified server-side callback succeeds.',
        },
      });

      const pending = await tx.walletTransaction.aggregate({
        where: { walletId: wallet.id, status: 'PENDING', type: { in: ['RECHARGE', 'REFUND'] } },
        _sum: { amountCents: true },
      });
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { pendingCents: pending._sum.amountCents ?? 0 },
      });

      return { attempt, duplicate: false };
    });

    await writeAudit({
      actorId: auth.user.id,
      action: 'WALLET_RECHARGE_ATTEMPT',
      entityType: 'PaymentAttempt',
      entityId: result.attempt.id,
      metadata: { method: body.method, amountCents, status: 'PENDING' },
    });

    return json(
      {
        ok: true,
        status: 'PENDING',
        message:
          'Recharge recorded as pending. Payment methods are integration-pending in development. The wallet balance will not increase until an approved payment-provider callback confirms payment.',
        attempt: {
          id: result.attempt.id,
          status: result.attempt.status,
          amountCents: result.attempt.amountCents,
          method: result.attempt.method,
        },
      },
      202,
    );
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Invalid recharge request', 400);
  }
}
