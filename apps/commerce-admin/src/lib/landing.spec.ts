import { describe, expect, it } from 'vitest';
import { FALLBACK_LANDING, isRouteAllowed, isSafeInternalPath, landingFor, loginPathFor, redirectParam, resolvePostLoginPath, ROLE_LANDING } from './landing';
import { navFor, SECTIONS, shortcutsFor } from '../app/navigation';

const STAFF_ROLES = ['admin', 'marketing', 'merchandising', 'cs', 'sale', 'sales_manager', 'business_analyst', 'graphic'];

describe('role landing (commerce-admin)', () => {
  // every role lands on its home page (/home, RoleHome: shortcuts to its main tasks); intentional change vs #82/#83
  it.each([
    ['admin', '/home'],
    ['merchandising', '/home'],
    ['sales_manager', '/home'],
    ['business_analyst', '/home'],
    ['cs', '/home'],
    ['graphic', '/home'],
    ['marketing', '/home'],
    ['sale', '/home'],
    ['sale_manager', '/home'], // stored alias of sales_manager
    [' SALE_MANAGER ', '/home'],
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

  it.each([
    ['admin', null, '/'], // Dashboard, outside the sections
    ['merchandising', 'catalog', '/products'],
    ['graphic', 'catalog', '/j/product/bulk-image-upload'],
    ['marketing', 'marketing', '/marketing/growth'],
    ['sales_manager', 'reports', '/reports/sales'],
    ['business_analyst', 'reports', '/reports/sales'],
    ['cs', 'customers', '/cs'],
    ['sale', 'reports', '/reports/sales'],
  ])('%s: the first home shortcut is its main page (%s › %s), never behind "show more"', (role, section, first) => {
    expect(shortcutsFor(role)[0].to).toBe(first);
    const group = navFor(role).find((g) => g.group && g.links.some((l) => l.to === first)) ?? navFor(role)[0];
    expect(group.group ?? null).toBe(section && SECTIONS.find((s) => s.id === section)!.title);
    expect(group.links.find((l) => l.to === first)!.more).toBeFalsy();
  });

  it('unknown or missing role → the page every staff role can open', () => {
    expect(landingFor('platform_admin')).toBe(FALLBACK_LANDING);
    expect(landingFor(undefined)).toBe('/account/password');
    expect(resolvePostLoginPath('developer', '/products')).toBe('/account/password');
  });
});

describe('deep links', () => {
  it('content inspect, edit, review and outcome links retain the existing product-update roles', () => {
    const base = '/j/product/11111111-1111-4111-8111-111111111111/content';
    for (const role of STAFF_ROLES) {
      for (const suffix of ['', '/edit', '/review', '/requests/22222222-2222-4222-8222-222222222222']) {
        const path = base + suffix;
        const allowed = ['admin', 'merchandising', 'graphic'].includes(role);
        expect(isRouteAllowed(role, path), `${role} ${path}`).toBe(allowed);
        expect(resolvePostLoginPath(role, path)).toBe(allowed ? path : landingFor(role));
      }
    }
    expect(isRouteAllowed('graphic', '/j/product/11111111-1111-4111-8111-111111111111')).toBe(false);
    expect(isRouteAllowed('graphic', '/j/product/edit/11111111-1111-4111-8111-111111111111')).toBe(false);
    expect(isRouteAllowed('graphic', '/j/product/not-a-product-id/content')).toBe(false);
  });
  it.each([
    ['merchandising', '/products/123?tab=prices', '/products/123?tab=prices'],
    ['merchandising', '/stock-moves', '/stock-moves'],
    ['merchandising', '/settings/staff', '/home'], // admin-only page
    ['merchandising', '/reports/sales', '/home'],
    ['sales_manager', '/reports/customers/abc', '/reports/customers/abc'],
    ['sales_manager', '/products', '/home'],
    ['business_analyst', '/marketing/growth', '/marketing/growth'],
    ['business_analyst', '/marketing/growth/plans', '/home'], // the more specific entry is marketing only
    ['graphic', '/j/allproducts', '/j/allproducts'],
    ['graphic', '/j/coupons', '/home'],
    ['marketing', '/workspaces/marketing', '/workspaces/marketing'],
    ['cs', '/account/password', '/account/password'],
    ['cs', '/', '/home'],
    ['admin', '/settings/staff', '/settings/staff'],
    ['admin', '/login?redirect=/x', '/home'],
    ['sale', '/reports/winback/my', '/reports/winback/my'],
    ['sale', '/reports/winback', '/home'], // the team view is sales_manager / business_analyst
    ['sale', '/reports/customers/c-1', '/reports/customers/c-1'],
    ['sale', '/cs/sales-assignment', '/home'],
    ['sale_manager', '/cs/sales-assignment', '/cs/sales-assignment'],
    ['sales_manager', '/reports/winback/opportunities', '/reports/winback/opportunities'],
    ['sales_manager', '/reports/winback/my', '/home'],
  ])('%s + redirect %s → %s', (role, redirect, expected) => {
    expect(resolvePostLoginPath(role, redirect)).toBe(expected);
  });

  it('an old workspace page only when the replacing section has a page for the role', () => {
    // cs: Orders and Customers & Service yes; Marketing / Reports / Advanced (old "connections") no
    expect(['catalog', 'orders', 'customers', 'marketing', 'reports', 'connections', 'settings'].filter((id) => isRouteAllowed('cs', `/workspaces/${id}`)))
      .toEqual(['orders', 'customers', 'settings']);
    expect(isRouteAllowed('marketing', '/workspaces/connections')).toBe(true); // Advanced: AI connections, marketing tools
    expect(isRouteAllowed('graphic', '/workspaces/marketing')).toBe(false);
  });

  it('resolves dot segments before the allow-list check', () => {
    expect(resolvePostLoginPath('merchandising', '/products/../settings/staff')).toBe('/home');
    expect(isRouteAllowed('merchandising', '/products/../settings/staff')).toBe(false);
    expect(resolvePostLoginPath('merchandising', '/products/./1')).toBe('/products/1');
    expect(resolvePostLoginPath('admin', '/products/../settings/staff')).toBe('/settings/staff');
    expect(resolvePostLoginPath('sale', '/reports/sales/../../settings/staff')).toBe('/home');
  });

  it('refuses percent-encoded dot / slash / backslash tricks (any case, double-encoded)', () => {
    for (const bad of [
      '/products/%2e%2e/settings/staff', '/products/%2E%2e/settings/staff', '/products/%2e%2E/', '/products/.%2e/settings/staff',
      '/products%2f..%2fsettings%2fstaff', '/products/%252e%252e/settings/staff', '/products/%5c..%5csettings', '/products/%ZZ',
    ]) {
      expect(isRouteAllowed('merchandising', bad)).toBe(false);
      expect(resolvePostLoginPath('merchandising', bad)).toBe('/home');
      expect(resolvePostLoginPath('admin', bad)).toBe('/home');
    }
  });

  it('legit paths (with query, hash, encoded spaces / Thai) still pass', () => {
    expect(resolvePostLoginPath('merchandising', '/products/1?tab=prices#top')).toBe('/products/1?tab=prices#top');
    expect(resolvePostLoginPath('merchandising', '/products/SKU%20A')).toBe('/products/SKU%20A');
    expect(resolvePostLoginPath('merchandising', '/products/%E0%B8%81')).toBe('/products/%E0%B8%81');
    expect(resolvePostLoginPath('sales_manager', '/reports/sales?period=today')).toBe('/reports/sales?period=today');
  });

  it('rejects open redirects', () => {
    for (const bad of ['https://evil.example/', '//evil.example/x', '/\\evil.example', '\\\\evil.example', 'javascript:alert(1)', 'products', '/a\nb', '', null, undefined]) {
      expect(resolvePostLoginPath('admin', bad as string)).toBe('/home');
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
