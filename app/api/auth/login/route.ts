import { z } from 'zod';
import { prisma } from '@/server/db';
import { normalizePhone } from '@/server/lib/phone';
import { setSessionUserId, getSessionUser } from '@/server/session';
import { writeAudit } from '@/server/lib/audit';
import { error, json, readJson } from '@/server/http';
import { rateLimit } from '@/server/lib/rate-limit';
import { verifyPassword } from '@/server/lib/password';

const GENERIC = 'Invalid credentials';

function dashboardFor(role: string) {
  if (role === 'ADMIN') return '/admin';
  if (role === 'DRIVER') return '/driver';
  if (role === 'MERCHANT') return '/merchant';
  return '/customer';
}

export async function POST(request: Request) {
  const limited = rateLimit(request, 'login', 20, 15 * 60_000);
  if (!limited.ok) {
    return error(`Too many login attempts. Retry in ${limited.retryAfterSec}s`, 429);
  }

  try {
    const body = z
      .object({ phone: z.string().min(7), password: z.string().min(1) })
      .parse(await readJson(request));

    let phone: string;
    try {
      phone = normalizePhone(body.phone);
    } catch {
      return error(GENERIC, 401);
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) return error(GENERIC, 401);
    if (user.lockedUntil && user.lockedUntil > new Date()) return error(GENERIC, 401);

    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) {
      const failed = user.failedLogins + 1;
      const lockedUntil =
        failed >= 5 ? new Date(Date.now() + Math.min(failed, 10) * 60 * 1000) : null;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: failed, lockedUntil },
      });
      return error(GENERIC, 401);
    }

    if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
      return error('Account not active', 403);
    }

    if (user.role === 'CUSTOMER' && !user.phoneVerifiedAt) {
      return error('Phone verification required before sign-in', 403);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null },
    });
    await setSessionUserId(user.id);
    await writeAudit({
      actorId: user.id,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
    });

    return json({
      user: {
        id: user.id,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        status: user.status,
      },
      redirectTo: dashboardFor(user.role),
      pendingAdminApproval: user.status === 'PENDING' && user.role !== 'CUSTOMER',
    });
  } catch {
    return error('Invalid request', 400);
  }
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return error('Authentication required', 401);
  return json({ user });
}
