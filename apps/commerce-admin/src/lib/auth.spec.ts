// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, login, request } from './api';
import { authedFetch, BASE, initialAuthState, logout, refreshSession, restoreSession, session } from './auth';
import { isAdminTokenValid } from '../josh-admin/app/lib/admin-auth';

/** Unsigned look-alike JWTs (test fixtures only — the client never verifies). */
const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (claims: object, expInSec = 900) => `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', email: 'mer@jagota.co.th', role: 'merchandising', exp: Math.floor(Date.now() / 1000) + expInSec, ...claims })}.sig`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const OLD = jwt({}, -60); // expired access token
const NEW = jwt({ v: 2 });

let refreshCalls = 0;
let refreshReply: () => Response | Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  refreshCalls = 0;
  refreshReply = () => json(200, { accessToken: NEW, refreshToken: 'refresh-2', role: 'merchandising', mustChangePassword: false, expiresIn: 900 });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.slice(BASE.length);
    if (path === '/admin/auth/refresh') { refreshCalls++; await new Promise((r) => setTimeout(r, 5)); return refreshReply(); }
    if (path === '/admin/auth/logout') return json(200, { ok: true });
    if (path === '/admin/auth/login') return json(200, { accessToken: NEW, refreshToken: 'refresh-1', role: 'merchandising', mustChangePassword: false });
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    return auth === `Bearer ${NEW}` ? json(200, { path }) : json(401, { message: 'invalid or expired token' });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const callsTo = (path: string) => fetchMock.mock.calls.filter(([url]) => url === `${BASE}${path}`);

describe('refresh on 401 (single flight)', () => {
  it('two concurrent 401s trigger exactly one refresh; both requests are retried once with the new token', async () => {
    session.set(OLD, 'refresh-1');
    const [a, b] = await Promise.all([api.get<{ path: string }>('/products'), api.get<{ path: string }>('/reports/sales')]);
    expect([a.path, b.path]).toEqual(['/products', '/reports/sales']);
    expect(refreshCalls).toBe(1);
    expect(JSON.parse(callsTo('/admin/auth/refresh')[0][1].body)).toEqual({ refreshToken: 'refresh-1' });
    expect(callsTo('/products')).toHaveLength(2);
    expect(callsTo('/reports/sales')).toHaveLength(2);
    expect(session.get()).toBe(NEW);
    expect(session.getRefresh()).toBe('refresh-2');
  });

  it('a refused refresh clears both tokens and ends the session (cp-session-expired)', async () => {
    session.set(OLD, 'refresh-1');
    refreshReply = () => json(401, { message: 'invalid refresh token' });
    const expired = vi.fn();
    window.addEventListener('cp-session-expired', expired);
    await expect(Promise.all([api.get('/products'), api.get('/orders')])).rejects.toMatchObject({ status: 401 });
    window.removeEventListener('cp-session-expired', expired);
    expect(refreshCalls).toBe(1);
    expect(session.get()).toBeNull();
    expect(session.getRefresh()).toBeNull();
    expect(expired).toHaveBeenCalled();
  });

  it('no refresh token: a 401 ends the session as before', async () => {
    session.set(OLD);
    await expect(api.get('/products')).rejects.toMatchObject({ status: 401 });
    expect(refreshCalls).toBe(0);
    expect(session.get()).toBeNull();
  });

  it('API unreachable during refresh: the request fails but the tokens are kept', async () => {
    session.set(OLD, 'refresh-1');
    refreshReply = () => json(502, {});
    await expect(api.get('/products')).rejects.toMatchObject({ status: 401 });
    expect(session.get()).toBe(OLD);
    expect(session.getRefresh()).toBe('refresh-1');
  });

  it('a 401 after another refresh already replaced the token just retries (no second refresh)', async () => {
    session.set(NEW, 'refresh-2');
    await expect(refreshSession(OLD)).resolves.toBe('ok');
    expect(refreshCalls).toBe(0);
  });

  it('the login call itself never refreshes; login stores both tokens', async () => {
    fetchMock.mockImplementationOnce(async () => json(401, { message: 'invalid credentials' }));
    await expect(login('mer@jagota.co.th', 'wrong')).rejects.toThrow('invalid credentials');
    expect(refreshCalls).toBe(0);
    await expect(login('mer@jagota.co.th', 'right')).resolves.toEqual({ role: 'merchandising' });
    expect(session.get()).toBe(NEW);
    expect(session.getRefresh()).toBe('refresh-1');
  });

  it('downloads (authedFetch) go through the same refresh', async () => {
    session.set(OLD, 'refresh-1');
    const res = await authedFetch('/reports/restaurants/export');
    expect(res.status).toBe(200);
    expect(refreshCalls).toBe(1);
  });

  it('request() keeps FormData bodies without a JSON content type on the retry', async () => {
    session.set(OLD, 'refresh-1');
    const body = new FormData();
    await request('/upload', { method: 'POST', body });
    const retry = callsTo('/upload')[1][1];
    expect(retry.body).toBe(body);
    expect(retry.headers['Content-Type']).toBeUndefined();
  });
});

