import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchPath } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { currentNavItem } from '@cp/ui';
import messages from '../../../../libs/ui/src/locales/ui-messages.json';
import { DASHBOARD, NAV_ENTRIES, ROLE_ACCESS, SECTIONS, WORKSPACE_SECTION, navFor, workspaceTarget } from './navigation';
import { LEGACY_ITEMS, LEGACY_WORKSPACES, legacyMapping, legacyNavFor } from './navigation.legacy';
import { isRouteAllowed, landingFor } from '../lib/landing';

const STAFF_ROLES = ['admin', 'marketing', 'merchandising', 'cs', 'sales_manager', 'business_analyst', 'graphic'];
const NON_ADMIN = STAFF_ROLES.filter((r) => r !== 'admin');
const linksOf = (role: string) => navFor(role).flatMap((g) => g.links.map((l) => l.to));
const titleOf = (id: string) => SECTIONS.find((s) => s.id === id)!.title;

describe('sidebar per role', () => {
  it.each(STAFF_ROLES)('%s: every visible item is allowed for the role, no empty or duplicate entries', (role) => {
    const nav = navFor(role);
    for (const group of nav) expect(group.links.length).toBeGreaterThan(0);
    const links = linksOf(role);
    expect(new Set(links).size).toBe(links.length);
    for (const to of links) expect(isRouteAllowed(role, to), `${role} → ${to}`).toBe(true);
    if (role !== 'admin') for (const to of links) expect(ROLE_ACCESS[to], `${to} is admin-only`).toContain(role);
  });

  it('admin sees every destination, Dashboard first', () => {
    expect(navFor('admin')[0].links).toEqual([DASHBOARD]);
    expect(linksOf('admin').slice(1).sort()).toEqual(NAV_ENTRIES.map((e) => e.to).sort());
  });

  it('a few task sections; each shows at most 10 items before "show more" (Advanced is folded)', () => {
    const groups = navFor('admin').filter((g) => g.group);
    expect(groups.map((g) => g.group)).toEqual(SECTIONS.map((s) => s.title));
    expect(groups.length).toBeLessThanOrEqual(7);
    for (const g of groups.filter((g) => g.group !== titleOf('advanced'))) expect(g.links.filter((l) => !l.more).length, g.group).toBeLessThanOrEqual(10);
  });

  it('Settings › Advanced only where a role has ops pages (admin, marketing)', () => {
    const withAdvanced = STAFF_ROLES.filter((role) => navFor(role).some((g) => g.group === titleOf('advanced')));
    expect(withAdvanced).toEqual(['admin', 'marketing']);
    expect(navFor('marketing').find((g) => g.group === titleOf('advanced'))!.links.every((l) => ROLE_ACCESS[l.to]?.includes('marketing'))).toBe(true);
  });

  it('a section a role sees only through "show more" items is shown unfolded', () => {
    const orders = navFor('business_analyst').find((g) => g.group === titleOf('orders'))!;
    expect(orders.links.map((l) => [l.to, !!l.more])).toEqual([['/orders', false]]);
  });

  it('per-role item counts (PR body table)', () => {
    const counts = Object.fromEntries(STAFF_ROLES.map((role) => [role, linksOf(role).length]));
    expect(counts).toEqual({ admin: 115, marketing: 40, merchandising: 18, cs: 9, sales_manager: 8, business_analyst: 12, graphic: 5 });
  });

  it('journey funnel (josh /analytics/funnel is admin-only) is no longer offered to marketing', () => {
    expect(linksOf('marketing')).not.toContain('/j/marketing/journey-funnel');
    expect(isRouteAllowed('marketing', '/j/marketing/journey-funnel')).toBe(false);
    expect(linksOf('admin')).toContain('/j/marketing/journey-funnel');
  });
});

