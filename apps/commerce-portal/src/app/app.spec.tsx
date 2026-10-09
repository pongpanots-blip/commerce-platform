// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { api } from '../lib/api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom gaps used by @cp/ui's command menu
Element.prototype.scrollIntoView ??= function scrollIntoView() { /* jsdom */ };
HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.open = true; };
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.open = false; };

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (expInSec: number) => `${b64({ alg: 'none' })}.${b64({ sub: 'u-1', email: 'dev@example.com', role: 'developer', exp: Math.floor(Date.now() / 1000) + expInSec })}.sig`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const FRESH = jwt(900);

let root: Root;
let container: HTMLDivElement;
let refreshOk = true;

async function render(path: string) {
  window.history.replaceState(null, '', path);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<App />); });
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const loginFormShown = () => !!container.querySelector('input[type="password"]');

beforeEach(() => {
  localStorage.clear();
  refreshOk = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.slice(api.base.length);
    if (path === '/v1/portal/auth/refresh') return refreshOk ? json(200, { accessToken: FRESH, refreshToken: 'refresh-2', role: 'developer' }) : json(401, {});
    return json(200, path.startsWith('/v1/portal/deliveries') || path.startsWith('/v1/portal/keys') || path.startsWith('/v1/portal/webhooks') ? [] : { items: [] });
  }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('portal App sign-in gate', () => {
  it('a valid access token skips the login page', async () => {
    localStorage.setItem('portal_token', FRESH);
    await render('/keys');
    expect(window.location.pathname).toBe('/keys');
    expect(loginFormShown()).toBe(false);
  });

  it('only a refresh token: a neutral loading state (no login form), then in', async () => {
    localStorage.setItem('portal_refresh', 'refresh-1');
    await render('/webhooks');
    await settle();
    expect(window.location.pathname).toBe('/webhooks');
    expect(loginFormShown()).toBe(false);
    expect(localStorage.getItem('portal_refresh')).toBe('refresh-2');
  });

  it('a failed refresh shows the login page and clears both tokens', async () => {
    localStorage.setItem('portal_token', jwt(-60));
    localStorage.setItem('portal_refresh', 'refresh-1');
    refreshOk = false;
    await render('/webhooks');
    await settle();
    expect(window.location.pathname).toBe('/login');
    expect(new URLSearchParams(window.location.search).get('redirect')).toBe('/webhooks');
    expect(loginFormShown()).toBe(true);
    expect([localStorage.getItem('portal_token'), localStorage.getItem('portal_refresh')]).toEqual([null, null]);
  });

  it('/register shows the "contact us" copy when self-registration is off (403)', async () => {
    const fallback = (fetch as unknown as ReturnType<typeof vi.fn>).getMockImplementation()!;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/v1/portal/auth/register')
      ? json(403, { statusCode: 403, message: 'Self-registration is disabled' })
      : fallback(url, init)));
    await render('/register');
    const type = (input: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => {
      type(container.querySelector('input[type="email"]')!, 'dev@example.com');
      type(container.querySelector('input[type="password"]')!, 'secret123');
    });
    await act(async () => { container.querySelector('form')!.requestSubmit(); });
    await settle();
    // default locale is Thai: the catalogue copy, not ErrorText's generic "load failed"
    expect(container.textContent).toContain('กรุณาติดต่อทีม Commerce Platform');
    expect(container.textContent).not.toContain('โหลดข้อมูลไม่สำเร็จ');
    expect(window.location.pathname).toBe('/register');
    expect(localStorage.getItem('portal_token')).toBeNull();
  });

  it('/login while signed in goes to the allowed deep link, or the landing page', async () => {
    localStorage.setItem('portal_token', FRESH);
    await render('/login?redirect=%2Fwebhooks');
    expect(window.location.pathname).toBe('/webhooks');
    act(() => root.unmount());
    container.remove();
    await render('/login?redirect=https%3A%2F%2Fevil.example');
    expect(window.location.pathname).toBe('/');
    expect(loginFormShown()).toBe(false);
  });
});
