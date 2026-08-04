import type { PaymentProvider, Prisma, WalletTxStatus, WalletTxType } from '@prisma/client';
import { prisma } from '../db';
import { addCents, subCents } from './money';

const CREDIT_TYPES: WalletTxType[] = ['RECHARGE', 'REFUND', 'ADJUSTMENT'];
const DEBIT_TYPES: WalletTxType[] = ['PURCHASE', 'REVERSAL'];

function signedAmount(type: WalletTxType, amountCents: number): number {
  if (amountCents < 0) throw new Error('Amount must be non-negative');
  if (CREDIT_TYPES.includes(type)) return amountCents;
  if (DEBIT_TYPES.includes(type)) return -amountCents;
  // ADJUSTMENT can be signed via amountCents with type ADJUSTMENT and explicit sign in amount
  return amountCents;
}

/** Derive available balance from COMPLETED ledger rows (authoritative). */
export async function computeAvailableCents(walletId: string, tx: Prisma.TransactionClient = prisma) {
  const rows = await tx.walletTransaction.findMany({
    where: { walletId, status: 'COMPLETED' },
    select: { type: true, amountCents: true },
  });
  let balance = 0;
  for (const row of rows) {
    if (row.type === 'ADJUSTMENT') {
      // Adjustments store signed cents in amountCents (positive credit, negative debit)
      balance = addCents(balance, row.amountCents);
    } else if (CREDIT_TYPES.includes(row.type)) {
      balance = addCents(balance, row.amountCents);
    } else if (DEBIT_TYPES.includes(row.type)) {
      balance = subCents(balance, row.amountCents);
    }
  }
  return balance;
}

export async function computePendingCents(walletId: string, tx: Prisma.TransactionClient = prisma) {
  const rows = await tx.walletTransaction.findMany({
    where: { walletId, status: 'PENDING', type: { in: ['RECHARGE', 'REFUND'] } },
    select: { amountCents: true },
  });
  return rows.reduce((s, r) => addCents(s, r.amountCents), 0);
}

export async function refreshWalletCaches(walletId: string, tx: Prisma.TransactionClient = prisma) {
  const [availableCents, pendingCents] = await Promise.all([
    computeAvailableCents(walletId, tx),
    computePendingCents(walletId, tx),
  ]);
  return tx.wallet.update({
    where: { id: walletId },
    data: { availableCents, pendingCents },
  });
}

export async function ensureCustomerWallet(userId: string) {
  return prisma.wallet.upsert({
    where: { userId_currency: { userId, currency: 'LRD' } },
    create: { userId, currency: 'LRD', availableCents: 0, pendingCents: 0 },
    update: {},
  });
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

/**
 * Append an immutable ledger entry and refresh cached balances inside a DB transaction.
 * COMPLETED debits reject when funds are insufficient unless allowNegative is set.
 */
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

    if (status === 'COMPLETED' && (input.type === 'PURCHASE' || (input.type === 'ADJUSTMENT' && amountForStore < 0) || input.type === 'REVERSAL')) {
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

export { signedAmount };
