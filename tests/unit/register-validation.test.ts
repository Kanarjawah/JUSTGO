import { describe, expect, it } from 'vitest';
import {
  fieldErrorsFromZod,
  firstRegisterErrorMessage,
  looksLikeInternalErrorPayload,
  registerSchema,
} from '../../app/server/lib/register-validation';
import {
  CONFIRM_PASSWORD_TOO_SHORT,
  PASSWORD_TOO_SHORT,
  PASSWORDS_MISMATCH,
} from '../../app/src/lib/auth-messages';
import { assertStrongPassword } from '../../app/server/lib/password';

describe('registration password validation messages', () => {
  const base = {
    fullName: 'Test User',
    phone: '+231770000099',
    email: '',
    accountType: 'CUSTOMER' as const,
    acceptTerms: true as const,
  };

  it('returns friendly password length messages instead of raw Zod JSON', () => {
    const result = registerSchema.safeParse({
      ...base,
      password: 'Short1!',
      confirmPassword: 'Short1!',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fields = fieldErrorsFromZod(result.error);
    expect(fields.password).toBe(PASSWORD_TOO_SHORT);
    expect(JSON.stringify(fields)).not.toContain('"code"');
    expect(firstRegisterErrorMessage(fields)).toBe(PASSWORD_TOO_SHORT);
    expect(looksLikeInternalErrorPayload(result.error.message)).toBe(true);
  });

  it('returns confirm-password length and mismatch messages', () => {
    const shortConfirm = registerSchema.safeParse({
      ...base,
      password: 'Password123!',
      confirmPassword: 'Short1!',
    });
    expect(shortConfirm.success).toBe(false);
    if (!shortConfirm.success) {
      const fields = fieldErrorsFromZod(shortConfirm.error);
      expect(fields.confirmPassword).toBe(CONFIRM_PASSWORD_TOO_SHORT);
    }

    const mismatch = registerSchema.safeParse({
      ...base,
      password: 'Password123!',
      confirmPassword: 'Password124!',
    });
    expect(mismatch.success).toBe(false);
    if (!mismatch.success) {
      const fields = fieldErrorsFromZod(mismatch.error);
      expect(fields.confirmPassword).toBe(PASSWORDS_MISMATCH);
    }
  });

  it('keeps strong password rules with the updated length message', () => {
    expect(() => assertStrongPassword('short')).toThrow(PASSWORD_TOO_SHORT);
    expect(() => assertStrongPassword('Password123!')).not.toThrow();
  });
});
