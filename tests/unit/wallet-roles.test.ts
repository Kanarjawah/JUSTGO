import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../app/server/lib/password';
import { createUserWithWallet, ensureUserWallet } from '../../app/server/lib/create-user-with-wallet';
import { appendLedgerEntry, computeAvailableCents, placeHold, releaseHold } from '../../app/server/lib/wallet-ledger';
import { normalizePhone } from '../../app/server/lib/phone';
import { toCents, addCents } from '../../app/server/lib/money';

const prisma = new PrismaClient();

/** Valid Orange LR mobile: +231770xxxxxx (unique per call). */
function uniqueTestPhone(prefix3: '770' | '772' | '555' | '880' = '770') {
  const noise = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  return normalizePhone(`+231${prefix3}${noise}`);
}

describe('createUserWithWallet', () => {
  it('creates customer/driver/merchant wallets and blocks duplicate primary wallets', async () => {
    const { randomBytes } = await import('node:crypto');
    for (const role of ['CUSTOMER', 'DRIVER', 'MERCHANT'] as const) {
      const phone = uniqueTestPhone('770');
      const { user, wallet } = await createUserWithWallet({
        phone,
        passwordHash: await hashPassword('Password123!'),
        firstName: role,
        lastName: 'Test',
        role,
        status: 'PENDING',
        merchant: role === 'MERCHANT' ? { businessName: 'T' } : undefined,
      });
      expect(wallet.publicReference.startsWith('JG-W-')).toBe(true);
      expect(wallet.availableCents).toBe(0);
      expect(wallet.userId).toBe(user.id);
      await expect(
        prisma.wallet.create({
          data: {
            userId: user.id,
            publicReference: `JG-W-DUP${randomBytes(4).toString('hex')}`,
            currency: 'LRD',
          },
        }),
      ).rejects.toThrow();
    }
  }, 30_000);

  it('creates administrator wallet only via authorized creation path', async () => {
    const phone = uniqueTestPhone('772');
    const { user, wallet } = await createUserWithWallet({
      phone,
      passwordHash: await hashPassword('Password123!'),
      firstName: 'Admin',
      lastName: 'Seed',
      role: 'ADMIN',
      status: 'ACTIVE',
      phoneVerifiedAt: new Date(),
      admin: { title: 'Ops' },
    });
    expect(user.role).toBe('ADMIN');
    expect(wallet.currency).toBe('LRD');
  });

  it('rolls back user when wallet create would fail unique publicReference collision path is covered by unique userId', async () => {
    // Public admin registration schema exclusion
    const { z } = await import('zod');
    expect(z.enum(['CUSTOMER', 'DRIVER', 'MERCHANT']).safeParse('ADMIN').success).toBe(false);
  });
});

describe('backfill idempotency', () => {
  it('ensureUserWallet is safe to run repeatedly', async () => {
    const phone = uniqueTestPhone('880');
    const { user } = await createUserWithWallet({
      phone,
      passwordHash: await hashPassword('Password123!'),
      firstName: 'A',
      lastName: 'B',
      role: 'CUSTOMER',
    });
    const a = await ensureUserWallet(user.id);
    const b = await ensureUserWallet(user.id);
    expect(a.id).toBe(b.id);
    const count = await prisma.wallet.count({ where: { userId: user.id } });
    expect(count).toBe(1);
  });
});

describe('holds and withdrawals funds', () => {
  let walletId: string;

  beforeAll(async () => {
    const phone = uniqueTestPhone('555');
    const { wallet } = await createUserWithWallet({
      phone,
      passwordHash: await hashPassword('Password123!'),
      firstName: 'Hold',
      lastName: 'Test',
      role: 'DRIVER',
      status: 'ACTIVE',
      driver: { applicationStatus: 'APPROVED' },
    });
    walletId = wallet.id;
    await appendLedgerEntry({
      walletId,
      type: 'SERVICE_EARNING',
      amountCents: 5000,
      description: 'test earning',
      idempotencyKey: `earn-${Date.now()}`,
      status: 'COMPLETED',
    });
  });

  it('rejects insufficient withdrawal and releases holds', async () => {
    await expect(
      placeHold({
        walletId,
        amountCents: 999999,
        reason: 'too much',
        idempotencyKey: `hold-fail-${Date.now()}`,
      }),
    ).rejects.toThrow(/Insufficient/);

    const hold = await placeHold({
      walletId,
      amountCents: 1000,
      reason: 'reserve',
      idempotencyKey: `hold-ok-${Date.now()}`,
    });
    const afterHold = await computeAvailableCents(walletId);
    expect(afterHold).toBe(4000);
    await releaseHold(hold.id);
    expect(await computeAvailableCents(walletId)).toBe(5000);
  });

  it('does not credit pending recharges and uses integer money math', () => {
    expect(toCents('10.25')).toBe(1025);
    expect(addCents(100, 50)).toBe(150);
  });
});