describe('auto sign-in on app start', () => {
  it('a fresh access token goes straight in, without a refresh', async () => {
    session.set(NEW, 'refresh-1');
    expect(initialAuthState()).toBe('in');
    await expect(restoreSession()).resolves.toBe(true);
    expect(refreshCalls).toBe(0);
  });

  it('only a refresh token (or an expired access token): refresh silently, then in', async () => {
    session.set(OLD, 'refresh-1');
    expect(initialAuthState()).toBe('checking');
    await expect(restoreSession()).resolves.toBe(true);
    expect(refreshCalls).toBe(1);
    expect(session.get()).toBe(NEW);
    sessionStorage.clear();
    sessionStorage.setItem('cp_admin_refresh', 'refresh-1');
    expect(initialAuthState()).toBe('checking');
    await expect(restoreSession()).resolves.toBe(true);
  });

  it('a failed refresh → login, both tokens cleared', async () => {
    session.set(OLD, 'refresh-1');
    refreshReply = () => json(401, {});
    await expect(restoreSession()).resolves.toBe(false);
    expect(session.get()).toBeNull();
    expect(session.getRefresh()).toBeNull();
  });

  it('nothing stored (or only an expired access token) → login', async () => {
    expect(initialAuthState()).toBe('out');
    await expect(restoreSession()).resolves.toBe(false);
    session.set(OLD);
    expect(initialAuthState()).toBe('out');
    await expect(restoreSession()).resolves.toBe(false);
    expect(session.get()).toBeNull();
  });

  it('josh pages: an expired 15-min access token with a refresh token still counts as signed in', () => {
    session.set(OLD, 'refresh-1');
    expect(isAdminTokenValid()).toBe(true);
    session.clear();
    session.set(OLD);
    expect(isAdminTokenValid()).toBe(false);
  });
});

describe('session storage', () => {
  it('a new access token without a refresh token drops the old refresh token', () => {
    session.set(NEW, 'refresh-1');
    session.set(NEW);
    expect(session.getRefresh()).toBeNull();
  });
});

describe('logout', () => {
  it('sends the refresh token best-effort and clears both tokens, even when the call fails', async () => {
    session.set(NEW, 'refresh-1');
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('network'); });
    await logout();
    expect(session.get()).toBeNull();
    expect(session.getRefresh()).toBeNull();
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ refreshToken: 'refresh-1' });
    expect(init.keepalive).toBe(true);
  });
});

describe('roles', () => {
  it('claims() reports the canonical role (sale_manager → sales_manager)', () => {
    session.set(jwt({ role: 'sale_manager' }), 'refresh-1');
    expect(session.claims()?.role).toBe('sales_manager');
  });
});
