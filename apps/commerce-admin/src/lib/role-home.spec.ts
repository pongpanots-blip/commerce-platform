import { describe, expect, it } from 'vitest';
import { homeForRole, ROLE_HOME } from './role-home';

describe('commerce role homes', () => {
  it('covers every commerce role with the agreed landing pages', () => {
    expect(ROLE_HOME).toEqual({
      admin: '/', merchandising: '/products', business_analyst: '/reports/sales', cs: '/cs',
      graphic: '/j/product/bulk-image-upload', marketing: '/marketing/growth', sale: '/reports/sales', sales_manager: '/reports/sales',
    });
    for (const [role, home] of Object.entries(ROLE_HOME)) expect(homeForRole(role)).toBe(home);
  });
  it('canonicalizes aliases and falls back for unknown roles', () => {
    expect(homeForRole(' SALE_MANAGER ')).toBe(ROLE_HOME.sales_manager);
    for (const role of [null, undefined, '', 'manager', 'developer', 'toString', '__proto__']) expect(homeForRole(role)).toBe('/account/password');
  });
});
