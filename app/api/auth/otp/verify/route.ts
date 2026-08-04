import { z } from 'zod';
import { prisma } from '@/server/db';
import { error, json, readJson } from '@/server/http';
import { normalizePhone } from '@/server/lib/phone';
import { hashOtp } from '@/server/lib/crypto';

export async function POST(request: Request) {
  try {
    const body = z.object({ phone: z.string(), code: z.string().length(6) }).parse(await readJson(request));
    const phone = normalizePhone(body.phone);
    const record = await prisma.oTPVerification.findFirst({ where: { phone, consumed: false }, orderBy: { createdAt: 'desc' } });
    if (!record || record.expiresAt < new Date() || record.attempts >= 5) return error('Invalid or expired code', 401);
    if (record.codeHash !== hashOtp(body.code)) {
      await prisma.oTPVerification.update({ where: { id: record.id }, data: { attempts: record.attempts + 1 } });
      return error('Invalid or expired code', 401);
    }
    await prisma.oTPVerification.update({ where: { id: record.id }, data: { consumed: true } });
    return json({ ok: true });
  } catch {
    return error('Invalid request');
  }
}
