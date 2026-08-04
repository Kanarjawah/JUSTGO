import type { PaymentProvider, Prisma, WalletTxStatus, WalletTxType } from '@prisma/client';
import { prisma } from '../db';
import { addCents, subCents } from './money';
import { ensureUserWallet, generatePublicWalletReference } from './create-user-with-wallet';

const CREDIT_TYPES: WalletTxType[] = [
  'RECHARGE',
  'REFUND',
  'SERVICE_EARNING',
  'MERCHANT_SETTLEMENT',
  'TIP',
];
const DEBIT_TYPES: WalletTxType[] = [
  'PURCHASE',
  'PLATFORM_FEE',
  'TAX',
  'WITHDRAWAL',
  'WITHDRAWAL_FEE',
  'REVERSAL',
];

/** Ledger-derived available balance minus ACTIVE holds. */
export async function computeAvailableCents(walletId: string, tx: Prisma.TransactionClient = prisma) {
  const rows = await tx.walletTransaction.findMany({
    where: { walletId, status: 'COMPLETED' },
    select: { type: true, amountCents: true },
  });
  let balance = 0;
  for (const row of rows) {
    if (row.type === 'ADJUSTMENT') {
      balance = addCents(balance, row.amountCents);
    } else if (CREDIT_TYPES.includes(row.type)) {
      balance = addCents(balance, row.amountCents);
    } else if (DEBIT_TYPES.includes(row.type)) {
      balance = subCents(balance, row.amountCents);
    }
  }
  const holds = await tx.walletHold.aggregate({
    where: { walletId, status: 'ACTIVE' },
    _sum: { amountCents: true },
  });
  return subCents(balance, holds._sum.amountCents ?? 0);
}

export async function computePendingCents(walletId: string, tx: Prisma.TransactionClient = prisma) {
  const rows = await tx.walletTransaction.findMany({
    where: { walletId, status: 'PENDING', type: { in: ['RECHARGE', 'REFUND'] } },
    select: { amountCents: true },
  });
  return rows.reduce((s, r) => addCents(s, r.amountCents), 0);
}

export async function computeHeldCents(walletId: string, tx: Prisma.TransactionClient = prisma) {
  const holds = await tx.walletHold.aggregate({
    where: { walletId, status: 'ACTIVE' },
    _sum: { amountCents: true },
  });
  return holds._sum.amountCents ?? 0;
}

export async function refreshWalletCaches(walletId: string, tx: Prisma.TransactionClient = prisma) {
  const [availableCents, pendingCents, heldCents] = await Promise.all([
    computeAvailableCents(walletId, tx),
    computePendingCents(walletId, tx),
    computeHeldCents(walletId, tx),
  ]);
  return tx.wallet.update({
    where: { id: walletId },
    data: { availableCents, pendingCents, heldCents },
  });
}

/** @deprecated use ensureUserWallet — kept for call-site compatibility */
export async function ensureCustomerWallet(userId: string) {
  return ensureUserWallet(userId);
}

type LedgerInput = {
  walletId: string;
  type: WalletTxType;
  amountCents: number;
  description: string;
  idempotencyKey: string;
  provider?: PaymentProvider;
  providerReference?: string;
  relatedRideId?: string;
  relatedDeliveryId?: string;
  createdById?: string;
  status?: WalletTxStatus;
  allowNegative?: boolean;
};

export async function appendLedgerEntry(input: LedgerInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.walletTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return { transaction: existing, duplicate: true as const };

    if (input.provider && input.providerReference) {
      const byProvider = await tx.walletTransaction.findFirst({
        where: { provider: input.provider, providerReference: input.providerReference },
      });
      if (byProvider) return { transaction: byProvider, duplicate: true as const };
    }

    const status = input.status ?? 'COMPLETED';
    const amountForStore =
      input.type === 'ADJUSTMENT' ? input.amountCents : Math.abs(input.amountCents);

    const isDebit =
      DEBIT_TYPES.includes(input.type) ||
      (input.type === 'ADJUSTMENT' && amountForStore < 0);

    if (status === 'COMPLETED' && isDebit) {
      const available = await computeAvailableCents(input.walletId, tx);
      const debit = input.type === 'ADJUSTMENT' ? Math.abs(amountForStore) : amountForStore;
      if (!input.allowNegative && available < debit) {
        throw new Error('Insufficient wallet funds');
      }
    }

    const transaction = await tx.walletTransaction.create({
      data: {
        walletId: input.walletId,
        type: input.type,
        amountCents: amountForStore,
        currency: 'LRD',
        status,
        provider: input.provider,
        providerReference: input.providerReference,
        description: input.description,
        relatedRideId: input.relatedRideId,
        relatedDeliveryId: input.relatedDeliveryId,
        idempotencyKey: input.idempotencyKey,
        createdById: input.createdById,
        completedAt: status === 'COMPLETED' ? new Date() : null,
      },
    });

    await refreshWalletCaches(input.walletId, tx);
    return { transaction, duplicate: false as const };
  });
}

export async function placeHold(params: {
  walletId: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
  withdrawalRequestId?: string;
}) {
  if (params.amountCents <= 0) throw new Error('Hold amount must be positive');
  return prisma.$transaction(async (tx) => {
    const existing = await tx.walletHold.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
    if (existing) return existing;
    const available = await computeAvailableCents(params.walletId, tx);
    if (available < params.amountCents) throw new Error('Insufficient wallet funds');
    const hold = await tx.walletHold.create({
      data: {
        walletId: params.walletId,
        amountCents: params.amountCents,
        reason: params.reason,
        idempotencyKey: params.idempotencyKey,
        withdrawalRequestId: params.withdrawalRequestId,
        status: 'ACTIVE',
      },
    });
    await refreshWalletCaches(params.walletId, tx);
    return hold;
  });
}

export async function releaseHold(holdId: string) {
  return prisma.$transaction(async (tx) => {
    const hold = await tx.walletHold.findUnique({ where: { id: holdId } });
    if (!hold) throw new Error('Hold not found');
    if (hold.status !== 'ACTIVE') return hold;
    const updated = await tx.walletHold.update({
      where: { id: holdId },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
    await refreshWalletCaches(hold.walletId, tx);
    return updated;
  });
}

export async function captureHold(holdId: string) {
  return prisma.$transaction(async (tx) => {
    const hold = await tx.walletHold.findUnique({ where: { id: holdId } });
    if (!hold) throw new Error('Hold not found');
    if (hold.status !== 'ACTIVE') return hold;
    const updated = await tx.walletHold.update({
      where: { id: holdId },
      data: { status: 'CAPTURED', capturedAt: new Date() },
    });
    await refreshWalletCaches(hold.walletId, tx);
    return updated;
  });
}

export { generatePublicWalletReference, ensureUserWallet, CREDIT_TYPES, DEBIT_TYPES };
