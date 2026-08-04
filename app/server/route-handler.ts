import type { Role } from '@prisma/client';
import { requireAdmin, requireUser } from '@/server/authz';
import { error } from '@/server/http';
import { getSessionUser } from '@/server/session';

type User = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

function message(err: unknown) {
  return err instanceof Error ? err.message : 'Invalid request';
}

export async function withUser(
  role: Role,
  work: (user: User) => Promise<Response>,
): Promise<Response> {
  try {
    const auth = await requireUser([role]);
    if (!auth.ok) return auth.response;
    return await work(auth.user);
  } catch (err) {
    return error(message(err), 400);
  }
}

export async function withAdmin(
  request: Request,
  work: (user: User) => Promise<Response>,
): Promise<Response> {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    return await work(auth.user);
  } catch (err) {
    return error(message(err), 400);
  }
}
