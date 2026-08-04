let csrfToken: string | null = null;

async function ensureCsrf() {
  if (csrfToken) return csrfToken;
  const res = await fetch('/api/csrf', { credentials: 'include' });
  const data = await res.json();
  csrfToken = data.csrfToken as string;
  return csrfToken;
}

export async function api<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(options.headers || {});
  const method = (options.method || 'GET').toUpperCase();
  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = await ensureCsrf();
    headers.set('X-CSRF-Token', token);
  }
  const res = await fetch(path, {
    ...options,
    method,
    credentials: 'include',
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error || res.statusText);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  return data as T;
}

export function clearCsrf() {
  csrfToken = null;
}
