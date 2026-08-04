import type { NextResponse } from 'next/server';
import type { Role } from '@prisma/client';
import { getSessionUser, assertAdminDevGuard } from './session';
import { error } from './http';

type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

type AuthOk = { ok: true; user: SessionUser };
type AuthFail = { ok: false; response: NextResponse };

export async function requireUser(roles?: Role[]): Promise<AuthOk | AuthFail> {
  const user = await getSessionUser();
  if (!user) return { ok: false, response: error('Authentication required', 401) };
  if (roles && !roles.includes(user.role)) {
    return { ok: false, response: error('Forbidden', 403) };
  }
  return { ok: true, user };
}

export async function requireAdmin(request: Request): Promise<AuthOk | AuthFail> {
  const guard = assertAdminDevGuard(request);
  if (!guard.ok) return { ok: false, response: error(guard.error, guard.status) };
  return requireUser(['ADMIN']);
}
