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
    const payload = data as { error?: string; fields?: Record<string, string> };
    let message = payload.error || res.statusText || 'Request failed';
    // Never surface raw Zod/JSON payloads in the UI
    if (
      message.trim().startsWith('[') ||
      message.trim().startsWith('{') ||
      message.includes('"code":') ||
      message.includes('"path":')
    ) {
      message = 'Please check your registration details and try again.';
    }
    const err = new Error(message) as Error & {
      status: number;
      fields?: Record<string, string>;
    };
    err.status = res.status;
    if (payload.fields && typeof payload.fields === 'object') {
      err.fields = payload.fields;
    }
    throw err;
  }
  return data as T;
}

export function clearCsrf() {
  // Retained for compatibility with existing callers; CSRF is not used in the Next.js app.
}
