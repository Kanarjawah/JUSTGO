export async function api<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(options.headers || {});
  const method = (options.method || 'GET').toUpperCase();
  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (typeof window !== 'undefined') {
    const guard = window.sessionStorage.getItem('justgo_admin_guard');
    if (guard) headers.set('x-justgo-admin-guard', guard);
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
  // Retained for compatibility with existing callers; CSRF is not used in the Next.js app.
}
