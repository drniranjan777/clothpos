/**
 * Thin fetch wrapper: bearer token, one-shot refresh on 401, readable errors.
 * The access token lives in memory only; the refresh token is an httpOnly cookie the browser
 * sends to /api/auth/* automatically, so scripts on the page can never read it.
 */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  mobile?: string;
  role: Role;
  tenantId: string | null;
}
export type Role = 'super_admin' | 'tenant_admin' | 'store_manager' | 'cashier' | 'inventory_user' | 'accountant';
interface Session {
  accessToken: string;
  user: SessionUser;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// sessions used to be kept in localStorage (Phase 1) - remove any leftover copy
try {
  localStorage.removeItem('clothpos.session');
} catch {
  /* storage unavailable */
}

let session: Session | null = null;

export function getSession() {
  return session;
}
export function setSession(s: Session | null) {
  session = s;
}

let refreshing: Promise<boolean> | null = null;
/** Exchanges the refresh cookie for a new access token (single flight: parallel 401s share one call). */
export async function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', credentials: 'same-origin' });
      if (!res.ok) return false;
      setSession(await res.json());
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; query?: Query } = {}, retry = true): Promise<T> {
  const qs = opts.query
    ? '?' + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString()
    : '';
  let res: Response;
  try {
    res = await fetch(`/api${path}${qs}`, {
      method: opts.method ?? 'GET',
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your internet connection.', 0);
  }
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refresh()) return api<T>(path, opts, false);
    setSession(null);
    window.dispatchEvent(new Event('auth:logout'));
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? `Request failed (${res.status})`);
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const get = <T = any>(path: string, query?: Query) => api<T>(path, { query });
export const post = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}
