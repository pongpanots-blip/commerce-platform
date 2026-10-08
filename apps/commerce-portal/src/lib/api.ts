// Thin fetch wrapper for the Commerce Platform developer portal API.
// Base URL is configurable; dev defaults to the platform's local port (3100), production builds to
// same-origin /api (served behind the same nginx as the platform).
import { loginPathFor } from './landing';

const env = (import.meta as unknown as { env: Record<string, string | boolean> }).env;
const BASE = (env?.VITE_COMMERCE_API as string) || (env?.DEV ? 'http://localhost:3100/api' : '/api');

// localStorage, shared by every tab. Access JWT 15 min, refresh token 30 days (platform
// AUTH_ACCESS_TOKEN_TTL_SECONDS / AUTH_REFRESH_TOKEN_TTL_DAYS). Wrapped — storage can throw.
const TOKEN_KEY = 'portal_token';
const REFRESH_KEY = 'portal_refresh';
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage full / disabled */ } };
const remove = (key: string) => { try { localStorage.removeItem(key); } catch { /* ignore */ } };

export function getToken(): string | null {
  return read(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return read(REFRESH_KEY);
}

/** A new pair; without a refresh token any older one is dropped (it belongs to another sign-in). */
function setTokens(token: string, refreshToken?: string): void {
  write(TOKEN_KEY, token);
  if (refreshToken) write(REFRESH_KEY, refreshToken);
  else remove(REFRESH_KEY);
}

/** Both tokens, always together. */
export function clearToken(): void {
  remove(TOKEN_KEY);
  remove(REFRESH_KEY);
}

/** Signed-in partner, for display only — read from the JWT payload, not verified (the API verifies). */
export function tokenClaims(): { email?: string; role?: string; exp?: number } | null {
  try {
    const part = getToken()?.split('.')[1];
    return part ? JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) : null;
  } catch {
    return null;
  }
}

/** An access token not (about to be) expired. Unreadable or exp-less tokens count as fresh — the API decides. */
export function hasFreshToken(skewMs = 30_000): boolean {
  if (!getToken()) return false;
  const exp = tokenClaims()?.exp;
  return typeof exp !== 'number' || exp * 1000 - skewMs > Date.now();
}

/** Where a page change goes; replaceable in tests (jsdom cannot navigate). */
export const navigation = {
  assign(url: string) { window.location.assign(url); },
};

/** ok = new pair stored · invalid = the sign-in is over · offline = could not ask (network, 5xx); keep the tokens. */
export type RefreshOutcome = 'ok' | 'invalid' | 'offline';
let inflight: Promise<RefreshOutcome> | null = null;

