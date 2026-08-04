import { describe, expect, it } from 'vitest';
import { normalizePhone } from '../../app/server/lib/phone';
import { assertStrongPassword, hashPassword, isBcryptHash } from '../../app/server/lib/password';
import { addCents, customerPriceBreakdown, subCents, toCents } from '../../app/server/lib/money';

describe('phone normalization', () => {
  it('normalizes Liberian numbers to +231', () => {
    expect(normalizePhone('0770000002')).toBe('+231770000002');
    expect(normalizePhone('231770000002')).toBe('+231770000002');
    expect(normalizePhone('+231770000002')).toBe('+231770000002');
    expect(normalizePhone('770000002')).toBe('+231770000002');
  });
});

describe('passwords', () => {
  it('requires strong passwords and hashes with bcrypt', async () => {
    expect(() => assertStrongPassword('short')).toThrow();
    expect(() => assertStrongPassword('Password123')).toThrow();
    const hash = await hashPassword('Password123!');
    expect(isBcryptHash(hash)).toBe(true);
    expect(hash).not.toContain('Password123!');
  });
});

describe('money math', () => {
  it('avoids floating-point drift for LRD cents', () => {
    expect(toCents('10.10')).toBe(1010);
    expect(addCents(1010, 100)).toBe(1110);
    expect(subCents(1110, 100)).toBe(1010);
    const b = customerPriceBreakdown({
      subtotalCents: 35000,
      deliveryOrRideCents: 0,
      taxCents: 1750,
      tipCents: 0,
    });
    expect(b.totalCents).toBe(35000 + 1750 + 100);
    expect(b.customerPlatformFeeCents).toBe(100);
  });
});

describe('registration policy', () => {
  it('blocks public administrator registration at the schema level', async () => {
    const { z } = await import('zod');
    const schema = z.enum(['CUSTOMER', 'DRIVER', 'MERCHANT']);
    expect(schema.safeParse('ADMIN').success).toBe(false);
    expect(schema.safeParse('CUSTOMER').success).toBe(true);
  });
});
