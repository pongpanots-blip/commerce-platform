// Thin fetch wrapper for the Commerce Platform developer portal API.
// Base URL is configurable; defaults to the platform's local dev port (3100).
const BASE =
  (import.meta as unknown as { env: Record<string, string> }).env
    ?.VITE_COMMERCE_API || 'http://localhost:3100/api';

const TOKEN_KEY = 'portal_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

interface RequestOptions {
  /**
   * Bypass the global 401 clear-token-and-redirect interceptor. Used ONLY by
   * auth.login/auth.register: a 401 there means "wrong credentials" and must
   * surface as a thrown error for the form's .err div — it must never clear a
   * portal_token that may still be valid (e.g. signed in from another tab
   * while retyping a password on /login) nor hard-navigate away from the form.
   */
  skipAuthRedirect?: boolean;
}

export async function request<T>(
  path: string,
  init?: RequestInit,
  opts?: RequestOptions,
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401 && !opts?.skipAuthRedirect) {
    // A guarded resource call got rejected — the session is gone
    // (missing/expired/invalidated token), so drop it and bounce to /login
    // rather than let the caller render against a half-authed state.
    clearToken();
    window.location.assign('/login');
    throw new Error('unauthorized');
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message =
      body?.error?.message || body?.message || `${res.status} ${res.statusText}`;
    throw new Error(Array.isArray(message) ? message.join(', ') : String(message));
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

export const auth = {
  async register(email: string, password: string): Promise<void> {
    await authPost<RegisterResponse>('/v1/portal/auth/register', { email, password });
    await auth.login(email, password); // register auto-logs-in
  },
  async login(email: string, password: string): Promise<void> {
    const res = await authPost<LoginResponse>('/v1/portal/auth/login', { email, password });
    setToken(res.accessToken);
  },
  logout(): void {
    clearToken();
  },
  isAuthenticated(): boolean {
    return !!getToken();
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
