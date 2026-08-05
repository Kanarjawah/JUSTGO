import { z } from 'zod';
import { prisma } from '@/server/db';
import { error, json, readJson } from '@/server/http';
import { normalizePhone } from '@/server/lib/phone';
import { rateLimitOtpVerify } from '@/server/lib/rate-limit';
import { verifyOtpCode } from '@/server/lib/otp';
import { writeAudit } from '@/server/lib/audit';
import { setSessionUserId } from '@/server/session';

export async function POST(request: Request) {
  try {
    const body = z
      .object({ phone: z.string(), code: z.string().min(4).max(10) })
      .parse(await readJson(request));
    const phone = normalizePhone(body.phone);

    const existingUser = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
    const limited = rateLimitOtpVerify({ request, phone, userId: existingUser?.id });
    if (!limited.ok) {
      return error(`Too many verification attempts. Retry in ${limited.retryAfterSec}s`, 429);
    }

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
    const message = err instanceof Error ? err.message : 'Verification failed';
    if (
      message.toLowerCase().includes('phone') ||
      message.toLowerCase().includes('landline') ||
      message.toLowerCase().includes('unsupported')
    ) {
      return error(message, 400);
    }
    // Safe messages only — never Orange bodies or stack traces.
    if (status === 429) return error(message, status);
    if (message === 'Verification code expired' || message === 'Invalid verification code') {
      return error(message, status);
    }
    return error('Unable to verify the code. Please try again.', status);
  }
}
