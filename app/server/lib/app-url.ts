/**
 * Canonical application origin for metadata, robots, and sitemap.
 * Production must set APP_URL (or NEXT_PUBLIC_APP_URL) — never fall back to localhost there.
 */
export function getAppUrl(): string {
  const raw =
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.CLIENT_ORIGIN?.trim();

  if (raw) {
    return raw.replace(/\/$/, '');
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'APP_URL (or NEXT_PUBLIC_APP_URL) must be set in production. Example: https://justgolib.com',
    );
  }

  return 'http://localhost:3000';
}

export function getAppOriginUrl(): URL {
  return new URL(getAppUrl());
}
