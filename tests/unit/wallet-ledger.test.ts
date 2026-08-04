import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../app/server/lib/password';
import { ensureUserWallet } from '../../app/server/lib/create-user-with-wallet';
import { appendLedgerEntry, computeAvailableCents } from '../../app/server/lib/wallet-ledger';

const prisma = new PrismaClient();

describe('wallet ledger', () => {
  let userId: string;
  let walletId: string;

  beforeAll(async () => {
    const phone = `+23177${String(Date.now()).slice(-7)}`;
    const user = await prisma.user.create({
      data: {
        phone,
        passwordHash: await hashPassword('Password123!'),
        firstName: 'Wallet',
        lastName: 'Tester',
        role: 'CUSTOMER',
        status: 'ACTIVE',
        phoneVerifiedAt: new Date(),
        customerProfile: { create: {} },
      },
    });
    userId = user.id;
    const wallet = await ensureUserWallet(userId);
    walletId = wallet.id;
  });

  it('does not credit available balance for pending recharges', async () => {
    await prisma.walletTransaction.create({
      data: {
        walletId,
        type: 'RECHARGE',
        amountCents: 5000,
        status: 'PENDING',
        description: 'pending top-up',
        idempotencyKey: `pending-${Date.now()}`,
      },
    });
    const available = await computeAvailableCents(walletId);
    expect(available).toBe(0);
  });

  it('credits only completed ledger entries and rejects insufficient funds', async () => {
    await appendLedgerEntry({
      walletId,
      type: 'RECHARGE',
      amountCents: 2000,
      description: 'test credit',
      idempotencyKey: `credit-${Date.now()}`,
      provider: 'ADMIN_ADJUSTMENT',
      providerReference: `ref-credit-${Date.now()}`,
      status: 'COMPLETED',
    });
    expect(await computeAvailableCents(walletId)).toBe(2000);

    await expect(
      appendLedgerEntry({
        walletId,
        type: 'PURCHASE',
        amountCents: 5000,
        description: 'too much',
        idempotencyKey: `purchase-fail-${Date.now()}`,
        status: 'COMPLETED',
      }),
    ).rejects.toThrow(/Insufficient/);

    await appendLedgerEntry({
      walletId,
      type: 'PURCHASE',
      amountCents: 500,
      description: 'ok purchase',
      idempotencyKey: `purchase-ok-${Date.now()}`,
      status: 'COMPLETED',
    });
    expect(await computeAvailableCents(walletId)).toBe(1500);
  });

  it('is idempotent for duplicate provider references', async () => {
    const key = `idem-${Date.now()}`;
    const ref = `prov-${Date.now()}`;
    const first = await appendLedgerEntry({
      walletId,
      type: 'RECHARGE',
      amountCents: 100,
      description: 'dup test',
      idempotencyKey: key,
      provider: 'MTN_MOMO',
      providerReference: ref,
      status: 'COMPLETED',
    });
    const second = await appendLedgerEntry({
      walletId,
      type: 'RECHARGE',
      amountCents: 100,
      description: 'dup test',
      idempotencyKey: key,
      provider: 'MTN_MOMO',
      providerReference: ref,
      status: 'COMPLETED',
    });
    expect(second.duplicate).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
  });
});
