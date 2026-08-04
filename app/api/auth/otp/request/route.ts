import { z } from 'zod';
import { error, json, readJson } from '@/server/http';
import { normalizePhone } from '@/server/lib/phone';
import { rateLimit } from '@/server/lib/rate-limit';
import { issueOtp } from '@/server/lib/otp';

export async function POST(request: Request) {
  const limited = rateLimit(request, 'otp-request', 10, 15 * 60_000);
  if (!limited.ok) {
    return error(`Too many OTP requests. Retry in ${limited.retryAfterSec}s`, 429);
  }

  try {
    const body = z.object({ phone: z.string() }).parse(await readJson(request));
    const phone = normalizePhone(body.phone);
    const result = await issueOtp(phone);
    // OTP is never included in the response body.
    return json({ ok: true, expiresInSeconds: result.expiresInSeconds });
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 400;
    return error(err instanceof Error ? err.message : 'Invalid phone number', status);
  }
}
