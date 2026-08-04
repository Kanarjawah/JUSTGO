import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { error, json, readJson } from '@/server/http';
import { requireUser } from '@/server/authz';
import { normalizePhone } from '@/server/lib/phone';
import { rateLimit } from '@/server/lib/rate-limit';
import { ensureUserWallet, refreshWalletCaches } from '@/server/lib/wallet-ledger';
import { writeAudit } from '@/server/lib/audit';
import { toCents } from '@/server/lib/money';

const WITHDRAWAL_MIN_CENTS = 1000; // L$10
const WITHDRAWAL_MAX_CENTS = 500_000_00; // L$500,000
const WITHDRAWAL_FEE_CENTS = 100; // L$1 platform fee display

async function requireAnyAuthenticated() {
  return requireUser();
}

function rolePurpose(role: string) {
  if (role === 'CUSTOMER') {
    return {
      canWithdraw: false,
      purposes: ['Recharge', 'Pay for rides/deliveries/fees/tips', 'Receive approved refunds'],
    };
  }
  if (role === 'DRIVER') {
    return {
      canWithdraw: true,
      purposes: ['Receive earnings', 'Receive 100% of tips', 'See L$1 driver fees', 'Withdraw to approved payout'],
    };
  }
  if (role === 'MERCHANT') {
    return {
      canWithdraw: true,
      purposes: ['Receive settlements', 'See fees/refunds/net', 'Withdraw to approved payout'],
    };
  }
  return {
    canWithdraw: true,
    purposes: ['Platform revenue only', 'Record platform fees', 'Authorized platform withdrawals'],
  };
}

