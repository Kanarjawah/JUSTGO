import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db.js';
import { normalizePhone } from '../lib/phone.js';
import { hashOtp } from '../lib/crypto.js';
import { writeAudit } from '../lib/audit.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many OTP requests. Try again later.' },
});

const GENERIC_LOGIN_ERROR = 'Invalid credentials';

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const body = z
      .object({
        phone: z.string().min(7),
        password: z.string().min(1),
      })
      .parse(req.body);

    let phone: string;
    try {
      phone = normalizePhone(body.phone);
    } catch {
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) {
      const failed = user.failedLogins + 1;
      const lockedUntil =
        failed >= 5 ? new Date(Date.now() + Math.min(failed, 10) * 60 * 1000) : null;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: failed, lockedUntil },
      });
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
      return res.status(403).json({ error: 'Account not active' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null },
    });

    req.session.userId = user.id;
    await writeAudit({
      actorId: user.id,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
    });

    res.json({
      user: {
        id: user.id,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
      },
    });
  } catch {
    res.status(400).json({ error: 'Invalid request' });
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  req.session.destroy(() => {
    void writeAudit({ actorId: userId, action: 'LOGOUT', entityType: 'User', entityId: userId });
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/me', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  res.json({ user: req.user });
});

router.post('/otp/request', otpLimiter, async (req, res) => {
  try {
    const body = z.object({ phone: z.string() }).parse(req.body);
    const phone = normalizePhone(body.phone);

    const latest = await prisma.oTPVerification.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < 60_000) {
      return res.status(429).json({ error: 'Please wait before requesting another code' });
    }

    const code = String(randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await prisma.oTPVerification.create({
      data: {
        phone,
        codeHash: hashOtp(code),
        expiresAt,
      },
    });

    // OTP is never returned to clients in production. Dev placeholder SMS log only.
    await prisma.smsDeliveryLog.create({
      data: {
        phone,
        status: 'QUEUED_PLACEHOLDER',
        provider: 'PLACEHOLDER',
        message: 'OTP queued (SMS provider not configured)',
      },
    });

    res.json({
      ok: true,
      expiresInSeconds: 300,
      // Development aid only — not a live SMS integration
      ...(process.env.NODE_ENV === 'development' ? { devCode: code } : {}),
    });
  } catch {
    res.status(400).json({ error: 'Invalid phone number' });
  }
});

router.post('/otp/verify', otpLimiter, async (req, res) => {
  try {
    const body = z.object({ phone: z.string(), code: z.string().length(6) }).parse(req.body);
    const phone = normalizePhone(body.phone);
    const record = await prisma.oTPVerification.findFirst({
      where: { phone, consumed: false },
      orderBy: { createdAt: 'desc' },
    });
    if (!record || record.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }
    if (record.attempts >= 5) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }
    if (record.codeHash !== hashOtp(body.code)) {
      await prisma.oTPVerification.update({
        where: { id: record.id },
        data: { attempts: record.attempts + 1 },
      });
      return res.status(401).json({ error: 'Invalid or expired code' });
    }
    await prisma.oTPVerification.update({
      where: { id: record.id },
      data: { consumed: true },
    });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: 'Invalid request' });
  }
});

export default router;