async function refreshOnce(staleToken: string | null): Promise<RefreshOutcome> {
  // another tab (shared localStorage) or an earlier refresh already replaced the rejected token
  const current = getToken();
  if (current && current !== staleToken) return 'ok';
  const refreshToken = getRefreshToken();
  if (!refreshToken) return 'invalid';
  let res: Response;
  try {
    res = await fetch(`${BASE}/v1/portal/auth/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return 'offline';
  }
  if (res.status >= 500 || res.status === 429) return 'offline';
  if (!res.ok) {
    // a tab that refreshed while this request was in the air already stored the next pair
    return getRefreshToken() !== refreshToken && getToken() ? 'ok' : 'invalid';
  }
  try {
    const body = await res.json() as { accessToken?: string; refreshToken?: string };
    if (!body?.accessToken || !body.refreshToken) return 'invalid';
    setTokens(body.accessToken, body.refreshToken);
    return 'ok';
  } catch {
    return 'invalid';
  }
}

/**
 * Trade the refresh token for a new pair. Single flight inside the tab, and serialised across tabs with the
 * Web Locks API where available: a refresh token is single-use, a second refresh with it looks like reuse and
 * ends the sign-in.
 */
export function refreshSession(staleToken: string | null = getToken()): Promise<RefreshOutcome> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  inflight ??= (locks
    // the lock is held until the refresh has stored the new pair
    ? new Promise<RefreshOutcome>((resolve, reject) => { locks.request('portal-auth-refresh', () => refreshOnce(staleToken).then(resolve, reject)).catch(reject); })
    : refreshOnce(staleToken)
  ).finally(() => { inflight = null; });
  return inflight;
}

/** App start: true = go straight in (fresh access token, or a refresh token that still works); false = login, both tokens cleared. */
export async function restoreSession(): Promise<boolean> {
  if (hasFreshToken()) return true;
  if (getRefreshToken()) {
    const outcome = await refreshSession(getToken());
    // offline: go in with what we have; the next request retries the refresh
    if (outcome !== 'invalid') return true;
  }
  clearToken();
  return false;
}

/** Only a refresh token (or an expired access token next to one): refresh before rendering anything. */
export const needsRestore = () => !hasFreshToken() && !!getRefreshToken();

const currentLocation = () => window.location.pathname + window.location.search + window.location.hash;

interface RequestOptions {
  /**
   * Bypass the global 401 refresh / clear-token-and-redirect interceptor. Used ONLY by
   * auth.login/auth.register: a 401 there means "wrong credentials" and must
   * surface as a thrown error for the form's .err div — it must never clear a
   * portal_token that may still be valid (e.g. signed in from another tab
   * while retyping a password on /login) nor hard-navigate away from the form.
   */
  skipAuthRedirect?: boolean;
}

/** A non-2xx reply; same message as before, plus the HTTP status for pages that branch on it. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(
  path: string,
  init?: RequestInit,
  opts?: RequestOptions,
): Promise<T> {
  const send = (token: string | null) => fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const token = getToken();
  let res = await send(token);
  if (res.status === 401 && !opts?.skipAuthRedirect) {
    // Expired access token: refresh once (shared with every other 401 right now) and retry once.
    const outcome = await refreshSession(token);
    if (outcome === 'ok') res = await send(getToken());
    if (res.status === 401) {
      if (outcome !== 'offline') {
        // The session is gone (refresh refused, or the retry was rejected too), so drop it and bounce
        // to /login rather than let the caller render against a half-authed state; come back here after.
        clearToken();
        navigation.assign(loginPathFor(currentLocation()));
      }
      throw new Error('unauthorized');
    }
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message =
      body?.error?.message || body?.message || `${res.status} ${res.statusText}`;
    throw new ApiError(Array.isArray(message) ? message.join(', ') : String(message), res.status);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  base: BASE,
};

// ---- Domain types (mirror the portal API's response shapes) ----

export interface RegisterResponse {
  accountId: string;
  email: string;
}

export interface LoginResponse {
  accessToken: string;
  role?: string;
  mustChangePassword?: boolean;
  refreshToken?: string;
  expiresIn?: number;
  refreshExpiresIn?: number;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  scope: string;
  active: boolean;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreateKeyResponse {
  id: string;
  name: string;
  keyPrefix: string;
  scope: string;
  fullKey: string;
}

export type WebhookRow = {
  id: string;
  accountId: string;
  name: string;
  targetUrl: string;
  eventTypes: string[];
  active: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export interface CreateWebhookDto {
  name: string;
  targetUrl: string;
  eventTypes: string[];
  secret?: string;
}

export interface UpdateWebhookDto {
  targetUrl?: string;
  eventTypes?: string[];
  secret?: string;
  active?: boolean;
}

export interface TestWebhookResult {
  ok: boolean;
  status: number | null;
  error?: string;
}

export interface CatalogEvent {
  type: string;
  description: string;
  example: Record<string, unknown>;
}

/** POST for the auth endpoints only: 401s throw instead of clear+redirect. */
function authPost<T>(path: string, data: unknown): Promise<T> {
  return request<T>(
    path,
    { method: 'POST', body: JSON.stringify(data) },
    { skipAuthRedirect: true },
  );
}

/** How long sign-out waits for the server before dropping the tokens anyway. */
export const LOGOUT_TIMEOUT_MS = 3000;

export const auth = {
  async register(email: string, password: string): Promise<string | undefined> {
    await authPost<RegisterResponse>('/v1/portal/auth/register', { email, password });
    return auth.login(email, password); // register auto-logs-in
  },
  /** Stores both tokens; resolves to the account's role. */
  async login(email: string, password: string): Promise<string | undefined> {
    const res = await authPost<LoginResponse>('/v1/portal/auth/login', { email, password });
    setTokens(res.accessToken, res.refreshToken);
    return res.role ?? tokenClaims()?.role;
  },
  /**
   * First ends the sign-in on the server (so the refresh token is revoked while we still hold it), waiting at
   * most LOGOUT_TIMEOUT_MS, then drops both tokens — also when the call fails or times out.
   */
  async logout(): Promise<void> {
    const refreshToken = getRefreshToken();
    try {
      if (!refreshToken) return;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), LOGOUT_TIMEOUT_MS);
      try {
        await fetch(`${BASE}/v1/portal/auth/logout`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }),
          keepalive: true, signal: abort.signal,
        });
      } catch {
        // best effort: offline, timed out, server error — the tokens go regardless
      } finally {
        clearTimeout(timer);
      }
    } finally {
      clearToken();
    }
  },
  /** A token to go in with now, or a refresh token the next API call can trade for one. */
  isAuthenticated(): boolean {
    return hasFreshToken() || !!getRefreshToken();
  },
};

export const keys = {
  list: () => api.get<ApiKeyRow[]>('/v1/portal/keys'),
  create: (name: string) => api.post<CreateKeyResponse>('/v1/portal/keys', { name }),
  revoke: (id: string) => api.post<void>(`/v1/portal/keys/${id}/revoke`, {}),
};

export const webhooks = {
  list: () => api.get<WebhookRow[]>('/v1/portal/webhooks'),
  create: (dto: CreateWebhookDto) => api.post<WebhookRow>('/v1/portal/webhooks', dto),
  update: (id: string, dto: UpdateWebhookDto) =>
    api.patch<WebhookRow>(`/v1/portal/webhooks/${id}`, dto),
  test: (id: string) => api.post<TestWebhookResult>(`/v1/portal/webhooks/${id}/test`, {}),
};

export const events = {
  list: () => api.get<{ items: CatalogEvent[] }>('/v1/portal/events'),
};

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventType: string;
  url: string;
  /** pending | success | failed | superseded */
  status: string;
  /** HTTP status your endpoint answered (null before the first attempt or on a connection error) */
  statusCode: number | null;
  attempts: number;
  createdAt: string;
  error?: string;
}

export const deliveries = {
  recent: (limit = 10) => api.get<WebhookDelivery[]>(`/v1/portal/deliveries?limit=${limit}`),
};
