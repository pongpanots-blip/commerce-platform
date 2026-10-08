import { describe, expect, it } from 'vitest';
import { homeForRole, ROLE_HOME } from './role-home';

describe('commerce role homes', () => {
  it('covers every commerce role with the agreed landing pages', () => {
    // every role lands on /home (RoleHome); its main pages are the home shortcuts (navigation.ts ROLE_SHORTCUTS)
    expect(ROLE_HOME).toEqual({
      admin: '/home', merchandising: '/home', business_analyst: '/home', cs: '/home',
      graphic: '/home', marketing: '/home', sale: '/home', sales_manager: '/home',
    });
    for (const [role, home] of Object.entries(ROLE_HOME)) expect(homeForRole(role)).toBe(home);
  });
  it('canonicalizes aliases and falls back for unknown roles', () => {
    expect(homeForRole(' SALE_MANAGER ')).toBe(ROLE_HOME.sales_manager);
    for (const role of [null, undefined, '', 'manager', 'developer', 'toString', '__proto__']) expect(homeForRole(role)).toBe('/account/password');
  });
});
