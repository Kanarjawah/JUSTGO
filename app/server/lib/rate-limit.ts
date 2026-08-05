import type { NextRequest } from 'next/server';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function clientIp(request: Request | NextRequest): string {
  const headers = request.headers;
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'local'
  );
}

function clientKey(request: Request, action: string): string {
  return `${action}:ip:${clientIp(request)}`;
}

/** Simple in-memory rate limiter (per process). Suitable for single-instance development. */
export function rateLimitByKey(
  key: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (current.count >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { ok: true };
}

export function rateLimit(
  request: Request | NextRequest,
  action: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  return rateLimitByKey(clientKey(request, action), limit, windowMs);
}

/**
 * OTP request limits: IP + telephone + optional account.
 * Windows are independent; the strictest failure wins.
 */
export function rateLimitOtpRequest(params: {
  request: Request | NextRequest;
  phone: string;
  userId?: string | null;
}): { ok: true } | { ok: false; retryAfterSec: number } {
  const { request, phone, userId } = params;
  const checks = [
    rateLimit(request, 'otp-request-ip', 10, 15 * 60_000),
    rateLimitByKey(`otp-request-phone:${phone}`, 5, 15 * 60_000),
  ];
  if (userId) {
    checks.push(rateLimitByKey(`otp-request-user:${userId}`, 5, 15 * 60_000));
  }
  for (const result of checks) {
    if (!result.ok) return result;
  }
  return { ok: true };
}

export function rateLimitOtpVerify(params: {
  request: Request | NextRequest;
  phone: string;
  userId?: string | null;
}): { ok: true } | { ok: false; retryAfterSec: number } {
  const { request, phone, userId } = params;
  const checks = [
    rateLimit(request, 'otp-verify-ip', 20, 15 * 60_000),
    rateLimitByKey(`otp-verify-phone:${phone}`, 10, 15 * 60_000),
  ];
  if (userId) {
    checks.push(rateLimitByKey(`otp-verify-user:${userId}`, 10, 15 * 60_000));
  }
  for (const result of checks) {
    if (!result.ok) return result;
  }
  return { ok: true };
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
