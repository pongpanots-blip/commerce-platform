// Staff session for commerce-admin: the short access JWT plus the rotating refresh token, the single-flight
// refresh behind every API call, and the silent sign-in on app start. No React in here (unit-tested).
const env = (import.meta as unknown as { env: Record<string, string | boolean> }).env;
export const BASE = (env?.VITE_COMMERCE_API as string) || (env?.DEV ? 'http://localhost:3100/api' : '/api');

// sessionStorage: gone when the tab closes. The access token lives 15 min (platform
// AUTH_ACCESS_TOKEN_TTL_SECONDS), the refresh token 30 days but only as long as the tab.
// Wrapped — storage can throw.
const TOKEN_KEY = 'cp_admin_token';
const REFRESH_KEY = 'cp_admin_refresh';
const read = (key: string) => { try { return sessionStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { sessionStorage.setItem(key, value); } catch { /* private mode: stays in memory for this load */ } };
const remove = (key: string) => { try { sessionStorage.removeItem(key); } catch { /* ignore */ } };

/** Treat an access token this close to its expiry as expired (clock skew, request time). */
const EXPIRY_SKEW_MS = 30_000;

export const session = {
  get(): string | null { return read(TOKEN_KEY); },
  getRefresh(): string | null { return read(REFRESH_KEY); },
  set(token: string, refreshToken?: string) {
    write(TOKEN_KEY, token);
    if (refreshToken) write(REFRESH_KEY, refreshToken);
  },
  /** Both tokens, always together. */
  clear() {
    remove(TOKEN_KEY);
    remove(REFRESH_KEY);
  },
  /** Who is signed in, for display only — read from the JWT payload, not verified (the API verifies). */
  claims(): { sub?: string; email?: string; role?: string; exp?: number } | null {
    const token = this.get();
    try {
      const part = token?.split('.')[1];
      return part ? JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) : null;
    } catch {
      return null;
    }
  },
  /** An access token that is not (about to be) expired. Unreadable or exp-less tokens count as fresh — the API decides. */
  fresh(): boolean {
    if (!this.get()) return false;
    const exp = this.claims()?.exp;
    return typeof exp !== 'number' || exp * 1000 - EXPIRY_SKEW_MS > Date.now();
  },
  /** Can go in now, or after a silent refresh. */
  usable(): boolean { return this.fresh() || !!this.getRefresh(); },
};

/** ok = new pair stored · invalid = the sign-in is over · offline = could not ask (network, 5xx); keep the tokens. */
export type RefreshOutcome = 'ok' | 'invalid' | 'offline';

const AUTH_PATHS = new Set(['/admin/auth/login', '/admin/auth/refresh', '/admin/auth/logout']);
let inflight: Promise<RefreshOutcome> | null = null;

/**
 * Trade the refresh token for a new pair. Single flight: concurrent callers share one request (a refresh token
 * is single-use — a second refresh with it would look like reuse and end the sign-in). `staleToken` is the
 * access token the caller's request was rejected with; if another refresh already replaced it, there is
 * nothing to do.
 */
export function refreshSession(staleToken: string | null = session.get()): Promise<RefreshOutcome> {
  inflight ??= (async (): Promise<RefreshOutcome> => {
    const current = session.get();
    if (current && current !== staleToken) return 'ok';
    const refreshToken = session.getRefresh();
    if (!refreshToken) return 'invalid';
    let res: Response;
    try {
      res = await fetch(`${BASE}/admin/auth/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }),
      });
    } catch {
      return 'offline';
    }
    if (res.status >= 500 || res.status === 429) return 'offline';
    if (!res.ok) return 'invalid';
    try {
      const body = await res.json() as { accessToken?: string; refreshToken?: string };
      if (!body?.accessToken || !body.refreshToken) return 'invalid';
      session.set(body.accessToken, body.refreshToken);
      return 'ok';
    } catch {
      return 'invalid';
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

/** The sign-in is over: drop both tokens and let the app show the login screen (it remembers where you were). */
export function expireSession() {
  session.clear();
  window.dispatchEvent(new Event('cp-session-expired'));
}

/**
 * fetch with the staff token. A 401 (except on the auth endpoints themselves) refreshes once — shared with
 * every other request that hit a 401 at the same time — and retries the request once with the new token.
 * If the refresh is refused, the session ends (`cp-session-expired`).
 */
export async function authedFetch(path: string, init: RequestInit = {}, headers: Record<string, string> = {}): Promise<Response> {
  const send = (token: string | null) => fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const token = session.get();
  const res = await send(token);
  if (res.status !== 401 || AUTH_PATHS.has(path)) return res;
  const outcome = await refreshSession(token);
  if (outcome === 'offline') return res;
  if (outcome === 'ok') {
    const retried = await send(session.get());
    if (retried.status !== 401) return retried;
    expireSession();
    return retried;
  }
  expireSession();
  return res;
}

/**
 * App start: true = go straight in (fresh access token, or a refresh token that still works).
 * false = show the login page; both tokens are cleared unless the API could not be reached.
 */
export async function restoreSession(): Promise<boolean> {
  if (session.fresh()) return true;
  if (session.getRefresh()) {
    const outcome = await refreshSession(session.get());
    if (outcome === 'ok') return true;
    // API unreachable: go in with what we have; the next request retries the refresh
    if (outcome === 'offline') return true;
  }
  session.clear();
  return false;
}

/** 'in' = render the app now · 'checking' = silent refresh first (neutral loading screen) · 'out' = login. */
export function initialAuthState(): 'in' | 'checking' | 'out' {
  return session.fresh() ? 'in' : session.getRefresh() ? 'checking' : 'out';
}

/** Sign out: end the sign-in on the server (best effort, survives a page change) and drop both tokens regardless. */
export function logout(): Promise<void> {
  const refreshToken = session.getRefresh();
  session.clear();
  if (!refreshToken) return Promise.resolve();
  return fetch(`${BASE}/admin/auth/logout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }), keepalive: true,
  }).then(() => undefined, () => undefined);
}