export async function GET(request: Request) {
  const auth = await requireAnyAuthenticated();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const targetUserId =
    auth.user.role === 'ADMIN' && url.searchParams.get('userId')
      ? url.searchParams.get('userId')!
      : auth.user.id;

  if (auth.user.role !== 'ADMIN' && targetUserId !== auth.user.id) {
    return error('Forbidden', 403);
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: {
      driverProfile: true,
      merchantProfile: true,
    },
  });
  if (!target) return error('User not found', 404);

  const wallet = await ensureUserWallet(targetUserId);
  await refreshWalletCaches(wallet.id);
  const fresh = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });

  const [transactions, methods, attempts, refunds, destinations, withdrawals] = await Promise.all([
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
    prisma.payoutDestination.findMany({
      where: { userId: targetUserId, active: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.withdrawalRequest.findMany({
      where: { walletId: wallet.id },
      orderBy: { requestedAt: 'desc' },
      take: 20,
    }),
  ]);

  const mockEnabled =
    process.env.NODE_ENV !== 'production' && process.env.WALLET_MOCK_PROVIDER === 'true';

  const payoutBlocked =
    (target.role === 'DRIVER' && target.driverProfile?.applicationStatus !== 'APPROVED') ||
    (target.role === 'MERCHANT' && target.merchantProfile?.applicationStatus !== 'APPROVED');

  return json({
    wallet: {
      publicReference: fresh.publicReference,
      currency: fresh.currency,
      status: fresh.status,
      availableCents: fresh.availableCents,
      pendingCents: fresh.pendingCents,
      heldCents: fresh.heldCents,
    },
    role: target.role,
    rolePurpose: rolePurpose(target.role),
    payoutBlocked,
    transactions,
    paymentMethods: methods.map((m) => ({
      id: m.id,
      method: m.method,
      displayHint: m.displayHint,
      momoPhoneMasked: m.momoPhoneMasked,
    })),
    paymentAttempts: attempts,
    refunds,
    payoutDestinations: destinations.map((d) => ({
      id: d.id,
      type: d.type,
      accountHolderName: d.accountHolderName,
      displayHint: d.displayHint,
      verificationStatus: d.verificationStatus,
      currency: d.currency,
      country: d.country,
      changeCooloffUntil: d.changeCooloffUntil,
      // Never return encrypted account/phone payloads
    })),
    withdrawals,
    rechargeMethods: [
      { id: 'MTN_MOMO', label: 'MTN MoMo', status: 'Integration pending' },
      { id: 'ORANGE_MONEY', label: 'Orange Money', status: 'Integration pending' },
      { id: 'CARD', label: 'Hosted debit or credit card', status: 'Unavailable in development' },
    ],
    withdrawalLimits: {
      minCents: WITHDRAWAL_MIN_CENTS,
      maxCents: WITHDRAWAL_MAX_CENTS,
      feeCents: WITHDRAWAL_FEE_CENTS,
    },
    mockProviderEnabled: mockEnabled,
    securityNotice:
      'JUSTGO never stores mobile-money PINs, card CVVs, or card PINs. Balances change only through verified server-side ledger entries and provider callbacks. Cash recharge is not supported.',
  });
}

export async function POST(request: Request) {
  const limited = rateLimit(request, 'wallet-recharge', 15, 15 * 60_000);
  if (!limited.ok) {
    return error(`Too many recharge attempts. Retry in ${limited.retryAfterSec}s`, 429);
  }

  const auth = await requireAnyAuthenticated();
  if (!auth.ok) return auth.response;

  try {
    const body = z
      .object({
        amountLd: z.union([z.number(), z.string()]),
        method: z.enum(['MTN_MOMO', 'ORANGE_MONEY', 'CARD']),
        momoPhone: z.string().optional(),
        idempotencyKey: z.string().min(8).max(80).optional(),
        useMockProvider: z.boolean().optional(),
      })
      .parse(await readJson(request));

    const amountCents = toCents(body.amountLd);
    if (amountCents < 100) return error('Minimum recharge is L$1.00', 400);

    if (body.method === 'MTN_MOMO' || body.method === 'ORANGE_MONEY') {
      if (!body.momoPhone) return error('Mobile-money telephone number is required', 400);
      normalizePhone(body.momoPhone);
    }

    const mockEnabled =
      process.env.NODE_ENV !== 'production' && process.env.WALLET_MOCK_PROVIDER === 'true';
    if (body.useMockProvider && !mockEnabled) {
      return error('Mock provider is disabled', 403);
    }

    const wallet = await ensureUserWallet(auth.user.id);
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
            body.useMockProvider && mockEnabled
              ? null
              : 'Payment provider integration pending — balance will not increase until a verified server-side callback succeeds.',
        },
      });

      await refreshWalletCaches(wallet.id, tx);
      return { attempt, duplicate: false, ledger };
    });

    // Explicit mock-provider mode (dev only): credit via ledger as if callback succeeded.
    if (body.useMockProvider && mockEnabled && !result.duplicate) {
      const { appendLedgerEntry } = await import('@/server/lib/wallet-ledger');
      const ref = `mock:${result.attempt.id}`;
      await appendLedgerEntry({
        walletId: wallet.id,
        type: 'RECHARGE',
        amountCents,
        description: 'DEV MOCK provider-confirmed recharge — not a real payment',
        idempotencyKey: `provider:${ref}`,
        provider,
        providerReference: ref,
        createdById: auth.user.id,
        status: 'COMPLETED',
      });
      await prisma.paymentAttempt.update({
        where: { id: result.attempt.id },
        data: { status: 'SUCCEEDED', providerReference: ref, completedAt: new Date() },
      });
      await prisma.walletTransaction.update({
        where: { id: result.attempt.walletTxId! },
        data: { status: 'CANCELED', description: 'Superseded by mock-confirmed ledger entry' },
      });
      await writeAudit({
        actorId: auth.user.id,
        action: 'WALLET_MOCK_RECHARGE',
        entityType: 'PaymentAttempt',
        entityId: result.attempt.id,
        metadata: { amountCents, note: 'Development mock only' },
      });
      return json({
        ok: true,
        status: 'SUCCEEDED',
        message: 'DEV MOCK recharge credited. This is not a real payment.',
        attempt: { id: result.attempt.id, status: 'SUCCEEDED', amountCents },
      });
    }

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
          'Recharge recorded as pending. Integration pending until approved providers are connected. The wallet balance will not increase until a verified server-side callback confirms payment.',
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
