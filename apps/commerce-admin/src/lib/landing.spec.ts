import { describe, expect, it } from 'vitest';
import { FALLBACK_LANDING, isRouteAllowed, isSafeInternalPath, landingFor, loginPathFor, redirectParam, resolvePostLoginPath, ROLE_LANDING } from './landing';
import { navFor } from '../app/navigation';

const STAFF_ROLES = ['admin', 'marketing', 'merchandising', 'cs', 'sale', 'sales_manager', 'business_analyst', 'graphic'];

describe('role landing (commerce-admin)', () => {
  it.each([
    ['admin', '/'],
    ['merchandising', '/products'],
    ['sales_manager', '/reports/sales'],
    ['business_analyst', '/reports/sales'],
    ['cs', '/cs'],
    ['graphic', '/j/product/bulk-image-upload'],
    ['marketing', '/marketing/growth'],
    ['sale', '/reports/sales'],
    ['sale_manager', '/reports/sales'], // stored alias of sales_manager
    [' SALE_MANAGER ', '/reports/sales'],
  ])('%s → %s', (role, path) => {
    expect(landingFor(role)).toBe(path);
  });

  it('every staff role has a landing page that is in its own sidebar', () => {
    expect(Object.keys(ROLE_LANDING).sort()).toEqual([...STAFF_ROLES].sort());
    for (const role of STAFF_ROLES.filter((r) => r !== 'admin')) {
      const links = navFor(role).flatMap((g) => g.links.map((l) => l.to));
      expect(links).toContain(landingFor(role));
      expect(isRouteAllowed(role, landingFor(role))).toBe(true);
    }
  });

  it('unknown or missing role → the page every staff role can open', () => {
    expect(landingFor('platform_admin')).toBe(FALLBACK_LANDING);
    expect(landingFor(undefined)).toBe('/account/password');
    expect(resolvePostLoginPath('developer', '/products')).toBe('/account/password');
  });
});

describe('deep links', () => {
  it.each([
    ['merchandising', '/products/123?tab=prices', '/products/123?tab=prices'],
    ['merchandising', '/stock-moves', '/stock-moves'],
    ['merchandising', '/settings/staff', '/products'], // admin-only page
    ['merchandising', '/reports/sales', '/products'],
    ['sales_manager', '/reports/customers/abc', '/reports/customers/abc'],
    ['sales_manager', '/products', '/reports/sales'],
    ['business_analyst', '/marketing/growth', '/marketing/growth'],
    ['business_analyst', '/marketing/growth/plans', '/reports/sales'], // the more specific entry is marketing only
    ['graphic', '/j/allproducts', '/j/allproducts'],
    ['graphic', '/j/coupons', '/j/product/bulk-image-upload'],
    ['marketing', '/workspaces/marketing', '/workspaces/marketing'],
    ['cs', '/account/password', '/account/password'],
    ['cs', '/', '/cs'],
    ['admin', '/settings/staff', '/settings/staff'],
    ['admin', '/login?redirect=/x', '/'],
    ['sale', '/reports/winback/my', '/reports/winback/my'],
    ['sale', '/reports/winback', '/reports/sales'], // the team view is sales_manager / business_analyst
    ['sale', '/reports/customers/c-1', '/reports/customers/c-1'],
    ['sale', '/cs/sales-assignment', '/reports/sales'],
    ['sale_manager', '/cs/sales-assignment', '/cs/sales-assignment'],
    ['sales_manager', '/reports/winback/opportunities', '/reports/winback/opportunities'],
    ['sales_manager', '/reports/winback/my', '/reports/sales'],
  ])('%s + redirect %s → %s', (role, redirect, expected) => {
    expect(resolvePostLoginPath(role, redirect)).toBe(expected);
  });

  it('a workspace page only when the role has links in it', () => {
    const own = navFor('cs').flatMap((g) => g.links.map((l) => l.to)).filter((to) => to.startsWith('/workspaces/'));
    expect(own.length).toBeGreaterThan(0);
    for (const id of ['catalog', 'orders', 'customers', 'marketing', 'reports', 'connections', 'settings']) {
      expect(isRouteAllowed('cs', `/workspaces/${id}`)).toBe(own.includes(`/workspaces/${id}`));
    }
    expect(isRouteAllowed('cs', '/workspaces/marketing')).toBe(false);
  });

  it('rejects open redirects', () => {
    for (const bad of ['https://evil.example/', '//evil.example/x', '/\\evil.example', '\\\\evil.example', 'javascript:alert(1)', 'products', '/a\nb', '', null, undefined]) {
      expect(resolvePostLoginPath('admin', bad as string)).toBe('/');
    }
    expect(isSafeInternalPath('/reports/sales?period=today#top')).toBe(true);
    expect(isSafeInternalPath('//evil.example')).toBe(false);
    expect(isSafeInternalPath('/\t/evil.example')).toBe(false);
  });

  it('login URLs remember where you were', () => {
    expect(loginPathFor('/products/1?x=1')).toBe('/login?redirect=%2Fproducts%2F1%3Fx%3D1');
    expect(redirectParam('?redirect=%2Fproducts%2F1%3Fx%3D1')).toBe('/products/1?x=1');
    expect(loginPathFor('/')).toBe('/login');
    expect(loginPathFor('/login?redirect=%2Fcs')).toBe('/login?redirect=%2Fcs');
  });
});
