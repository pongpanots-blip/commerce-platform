import { describe, expect, it } from 'vitest';
import { FALLBACK_LANDING, isRouteAllowed, landingFor, loginPathFor, resolvePostLoginPath } from './landing';

describe('role landing (commerce-portal)', () => {
  it.each([
    ['developer', '/'],
    ['admin', FALLBACK_LANDING], // a staff account signing in to the portal
    ['platform_admin', '/docs'],
    [undefined, '/docs'],
  ])('%s → %s', (role, path) => {
    expect(landingFor(role)).toBe(path);
  });

  it.each([
    ['developer', '/keys?create=1', '/keys?create=1'],
    ['developer', '/webhooks', '/webhooks'],
    ['developer', '/docs#auth', '/docs#auth'],
    ['developer', '/nope', '/'],
    ['developer', '/login', '/'],
    ['developer', '/register', '/'],
    ['someone', '/keys', '/docs'],
    ['someone', '/docs', '/docs'],
  ])('%s + redirect %s → %s', (role, redirect, expected) => {
    expect(resolvePostLoginPath(role, redirect)).toBe(expected);
  });

  it('resolves dot segments and refuses encoded ones before the allow-list check', () => {
    expect(resolvePostLoginPath('developer', '/docs/../keys')).toBe('/keys');
    expect(resolvePostLoginPath('someone', '/docs/../keys')).toBe('/docs');
    expect(resolvePostLoginPath('developer', '/keys/./')).toBe('/keys/');
    for (const bad of ['/docs/%2e%2e/keys', '/docs/%2E%2e/keys', '/docs%2f..%2fkeys', '/docs/%252e%252e/keys', '/docs/%5ckeys', '/%ZZ']) {
      expect(isRouteAllowed('developer', bad)).toBe(false);
      expect(resolvePostLoginPath('someone', bad)).toBe('/docs');
    }
    expect(resolvePostLoginPath('developer', '/webhooks?name=a%20b#x')).toBe('/webhooks?name=a%20b#x');
    expect(landingFor('toString')).toBe('/docs');
  });

  it('rejects open redirects', () => {
    for (const bad of ['https://evil.example/keys', '//evil.example/keys', '/\\evil.example', 'javascript:alert(1)', 'keys', '/\t/x', '', null, undefined]) {
      expect(resolvePostLoginPath('developer', bad as string)).toBe('/');
    }
    expect(isRouteAllowed('developer', '//keys')).toBe(false);
  });

  it('login URLs remember where you were', () => {
    expect(loginPathFor('/webhooks?x=1')).toBe('/login?redirect=%2Fwebhooks%3Fx%3D1');
    expect(loginPathFor('/')).toBe('/login');
    expect(loginPathFor('/register')).toBe('/login');
    expect(loginPathFor('/login?redirect=%2Fkeys')).toBe('/login?redirect=%2Fkeys');
  });
});
