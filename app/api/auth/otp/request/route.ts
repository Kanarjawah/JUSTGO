import { z } from 'zod';
import { error, json, readJson } from '@/server/http';
import { normalizePhone } from '@/server/lib/phone';
import { rateLimitOtpRequest } from '@/server/lib/rate-limit';
import { issueOtp } from '@/server/lib/otp';
import { prisma } from '@/server/db';

/**
 * Public OTP request (registration / recovery).
 * Prefer POST /api/auth/otp/resend when the user already has a session.
 */
export async function POST(request: Request) {
  try {
    const body = z.object({ phone: z.string() }).parse(await readJson(request));
    const phone = normalizePhone(body.phone);
    const user = await prisma.user.findUnique({ where: { phone }, select: { id: true } });

    const limited = rateLimitOtpRequest({ request, phone, userId: user?.id });
    if (!limited.ok) {
      return error(`Too many OTP requests. Retry in ${limited.retryAfterSec}s`, 429);
    }

    const result = await issueOtp(phone, user?.id);
    return json({ ok: true, expiresInSeconds: result.expiresInSeconds });
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 400;
    const message = err instanceof Error ? err.message : 'Unable to send verification code. Please try again later.';
    if (status === 429) return error(message, status);
    if (
      message.toLowerCase().includes('phone') ||
      message.toLowerCase().includes('landline') ||
      message.toLowerCase().includes('unsupported')
    ) {
      return error(message, 400);
    }
    return error('Unable to send verification code. Please try again later.', status >= 500 ? status : 503);
  }
}
