import { randomInt } from 'node:crypto';
import { prisma } from '../db';
import { hashOtp } from './crypto';
import { sendOtpSms, SMS_USER_FAILURE } from './sms-notifications';
import { isOrangeSmsConfigured, isOrangeSmsMockMode } from '../../../integrations/orange-sms';

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;

const GENERIC_OTP_ISSUE_FAILURE = SMS_USER_FAILURE;
const GENERIC_OTP_VERIFY_FAILURE = 'Unable to verify the code. Please try again.';

function statusError(message: string, status: number): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

export async function issueOtp(phone: string, userId?: string) {
  const latest = await prisma.oTPVerification.findFirst({
    where: { phone },
    orderBy: { createdAt: 'desc' },
  });
  if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    throw statusError('Please wait before requesting another code', 429);
  }

  const code = String(randomInt(100000, 999999));
  await prisma.oTPVerification.create({
    data: {
      phone,
      userId: userId ?? null,
      codeHash: hashOtp(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  const sms = await sendOtpSms(phone, code);
  if (!sms.ok) {
    const allowLocalWithoutProvider =
      process.env.NODE_ENV !== 'production' && !isOrangeSmsConfigured() && !isOrangeSmsMockMode();
    if (!allowLocalWithoutProvider) {
      throw statusError(GENERIC_OTP_ISSUE_FAILURE, 503);
    }
    console.info('[JUSTGO OTP] SMS provider unavailable in local mode; code stored server-side only', {
      phoneLast4: phone.replace(/\D/g, '').slice(-4),
    });
  }

  if (process.env.NODE_ENV !== 'production') {
    console.info('[JUSTGO OTP] issued', {
      phoneLast4: phone.replace(/\D/g, '').slice(-4),
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      channel: isOrangeSmsMockMode() ? 'mock' : isOrangeSmsConfigured() ? 'orange' : 'local-store-only',
    });
  }

  return { expiresInSeconds: Math.floor(OTP_TTL_MS / 1000) };
}

export async function verifyOtpCode(phone: string, code: string) {
  const latest = await prisma.oTPVerification.findFirst({
    where: { phone, consumed: false },
    orderBy: { createdAt: 'desc' },
  });
  if (!latest) {
    throw statusError(GENERIC_OTP_VERIFY_FAILURE, 400);
  }
  if (latest.expiresAt.getTime() < Date.now()) {
    throw statusError('Verification code expired', 400);
  }
  if (latest.attempts >= MAX_ATTEMPTS) {
    throw statusError('Too many verification attempts', 429);
  }

  const ok = latest.codeHash === hashOtp(code);
  await prisma.oTPVerification.update({
    where: { id: latest.id },
    data: { attempts: { increment: 1 }, consumed: ok },
  });
  if (!ok) {
    throw statusError('Invalid verification code', 400);
  }
  return latest;
}

export const OTP_POLICY = {
  ttlMs: OTP_TTL_MS,
  resendCooldownMs: RESEND_COOLDOWN_MS,
  maxAttempts: MAX_ATTEMPTS,
};
