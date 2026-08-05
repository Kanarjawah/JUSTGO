import { error, json } from '@/server/http';
import { requireUser } from '@/server/authz';
import { rateLimitOtpRequest } from '@/server/lib/rate-limit';
import { issueOtp } from '@/server/lib/otp';

/**
 * Authenticated OTP resend — bound to the session user's telephone number.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const phone = auth.user.phone;
  const limited = rateLimitOtpRequest({ request, phone, userId: auth.user.id });
  if (!limited.ok) {
    return error(`Too many OTP requests. Retry in ${limited.retryAfterSec}s`, 429);
  }

  try {
    const result = await issueOtp(phone, auth.user.id);
    return json({ ok: true, expiresInSeconds: result.expiresInSeconds });
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 503;
    const message = err instanceof Error ? err.message : 'Unable to send verification code. Please try again later.';
    if (status === 429) return error(message, status);
    return error('Unable to send verification code. Please try again later.', status >= 500 ? status : 503);
  }
}
