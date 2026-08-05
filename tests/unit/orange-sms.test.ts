import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  assertOrangeSmsSafeToStart,
  getOrangeSmsConfig,
  isOrangeSmsMockEnvEnabled,
  isOrangeSmsMockMode,
  resetOrangeSmsTokenCacheForTests,
  sendOrangeSms,
  toOrangeTelAddress,
} from '../../integrations/orange-sms';
import { maskPhoneForStorage, normalizePhone, toTelUri } from '../../app/server/lib/phone';
import { OTP_POLICY, issueOtp, verifyOtpCode } from '../../app/server/lib/otp';
import { hashOtp } from '../../app/server/lib/crypto';
import {
  rateLimit,
  rateLimitByKey,
  rateLimitOtpRequest,
  resetRateLimitsForTests,
} from '../../app/server/lib/rate-limit';

const prismaMock = vi.hoisted(() => ({
  oTPVerification: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  smsDeliveryLog: {
    create: vi.fn(),
  },
}));

vi.mock('../../app/server/db', () => ({
  prisma: prismaMock,
}));

vi.mock('../../app/server/lib/sms-notifications', async () => {
  const actual = await vi.importActual<typeof import('../../app/server/lib/sms-notifications')>(
    '../../app/server/lib/sms-notifications',
  );
  return {
    ...actual,
    sendOtpSms: vi.fn(async () => ({ ok: true, providerReference: 'mock-ref' })),
  };
});

describe('Liberian phone normalization for Orange SMS', () => {
  it('normalizes common Liberia mobile formats to +231 E.164', () => {
    expect(normalizePhone('0770000002')).toBe('+231770000002');
    expect(normalizePhone('231770000002')).toBe('+231770000002');
    expect(normalizePhone('+231770000002')).toBe('+231770000002');
    expect(normalizePhone('770000002')).toBe('+231770000002');
    expect(toTelUri('0770000002')).toBe('tel:+231770000002');
    expect(toOrangeTelAddress('+231770000002')).toBe('tel:+231770000002');
    expect(maskPhoneForStorage('+231770000002')).toBe('+231******0002');
  });

  it('rejects malformed, landline, and unsupported numbers', () => {
    expect(() => normalizePhone('123')).toThrow(/Invalid Liberian phone/);
    expect(() => normalizePhone('+23122123456')).toThrow(/Landline|Unsupported/);
    expect(() => normalizePhone('+23190123456')).toThrow(/Unsupported/);
    expect(() => normalizePhone('+231332001234')).toThrow(/Unsupported/);
  });
});

describe('Orange SMS mock and production guards', () => {
  afterEach(() => {
    resetOrangeSmsTokenCacheForTests();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('allows mock mode only outside production via ORANGE_SMS_MOCK_MODE', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ORANGE_SMS_ENABLED', 'true');
    vi.stubEnv('ORANGE_SMS_MOCK_MODE', 'true');
    expect(isOrangeSmsMockEnvEnabled()).toBe(true);
    expect(isOrangeSmsMockMode()).toBe(true);

    const result = await sendOrangeSms('+231770000002', 'JUSTGO code: 123456', 'OTP_VERIFICATION');
    expect(result.ok).toBe(true);
    expect(result.status).toBe('MOCK_SENT');
    expect(result.logMessage.toLowerCase()).not.toContain('123456');
    expect(result.logMessage.toLowerCase()).not.toContain('code:');
  });

  it('refuses to start in production when ORANGE_SMS_MOCK_MODE=true', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ORANGE_SMS_MOCK_MODE', 'true');
    expect(() => assertOrangeSmsSafeToStart()).toThrow(/Refusing to start/);
  });

  it('blocks mock sends when NODE_ENV=production even if mock env is true', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ORANGE_SMS_ENABLED', 'true');
    vi.stubEnv('ORANGE_SMS_MOCK_MODE', 'true');
    expect(isOrangeSmsMockMode()).toBe(false);

    const result = await sendOrangeSms('+231770000002', 'JUSTGO code: 999999', 'OTP_VERIFICATION');
    expect(result.ok).toBe(false);
    expect(result.status).toBe('MOCK_BLOCKED_IN_PRODUCTION');
  });

  it('uses Liberia sender address and JUSTGO sender name from env', () => {
    vi.stubEnv('ORANGE_SMS_SENDER_ADDRESS', '+2310000');
    vi.stubEnv('ORANGE_SMS_SENDER_NAME', 'JUSTGO');
    vi.stubEnv('ORANGE_SMS_COUNTRY_CODE', '231');
    vi.stubEnv('ORANGE_SMS_BASE_URL', 'https://api.orange.com/smsmessaging/v1');
    const cfg = getOrangeSmsConfig();
    expect(cfg.countrySender).toBe('tel:+2310000');
    expect(cfg.senderName).toBe('JUSTGO');
    expect(cfg.apiBase).toBe('https://api.orange.com/smsmessaging/v1');
    expect(cfg.countryCode).toBe('231');
  });
});

