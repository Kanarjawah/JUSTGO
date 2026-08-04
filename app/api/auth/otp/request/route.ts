import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { normalizePhone } from '@/server/lib/phone';
import { hashOtp } from '@/server/lib/crypto';
import { sendOrangeSms } from '../../../../../integrations/orange-sms';
import { error, json, readJson } from '@/server/http';

export async function POST(request: Request) {
  try {
    const body = z.object({ phone: z.string() }).parse(await readJson(request));
    const phone = normalizePhone(body.phone);
    const latest = await prisma.oTPVerification.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < 60_000) {
      return error('Please wait before requesting another code', 429);
    }
    const code = String(randomInt(100000, 999999));
    await prisma.oTPVerification.create({
      data: {
        phone,
        codeHash: hashOtp(code),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
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
    return json({
      ok: true,
      expiresInSeconds: 300,
      ...(process.env.NODE_ENV === 'development' ? { devCode: code } : {}),
    });
  } catch {
    return error('Invalid phone number', 400);
  }
}
