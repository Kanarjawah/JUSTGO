import { randomInt } from 'node:crypto';
import { prisma } from '../db';
import { hashOtp } from './crypto';
import { sendOrangeSms } from '../../../integrations/orange-sms';

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;

export async function issueOtp(phone: string, userId?: string) {
  const latest = await prisma.oTPVerification.findFirst({
    where: { phone },
    orderBy: { createdAt: 'desc' },
  });
  if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const err = new Error('Please wait before requesting another code');
    (err as Error & { status: number }).status = 429;
    throw err;
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

  const sms = await sendOrangeSms(phone, 'JUSTGO verification code');
  await prisma.smsDeliveryLog.create({
    data: {
      phone,
      status: sms.status,
      provider: sms.provider,
      message: sms.message,
    },
  });

  // Never return the OTP to browser clients — development only logs to the server terminal.
  if (process.env.NODE_ENV !== 'production') {
    console.info(`[JUSTGO OTP] phone=${phone} code=${code} (dev terminal only; expires in 5 minutes)`);
  }

  return { expiresInSeconds: Math.floor(OTP_TTL_MS / 1000) };
}

export async function verifyOtpCode(phone: string, code: string) {
  const latest = await prisma.oTPVerification.findFirst({
    where: { phone, consumed: false },
    orderBy: { createdAt: 'desc' },
  });
  if (!latest) {
    const err = new Error('No verification code found');
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  if (latest.expiresAt.getTime() < Date.now()) {
    const err = new Error('Verification code expired');
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  if (latest.attempts >= MAX_ATTEMPTS) {
    const err = new Error('Too many verification attempts');
    (err as Error & { status: number }).status = 429;
    throw err;
  }

  const ok = latest.codeHash === hashOtp(code);
  await prisma.oTPVerification.update({
    where: { id: latest.id },
    data: { attempts: { increment: 1 }, consumed: ok },
  });
  if (!ok) {
    const err = new Error('Invalid verification code');
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  return latest;
}