describe('OTP policy, expiration, and retry limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ORANGE_SMS_ENABLED', 'true');
    vi.stubEnv('ORANGE_SMS_MOCK_MODE', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps expiration, resend cooldown, and max attempts', () => {
    expect(OTP_POLICY.ttlMs).toBe(5 * 60 * 1000);
    expect(OTP_POLICY.resendCooldownMs).toBe(60_000);
    expect(OTP_POLICY.maxAttempts).toBe(5);
  });

  it('stores only a hash of the OTP', async () => {
    prismaMock.oTPVerification.findFirst.mockResolvedValue(null);
    prismaMock.oTPVerification.create.mockImplementation(async ({ data }: { data: { codeHash: string } }) => {
      expect(data.codeHash).toMatch(/^[a-f0-9]{64}$/);
      expect(data.codeHash).not.toMatch(/^\d{6}$/);
      return { id: 'otp1', ...data };
    });

    await issueOtp('+231770000002', 'user-1');
    expect(prismaMock.oTPVerification.create).toHaveBeenCalled();
  });

  it('rejects expired OTP codes', async () => {
    prismaMock.oTPVerification.findFirst.mockResolvedValue({
      id: 'otp-expired',
      phone: '+231770000002',
      codeHash: hashOtp('123456'),
      attempts: 0,
      expiresAt: new Date(Date.now() - 1000),
      consumed: false,
      userId: 'user-1',
      createdAt: new Date(),
    });

    await expect(verifyOtpCode('+231770000002', '123456')).rejects.toMatchObject({
      message: 'Verification code expired',
      status: 400,
    });
  });

  it('enforces five verification attempts', async () => {
    prismaMock.oTPVerification.findFirst.mockResolvedValue({
      id: 'otp-locked',
      phone: '+231770000002',
      codeHash: hashOtp('123456'),
      attempts: 5,
      expiresAt: new Date(Date.now() + 60_000),
      consumed: false,
      userId: 'user-1',
      createdAt: new Date(),
    });

    await expect(verifyOtpCode('+231770000002', '000000')).rejects.toMatchObject({
      message: 'Too many verification attempts',
      status: 429,
    });
  });

  it('enforces 60-second resend cooldown', async () => {
    prismaMock.oTPVerification.findFirst.mockResolvedValue({
      id: 'otp-recent',
      phone: '+231770000002',
      codeHash: hashOtp('111111'),
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
      consumed: false,
      userId: 'user-1',
      createdAt: new Date(Date.now() - 10_000),
    });

    await expect(issueOtp('+231770000002', 'user-1')).rejects.toMatchObject({
      status: 429,
    });
  });

  it('accepts a correct unexpired OTP and consumes it', async () => {
    prismaMock.oTPVerification.findFirst.mockResolvedValue({
      id: 'otp-ok',
      phone: '+231770000002',
      codeHash: hashOtp('654321'),
      attempts: 1,
      expiresAt: new Date(Date.now() + 60_000),
      consumed: false,
      userId: 'user-1',
      createdAt: new Date(),
    });
    prismaMock.oTPVerification.update.mockResolvedValue({});

    const latest = await verifyOtpCode('+231770000002', '654321');
    expect(latest.id).toBe('otp-ok');
    expect(prismaMock.oTPVerification.update).toHaveBeenCalledWith({
      where: { id: 'otp-ok' },
      data: { attempts: { increment: 1 }, consumed: true },
    });
  });
});

describe('OTP rate limits by IP, phone, and account', () => {
  afterEach(() => {
    resetRateLimitsForTests();
  });

  it('rate-limits by custom key', () => {
    expect(rateLimitByKey('k1', 2, 60_000).ok).toBe(true);
    expect(rateLimitByKey('k1', 2, 60_000).ok).toBe(true);
    expect(rateLimitByKey('k1', 2, 60_000).ok).toBe(false);
  });

  it('rate-limits OTP requests across IP, phone, and account', () => {
    const request = new Request('http://localhost/api/auth/otp/request', {
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });

    for (let i = 0; i < 5; i += 1) {
      expect(
        rateLimitOtpRequest({ request, phone: '+231770000002', userId: 'acct-1' }).ok,
      ).toBe(true);
    }
    const blocked = rateLimitOtpRequest({
      request,
      phone: '+231770000002',
      userId: 'acct-1',
    });
    expect(blocked.ok).toBe(false);
  });

  it('keeps IP-based limiter for generic actions', () => {
    const request = new Request('http://localhost/x', {
      headers: { 'x-forwarded-for': '198.51.100.1' },
    });
    expect(rateLimit(request, 'generic', 1, 60_000).ok).toBe(true);
    expect(rateLimit(request, 'generic', 1, 60_000).ok).toBe(false);
  });
});

describe('Authenticated OTP resend authorization', () => {
  it('rejects unauthenticated callers via requireUser', async () => {
    vi.resetModules();
    vi.doMock('../../app/server/session', () => ({
      getSessionUser: vi.fn(async () => null),
      assertAdminDevGuard: vi.fn(() => ({ ok: true })),
    }));
    const { requireUser } = await import('../../app/server/authz');
    const auth = await requireUser();
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.response.status).toBe(401);
    }
  });
});