describe('old menu → new menu', () => {
  it('every old menu item has a new home, nothing new appears and the redesign widened no role', () => {
    const mapping = legacyMapping();
    expect(mapping.map((m) => m.to).sort()).toEqual(NAV_ENTRIES.map((e) => e.to).sort());
    for (const role of NON_ADMIN) {
      const before = legacyNavFor(role).flatMap((g) => g.links.map((l) => l.to)).filter((to) => !to.startsWith('/workspaces/'));
      const narrowed = role === 'marketing' ? ['/j/marketing/journey-funnel'] : [];
      expect(linksOf(role).sort(), role).toEqual(before.filter((to) => !narrowed.includes(to)).sort());
    }
  });

  it('far fewer links on screen than the old workspaces', () => {
    const visible = (role: string) => navFor(role).flatMap((g) => g.group === titleOf('advanced') ? [] : g.links.filter((l) => !l.more)).length;
    const old = (role: string) => legacyNavFor(role).flatMap((g) => g.links).length;
    for (const role of STAFF_ROLES) expect(visible(role), role).toBeLessThan(old(role));
    expect(visible('admin')).toBeLessThanOrEqual(61);
  });

  it.each(STAFF_ROLES)('%s: old /workspaces/:id links go to a page of the replacing section it may open, else its home', (role) => {
    for (const w of LEGACY_WORKSPACES) {
      const target = workspaceTarget(role, w.id);
      const section = navFor(role).find((g) => g.group === titleOf(WORKSPACE_SECTION[w.id]));
      expect(target).toBe(section?.links[0].to ?? null);
      if (target) expect(isRouteAllowed(role, target)).toBe(true);
      expect(isRouteAllowed(role, `/workspaces/${w.id}`)).toBe(target !== null);
      expect(isRouteAllowed(role, target ?? landingFor(role))).toBe(true);
    }
    expect(workspaceTarget(role, 'nope')).toBeNull();
  });
});

describe('routes', () => {
  const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');
  const appRoutes = [...read('app.tsx').matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== '*' && p !== '/j/*');
  const joshRoutes = [...read('../josh-admin/JoshAdminApp.tsx').matchAll(/<Route path="([^"]+)"/g)].map((m) => `/j/${m[1]}`).filter((p) => p !== '/j/*');
  const resolves = (path: string) => [...appRoutes, ...joshRoutes].some((pattern) => matchPath({ path: pattern, end: true }, path));

  it('every new and old menu item (and old workspace page) still has a route', () => {
    for (const to of [...NAV_ENTRIES.map((e) => e.to), ...LEGACY_ITEMS.map((i) => i.to), '/', ...Object.keys(WORKSPACE_SECTION).map((id) => `/workspaces/${id}`)]) {
      expect(resolves(to), to).toBe(true);
    }
  });

  it.each([
    ['/j/product/edit/7', '/j/allproducts'],
    ['/j/product/7', '/j/allproducts'],
    ['/j/product/create', '/j/product/create'],
    ['/j/coupon/create', '/j/coupons'],
    ['/j/coupon/abc', '/j/coupons'],
    ['/j/categories/edit/1', '/j/categories'],
    ['/j/categories/create', '/j/categories'],
    ['/j/supplier/edit/3', '/j/suppliers'],
    ['/j/order/123', '/j/order'],
    ['/j/order/import', '/j/order/import'],
    ['/marketing/growth/results/w1', '/marketing/growth'],
    ['/marketing/growth/plans/new', '/marketing/growth/plans'],
    ['/reports/orders/A-1', '/reports/orders'],
    ['/products/42', '/products'],
    ['/josh/coupons', '/josh/coupons'],
    ['/', '/'],
  ])('%s highlights %s', (path, item) => {
    expect(resolves(path), path).toBe(true);
    expect(currentNavItem(navFor('admin'), path)?.link.to).toBe(item);
  });
});

describe('copy (TH + EN)', () => {
  const catalogue = messages as Record<string, { th?: string; en?: string }>;
  const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
  const keys = [
    ...SECTIONS.flatMap((s) => [s.title, s.description]),
    ...NAV_ENTRIES.flatMap((e) => [e.label, e.description, ...(e.heading ? [e.heading] : [])]),
    DASHBOARD.label, DASHBOARD.description!,
    'แสดงเพิ่มเติม ({0})', 'แสดงน้อยลง', 'ต้องการทำรายการนี้ใช่หรือไม่',
  ];

  it('every section, menu label, description and heading exists in both languages', () => {
    for (const key of new Set(keys)) {
      const entry = catalogue[key];
      expect(entry, key).toBeTruthy();
      expect(entry.th?.trim(), `th: ${key}`).toBeTruthy();
      expect(entry.en?.trim(), `en: ${key}`).toBeTruthy();
      expect(entry.en, `English copy has no Thai: ${key}`).not.toMatch(/[ก-๛]/);
      expect(placeholders(entry.th!)).toEqual(placeholders(key));
      expect(placeholders(entry.en!)).toEqual(placeholders(key));
    }
  });

  it('every menu item says what the page is for', () => {
    for (const e of NAV_ENTRIES) expect(e.description.length, e.to).toBeGreaterThan(5);
  });
});
