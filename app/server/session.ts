import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from './db';

const COOKIE = 'justgo_session';

function sign(value: string): string {
  const secret = process.env.SESSION_SECRET || 'dev-session-secret';
  const mac = createHmac('sha256', secret).update(value).digest('hex');
  return `${value}.${mac}`;
}

function verify(token: string): string | null {
  const [value, mac] = token.split('.');
  if (!value || !mac) return null;
  const expected = sign(value).split('.')[1];
  try {
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return value;
  } catch {
    return null;
  }
}

export async function setSessionUserId(userId: string) {
  const jar = await cookies();
  jar.set(COOKIE, sign(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 8,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSessionUser() {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;
  const userId = verify(raw);
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status === 'DEACTIVATED' || user.status === 'SUSPENDED') return null;
  return {
    id: user.id,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    status: user.status,
  };
}

/**
 * Temporary development Admin guard.
 * In production, Admin routes additionally require ADMIN_DEV_GUARD_SECRET to match
 * the x-justgo-admin-guard header or ADMIN_DEV_GUARD_SECRET cookie — until a full
 * operator auth system replaces this. Without the secret configured, Admin API
 * stays locked outside development.
 */
export function assertAdminDevGuard(request: Request): { ok: true } | { ok: false; status: number; error: string } {
  const roleGuardSecret = process.env.ADMIN_DEV_GUARD_SECRET;
  if (process.env.NODE_ENV !== 'production') {
    return { ok: true };
  }
  if (!roleGuardSecret) {
    return {
      ok: false,
      status: 403,
      error: 'Admin access is locked. Configure ADMIN_DEV_GUARD_SECRET for temporary development access.',
    };
  }
  const header = request.headers.get('x-justgo-admin-guard');
  if (header !== roleGuardSecret) {
    return { ok: false, status: 403, error: 'Admin guard failed' };
  }
  return { ok: true };
}
