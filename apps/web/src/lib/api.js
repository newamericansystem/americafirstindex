const BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export async function api(path, { method = 'GET', body, headers, signal } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), 'x-afi-csrf': '1', ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw Object.assign(new Error(err?.error?.message ?? res.statusText), { status: res.status, code: err?.error?.code });
  }
  return res.status === 204 ? null : res.json();
}
