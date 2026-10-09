// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { BASE } from '../lib/auth';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom gaps used by @cp/ui
Element.prototype.scrollIntoView ??= function scrollIntoView() { /* jsdom */ };
HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.open = true; };
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.open = false; };

/** Unsigned look-alike JWTs (test fixtures only). */
const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (role: string, expInSec: number) => `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', email: 'x@jagota.co.th', role, exp: Math.floor(Date.now() / 1000) + expInSec })}.sig`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let root: Root;
let container: HTMLDivElement;
let refreshOk = true;

async function render(path: string) {
  window.history.replaceState(null, '', path);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<App />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}
const loginFormShown = () => !!container.querySelector('input[type="email"][autocomplete="username"]');

beforeEach(() => {
  sessionStorage.clear();
  refreshOk = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.slice(BASE.length);
    if (path === '/admin/auth/refresh') return refreshOk ? json(200, { accessToken: jwt('merchandising', 900), refreshToken: 'refresh-2', role: 'merchandising' }) : json(401, {});
    if (path === '/admin/auth/me') return json(200, { userId: 'u-1', email: 'x@jagota.co.th', role: 'merchandising', mustChangePassword: false });
    return json(200, { items: [], total: 0, page: 1, pageSize: 20 });
  }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('commerce-admin sign-in gate', () => {
  it('a valid access token skips the login page; / goes to the role landing', async () => {
    sessionStorage.setItem('cp_admin_token', jwt('merchandising', 900));
    await render('/');
    expect(window.location.pathname).toBe('/home');
    expect(loginFormShown()).toBe(false);
  });

  it('only a refresh token: silent refresh (no login form), then in at the same page', async () => {
    sessionStorage.setItem('cp_admin_refresh', 'refresh-1');
    await render('/account/password');
    expect(window.location.pathname).toBe('/account/password');
    expect(loginFormShown()).toBe(false);
    expect(sessionStorage.getItem('cp_admin_refresh')).toBe('refresh-2');
  });

  it('a failed refresh shows the login page, clears both tokens and remembers the page', async () => {
    sessionStorage.setItem('cp_admin_token', jwt('merchandising', -60));
    sessionStorage.setItem('cp_admin_refresh', 'refresh-1');
    refreshOk = false;
    await render('/account/password');
    expect(loginFormShown()).toBe(true);
    expect(window.location.pathname + window.location.search).toBe('/login?redirect=%2Faccount%2Fpassword');
    expect([sessionStorage.getItem('cp_admin_token'), sessionStorage.getItem('cp_admin_refresh')]).toEqual([null, null]);
  });

  it('/login while signed in: allowed deep link, else the role landing', async () => {
    sessionStorage.setItem('cp_admin_token', jwt('merchandising', 900));
    await render('/login?redirect=%2Faccount%2Fpassword');
    expect(window.location.pathname).toBe('/account/password');
    act(() => root.unmount());
    container.remove();
    await render('/login?redirect=%2Fsettings%2Fstaff'); // admin-only
    expect(window.location.pathname).toBe('/home');
  });

  it('old workspace overview links open the replacing section, or the role home', async () => {
    sessionStorage.setItem('cp_admin_token', jwt('merchandising', 900));
    await render('/workspaces/settings');
    expect(window.location.pathname).toBe('/account/password');
    act(() => root.unmount());
    container.remove();
    await render('/workspaces/connections'); // now More settings: nothing there for merchandising
    expect(window.location.pathname).toBe('/home');
  });

  it('the sidebar lists task sections, highlights the current page and explains it in a tooltip', async () => {
    sessionStorage.setItem('cp_admin_token', jwt('merchandising', 900));
    await render('/account/password');
    const groups = [...container.querySelectorAll('aside nav a')].map((b) => b.textContent);
    expect(groups.some((t) => t?.includes('สินค้าและสต็อก'))).toBe(true);
    expect(groups.some((t) => t?.includes('ตั้งค่าเพิ่มเติม'))).toBe(false);
    const current = container.querySelector('aside a[aria-current="page"]');
    expect(current?.getAttribute('href')).toBe('/tasks/settings');
    expect(current?.getAttribute('title')).toContain('บัญชีทีมงาน');
  });

  it('home page uses permitted catalog reads and retains its canonical shortcuts', async () => {
    sessionStorage.setItem('cp_admin_token', jwt('merchandising', 900));
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
    await render('/home');
    const calls = fetchMock.mock.calls.map((c) => String(c[0]).slice(BASE.length)).filter((p) => p !== '/admin/auth/me');
    expect(calls.sort()).toEqual(['/reports/products/summary', '/reports/products?page=1&limit=12'].sort());
    expect(container.querySelector('main h1')?.textContent).toBe('สินค้า ราคา และสต็อก');
    const cards = [...container.querySelectorAll('main section[aria-label="วันนี้ต้องการทำอะไร"] a')].map((a) => a.getAttribute('href'));
    expect(cards).toEqual(['/products', '/j/allproducts', '/product-prices', '/product-master-queue', '/stock-moves', '/j/categories']);
  });
});
