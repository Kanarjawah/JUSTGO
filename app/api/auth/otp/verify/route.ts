import { z } from 'zod';
import { prisma } from '@/server/db';
import { error, json, readJson } from '@/server/http';
import { normalizePhone } from '@/server/lib/phone';
import { rateLimit } from '@/server/lib/rate-limit';
import { verifyOtpCode } from '@/server/lib/otp';
import { writeAudit } from '@/server/lib/audit';
import { setSessionUserId } from '@/server/session';

export async function POST(request: Request) {
  const limited = rateLimit(request, 'otp-verify', 20, 15 * 60_000);
  if (!limited.ok) {
    return error(`Too many verification attempts. Retry in ${limited.retryAfterSec}s`, 429);
  }

  try {
    const body = z
      .object({ phone: z.string(), code: z.string().min(4).max(10) })
      .parse(await readJson(request));
    const phone = normalizePhone(body.phone);
    const otp = await verifyOtpCode(phone, body.code);

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) return error('Account not found for this phone', 404);

    const phoneVerifiedAt = new Date();
    let status = user.status;
    // Customers become ACTIVE after phone verification; Driver/Merchant stay PENDING for admin approval.
    if (user.role === 'CUSTOMER') {
      status = 'ACTIVE';
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { phoneVerifiedAt, status },
    });

    if (otp.userId && otp.userId !== user.id) {
      // ignore mismatch; phone is source of truth
    }

    await writeAudit({
      actorId: user.id,
      action: 'PHONE_VERIFIED',
      entityType: 'User',
      entityId: user.id,
    });

    if (updated.role === 'CUSTOMER' || updated.status === 'PENDING') {
      await setSessionUserId(updated.id);
    }

    const redirectTo =
      updated.role === 'ADMIN'
        ? '/admin'
        : updated.role === 'DRIVER'
          ? '/driver'
          : updated.role === 'MERCHANT'
            ? '/merchant'
            : '/customer';

    return json({
      ok: true,
      user: {
        id: updated.id,
        role: updated.role,
        firstName: updated.firstName,
        lastName: updated.lastName,
        phone: updated.phone,
        status: updated.status,
      },
      redirectTo,
    });
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 400;
    return error(err instanceof Error ? err.message : 'Verification failed', status);
  }
}
