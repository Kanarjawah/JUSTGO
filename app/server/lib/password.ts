import bcrypt from 'bcryptjs';
import { PASSWORD_TOO_SHORT } from '@/src/lib/auth-messages';

const BCRYPT_ROUNDS = 12;

/** Strong password: min 10 chars, upper, lower, digit, special. */
export function assertStrongPassword(password: string): void {
  if (password.length < 10) {
    throw new Error(PASSWORD_TOO_SHORT);
  }
  if (!/[a-z]/.test(password)) {
    throw new Error('Password must include a lowercase letter');
  }
  if (!/[A-Z]/.test(password)) {
    throw new Error('Password must include an uppercase letter');
  }
  if (!/[0-9]/.test(password)) {
    throw new Error('Password must include a digit');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    throw new Error('Password must include a special character');
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertStrongPassword(password);
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export function isBcryptHash(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(value);
}
