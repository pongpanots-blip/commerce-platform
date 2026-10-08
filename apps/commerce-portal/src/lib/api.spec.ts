// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, auth, getRefreshToken, getToken, keys, navigation, needsRestore, refreshSession, restoreSession } from './api';

/** Unsigned look-alike JWTs (test fixtures only — the client never verifies). */
const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (claims: object, expInSec = 900) => `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', email: 'dev@example.com', role: 'developer', exp: Math.floor(Date.now() / 1000) + expInSec, ...claims })}.sig`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const OLD = jwt({}, -60);
const NEW = jwt({ v: 2 });

let refreshCalls = 0;
let refreshReply: () => Response;
let fetchMock: ReturnType<typeof vi.fn>;
let assigned: string[];

beforeEach(() => {
  localStorage.clear();
  refreshCalls = 0;
  assigned = [];
  vi.spyOn(navigation, 'assign').mockImplementation((url: string) => { assigned.push(url); });
  window.history.replaceState(null, '', '/webhooks');
  refreshReply = () => json(200, { accessToken: NEW, refreshToken: 'refresh-2', role: 'developer', mustChangePassword: false, expiresIn: 900 });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.slice(api.base.length);
    if (path === '/v1/portal/auth/refresh') { refreshCalls++; await new Promise((r) => setTimeout(r, 5)); return refreshReply(); }
    if (path === '/v1/portal/auth/logout') return json(200, { ok: true });
    if (path === '/v1/portal/auth/login') return json(201, { accessToken: NEW, refreshToken: 'refresh-1', role: 'developer', mustChangePassword: false });
    const header = (init?.headers as Record<string, string> | undefined)?.Authorization;
    return header === `Bearer ${NEW}` ? json(200, [{ path }]) : json(401, { message: 'invalid or expired token' });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const set = (access: string | null, refresh: string | null) => {
  if (access) localStorage.setItem('portal_token', access);
  if (refresh) localStorage.setItem('portal_refresh', refresh);
};
const callsTo = (path: string) => fetchMock.mock.calls.filter(([url]) => url === `${api.base}${path}`);

describe('portal refresh on 401 (single flight)', () => {
  it('two concurrent 401s trigger exactly one refresh; both requests are retried once', async () => {
    set(OLD, 'refresh-1');
    const [k, w] = await Promise.all([keys.list(), api.get('/v1/portal/webhooks')]);
    expect(k).toEqual([{ path: '/v1/portal/keys' }]);
    expect(w).toEqual([{ path: '/v1/portal/webhooks' }]);
    expect(refreshCalls).toBe(1);
    expect(callsTo('/v1/portal/keys')).toHaveLength(2);
    expect(callsTo('/v1/portal/webhooks')).toHaveLength(2);
    expect([getToken(), getRefreshToken()]).toEqual([NEW, 'refresh-2']);
    expect(assigned).toEqual([]);
  });

  it('a refused refresh clears both tokens and goes to /login, remembering the page', async () => {
    set(OLD, 'refresh-1');
    refreshReply = () => json(401, { message: 'invalid refresh token' });
    await expect(keys.list()).rejects.toThrow('unauthorized');
    expect(refreshCalls).toBe(1);
    expect([getToken(), getRefreshToken()]).toEqual([null, null]);
    expect(assigned).toEqual(['/login?redirect=%2Fwebhooks']);
  });

  it('API unreachable during refresh: the call fails, tokens stay, no redirect', async () => {
    set(OLD, 'refresh-1');
    refreshReply = () => json(503, {});
    await expect(keys.list()).rejects.toThrow('unauthorized');
    expect([getToken(), getRefreshToken()]).toEqual([OLD, 'refresh-1']);
    expect(assigned).toEqual([]);
  });

  it('a token another tab already refreshed is used as is', async () => {
    set(NEW, 'refresh-2');
    await expect(refreshSession(OLD)).resolves.toBe('ok');
    expect(refreshCalls).toBe(0);
  });

  it('login/register 401s surface as errors and never refresh or redirect', async () => {
    set(NEW, 'refresh-1');
    fetchMock.mockImplementationOnce(async () => json(401, { message: 'invalid credentials' }));
    await expect(auth.login('dev@example.com', 'nope')).rejects.toThrow('invalid credentials');
    expect(refreshCalls).toBe(0);
    expect(assigned).toEqual([]);
    expect(getToken()).toBe(NEW);
  });

  it('login stores both tokens and returns the role', async () => {
    await expect(auth.login('dev@example.com', 'secret123')).resolves.toBe('developer');
    expect([getToken(), getRefreshToken()]).toEqual([NEW, 'refresh-1']);
  });
});

describe('portal auto sign-in', () => {
  it('fresh access token: straight in, no refresh', async () => {
    set(NEW, 'refresh-1');
    expect(needsRestore()).toBe(false);
    await expect(restoreSession()).resolves.toBe(true);
    expect(refreshCalls).toBe(0);
  });

  it('only a refresh token: refresh first, then in', async () => {
    set(null, 'refresh-1');
    expect(needsRestore()).toBe(true);
    await expect(restoreSession()).resolves.toBe(true);
    expect(getToken()).toBe(NEW);
  });

  it('failed refresh → login with both tokens cleared', async () => {
    set(OLD, 'refresh-1');
    refreshReply = () => json(401, {});
    await expect(restoreSession()).resolves.toBe(false);
    expect([getToken(), getRefreshToken()]).toEqual([null, null]);
    expect(auth.isAuthenticated()).toBe(false);
  });
});

describe('portal isAuthenticated', () => {
  it('an expired access token alone is not a session; with a refresh token it is', () => {
    set(OLD, null);
    expect(auth.isAuthenticated()).toBe(false);
    set(null, 'refresh-1');
    expect(auth.isAuthenticated()).toBe(true);
  });
});

describe('portal logout', () => {
  it('posts the refresh token best-effort and clears both tokens even if the call fails', async () => {
    set(NEW, 'refresh-1');
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('network'); });
    await auth.logout();
    expect([getToken(), getRefreshToken()]).toEqual([null, null]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refreshToken: 'refresh-1' });
  });
});
