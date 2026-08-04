import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { error, json, readJson } from '@/server/http';
import { requireUser } from '@/server/authz';
import { toCents } from '@/server/lib/money';
import {
  computeAvailableCents,
  ensureUserWallet,
  refreshWalletCaches,
} from '@/server/lib/wallet-ledger';
import { writeAudit } from '@/server/lib/audit';

const MIN_CENTS = 1000;
const MAX_CENTS = 50_000_000;
const FEE_CENTS = 100;

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (auth.user.role === 'CUSTOMER') {
    return error('Customer wallets do not support withdrawals', 403);
  }

  try {
    const body = z
      .object({
        amountLd: z.union([z.number(), z.string()]),
        payoutDestinationId: z.string(),
        idempotencyKey: z.string().min(8).max(80).optional(),
        stepUpConfirmed: z.boolean().optional(),
      })
      .parse(await readJson(request));

    if (auth.user.role === 'ADMIN' && !body.stepUpConfirmed) {
      return error('Administrator withdrawals require step-up verification confirmation', 403);
    }

    const amountCents = toCents(body.amountLd);
    if (amountCents < MIN_CENTS) return error(`Minimum withdrawal is L$${(MIN_CENTS / 100).toFixed(2)}`, 400);
    if (amountCents > MAX_CENTS) return error('Amount exceeds maximum withdrawal limit', 400);

    const user = await prisma.user.findUnique({
      where: { id: auth.user.id },
      include: { driverProfile: true, merchantProfile: true },
    });
    if (!user) return error('User not found', 404);
    if (user.role === 'DRIVER' && user.driverProfile?.applicationStatus !== 'APPROVED') {
      return error('Driver payouts are blocked until the account is approved', 403);
    }
    if (user.role === 'MERCHANT' && user.merchantProfile?.applicationStatus !== 'APPROVED') {
      return error('Merchant payouts are blocked until the account is approved', 403);
    }

    const wallet = await ensureUserWallet(auth.user.id);
    const dest = await prisma.payoutDestination.findFirst({
      where: {
        id: body.payoutDestinationId,
        userId: auth.user.id,
        active: true,
        verificationStatus: 'VERIFIED',
      },
    });
    if (!dest) return error('Verified payout destination required', 400);
    if (dest.changeCooloffUntil && dest.changeCooloffUntil > new Date()) {
      return error('Payout destination is in cool-off after a recent change', 403);
    }

    const totalDebit = amountCents + FEE_CENTS;
    const available = await computeAvailableCents(wallet.id);
    if (available < totalDebit) {
      return error('Insufficient available funds (pending/held balances cannot be withdrawn)', 400);
    }

    const idempotencyKey =
      body.idempotencyKey || `wd:${auth.user.id}:${randomBytes(8).toString('hex')}`;

    const existing = await prisma.withdrawalRequest.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return json({ withdrawal: existing, duplicate: true });
    }

    const withdrawal = await prisma.$transaction(async (tx) => {
      const wd = await tx.withdrawalRequest.create({
        data: {
          walletId: wallet.id,
          amountCents,
          feeCents: FEE_CENTS,
          currency: 'LRD',
          payoutDestinationId: dest.id,
          provider: dest.provider,
          status: auth.user.role === 'ADMIN' || amountCents >= 100_000 ? 'UNDER_REVIEW' : 'PENDING',
          idempotencyKey,
          requestedById: auth.user.id,
        },
      });

      await tx.walletHold.create({
        data: {
          walletId: wallet.id,
          amountCents: totalDebit,
          reason: `Withdrawal reserve ${wd.id}`,
          idempotencyKey: `hold:${idempotencyKey}`,
          withdrawalRequestId: wd.id,
          status: 'ACTIVE',
        },
      });
      await refreshWalletCaches(wallet.id, tx);
      return wd;
    });

    await writeAudit({
      actorId: auth.user.id,
      action: 'WITHDRAWAL_REQUESTED',
      entityType: 'WithdrawalRequest',
      entityId: withdrawal.id,
      metadata: { amountCents, feeCents: FEE_CENTS, status: withdrawal.status },
    });

    return json(
      {
        ok: true,
        withdrawal: {
          id: withdrawal.id,
          status: withdrawal.status,
          amountCents: withdrawal.amountCents,
          feeCents: withdrawal.feeCents,
        },
        message:
          'Withdrawal request accepted and funds reserved. Completion requires verified payout-provider confirmation — requests stay pending/under review until providers are connected. Completion is never faked.',
      },
      202,
    );
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Invalid withdrawal', 400);
  }
}

/** Reject/cancel own pending withdrawal and release hold — no fake completion. */
export async function DELETE(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return error('id required', 400);

  const wd = await prisma.withdrawalRequest.findFirst({
    where: { id, requestedById: auth.user.id },
    include: { hold: true },
  });
  if (!wd) return error('Not found', 404);
  if (!['PENDING', 'UNDER_REVIEW'].includes(wd.status)) {
    return error('Only pending/under-review withdrawals can be canceled', 400);
  }

  await prisma.$transaction(async (tx) => {
    await tx.withdrawalRequest.update({
      where: { id: wd.id },
      data: { status: 'CANCELED', completedAt: new Date() },
    });
    if (wd.hold && wd.hold.status === 'ACTIVE') {
      await tx.walletHold.update({
        where: { id: wd.hold.id },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });
      await refreshWalletCaches(wd.walletId, tx);
    }
  });

  await writeAudit({
    actorId: auth.user.id,
    action: 'WITHDRAWAL_CANCELED',
    entityType: 'WithdrawalRequest',
    entityId: wd.id,
  });

  return json({ ok: true, status: 'CANCELED' });
}
