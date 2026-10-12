import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchPath } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { currentNavItem } from '@cp/ui';
import messages from '../../../../libs/ui/src/locales/ui-messages.json';
import { DASHBOARD, HOME, NAV_ENTRIES, ROLE_ACCESS, ROLE_SHORTCUTS, SECTIONS, canSee, WORKSPACE_SECTION, navFor, shortcutsFor, workspaceTarget } from './navigation';
import { LEGACY_ITEMS, LEGACY_WORKSPACES, legacyMapping, legacyNavFor } from './navigation.legacy';
import { isRouteAllowed, landingFor } from '../lib/landing';
import { homeForRole, ROLE_HOME } from '../lib/role-home';
import { FEATURE_ACTIONS, FEATURE_HOMES, featureHome } from './features';

const STAFF_ROLES = ['admin', 'marketing', 'merchandising', 'cs', 'sales_manager', 'business_analyst', 'graphic', 'sale'];
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

  it('Home first for every role (admin: Home + Dashboard); admin sees every destination', () => {
    expect(navFor('admin')[0].links).toEqual([HOME, DASHBOARD]);
    for (const role of NON_ADMIN) expect(navFor(role)[0].links, role).toEqual([HOME]);
    // Entries covered by another page the role can open (hiddenIfCanSee) are left out; admin can open everything.
    expect(linksOf('admin').slice(2).sort()).toEqual(NAV_ENTRIES.filter((e) => !e.hiddenIfCanSee).map((e) => e.to).sort());
  });

  it('a few task sections, all of them shown to admin', () => {
    const groups = navFor('admin').filter((g) => g.group);
    expect(groups.map((g) => g.group)).toEqual(SECTIONS.map((s) => s.title));
    expect(groups.length).toBeLessThanOrEqual(7);
  });

  it.each(STAFF_ROLES)('%s: every section, More settings included, shows at most six items before "show more"', (role) => {
    for (const g of navFor(role).filter((g) => g.group)) expect(g.links.filter((l) => !l.more).length, `${role} › ${g.group}`).toBeLessThanOrEqual(6);
  });

  it('More settings: connections, failed deliveries, sync jobs and logs first; test tools, marketing tools and store data copies after "show more"', () => {
    const advanced = navFor('admin').find((g) => g.group === titleOf('advanced'))!;
    expect(advanced.links.filter((l) => !l.more).map((l) => l.to)).toEqual([
      '/integrations', '/erp/webhook-dead-letter', '/sync-jobs', '/scheduled-tasks', '/webhooks', '/subscriptions',
    ]);
    expect(advanced.links.filter(l => l.more).length).toBeGreaterThan(0);
    for (const to of ['/erp/simulator', '/j/kbank/testing-console', '/erp-stock']) expect(advanced.links.find((l) => l.to === to)!.more, to).toBe(true);
    // Marketing has nine permitted items: six primary links and three under Show more.
    const marketing = navFor('marketing').find(g => g.group === titleOf('advanced'))!;
    expect(marketing.links.filter(l => !l.more)).toHaveLength(6);
    expect(marketing.links.filter(l => l.more)).toHaveLength(3);
  });

  it('More settings only where a role has ops pages (admin, marketing)', () => {
    const withAdvanced = STAFF_ROLES.filter((role) => navFor(role).some((g) => g.group === titleOf('advanced')));
    expect(withAdvanced).toEqual(['admin', 'marketing']);
    expect(navFor('marketing').find((g) => g.group === titleOf('advanced'))!.links.every((l) => ROLE_ACCESS[l.to]?.includes('marketing'))).toBe(true);
  });

  it('a section a role sees only through "show more" items is shown unfolded', () => {
    const orders = navFor('business_analyst').find((g) => g.group === titleOf('orders'))!;
    expect(orders.links.map((l) => [l.to, !!l.more])).toEqual([['/orders', false]]);
  });

  it('offers one menu entry per feature and keeps scoped records and reports separate', () => {
    const admin = linksOf('admin');
    for (const alias of Object.keys(FEATURE_HOMES)) {
      expect(admin).not.toContain(alias);
      expect(admin).toContain(featureHome(alias));
    }
    // One product list: the shop list searches by name or code, so /products is only listed for roles without it (sale).
    expect(admin).not.toContain('/products');
    expect(linksOf('sale')).toContain('/products');
    for (const path of ['/j/allproducts', '/reports/products', '/orders', '/j/order', '/reports/orders', '/customers', '/j/company', '/reports/customers']) expect(admin).toContain(path);
    expect(admin.length).toBeLessThan(119);
  });

  it('keeps live legacy actions discoverable within their feature with unchanged permissions', () => {
    for (const alias of ['/josh/coupons', '/josh/suppliers', '/josh/credit_terms', '/josh/admin_access']) {
      expect(FEATURE_ACTIONS[featureHome(alias)].map(action => action.to)).toContain(alias);
      for (const role of NON_ADMIN) expect(isRouteAllowed(role, alias)).toBe(false);
    }
    expect(linksOf('admin')).toContain('/josh/internal_docs');
    expect(isRouteAllowed('cs', '/cs/accounts/merge')).toBe(false);
    expect(isRouteAllowed('admin', '/cs/accounts/merge')).toBe(true);
    expect(isRouteAllowed('cs', '/cs/orders/new')).toBe(true);
    expect(isRouteAllowed('cs', '/j/order/import')).toBe(false);
  });

  it.each(STAFF_ROLES)('%s: action URLs use the existing API role policy, with queries intact', (role) => {
    for (const path of ['/cs/orders/new', '/cs/samples?status=pending', '/cs/samples/123/approved?status=pending']) {
      expect(isRouteAllowed(role, path), path).toBe(role === 'admin' || role === 'cs');
    }
    for (const path of ['/stock-moves/receive', '/stock-moves/count', '/stock-moves/adjust', '/stock-moves/transfer', '/products/new']) expect(isRouteAllowed(role, path)).toBe(role === 'admin' || role === 'merchandising');
    for (const path of ['/customers/new', '/settings/staff/new', '/integrations/new']) expect(isRouteAllowed(role, path)).toBe(role === 'admin');
    expect(isRouteAllowed(role, '/cs/accounts/merge')).toBe(role === 'admin');
    expect(isRouteAllowed(role, '/j/order/import')).toBe(role === 'admin');
  });

  it('journey funnel (josh /analytics/funnel is admin-only) is no longer offered to marketing', () => {
    expect(linksOf('marketing')).not.toContain('/j/marketing/journey-funnel');
    expect(isRouteAllowed('marketing', '/j/marketing/journey-funnel')).toBe(false);
    expect(linksOf('admin')).toContain('/j/marketing/journey-funnel');
  });
});

describe('old menu → new menu', () => {
  it('every old menu item has a home and only the reviewed role additions appear', () => {
    const mapping = legacyMapping();
    expect(mapping.map((m) => m.to).sort()).toEqual(LEGACY_ITEMS.map((e) => e.to).sort());
    for (const item of mapping) expect(NAV_ENTRIES.some(entry => entry.to === item.canonicalTo), item.to).toBe(true);
    for (const role of NON_ADMIN) {
      const before = legacyNavFor(role).flatMap((g) => g.links.map((l) => l.to)).filter((to) => !to.startsWith('/workspaces/'));
      const narrowed = role === 'marketing' ? ['/j/marketing/journey-funnel'] : [];
      const merged = canSee(role, '/j/allproducts') ? ['/products'] : []; // folded into the shop product list
      const reviewedAdditions = role === 'merchandising' ? ['/j/marketing/competitor-prices'] : role === 'business_analyst' ? ['/analysis/customer-behavior'] : [];
      expect(linksOf(role).filter((to) => to !== HOME.to).sort(), role).toEqual([...new Set([...before.filter((to) => !narrowed.includes(to) && !merged.includes(to)).map(featureHome), ...reviewedAdditions])].sort());
    }
  });

  it('far fewer links on screen than the old workspaces', () => {
    const visible = (role: string) => navFor(role).flatMap((g) => g.links.filter((l) => !l.more)).length;
    const old = (role: string) => legacyNavFor(role).flatMap((g) => g.links).length;
    for (const role of STAFF_ROLES) expect(visible(role), role).toBeLessThan(old(role));
    expect(visible('admin')).toBeLessThanOrEqual(64);
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
    const shortcuts = Object.values(ROLE_SHORTCUTS).flatMap((list) => list.map((s) => s.to));
    for (const to of [...NAV_ENTRIES.map((e) => e.to), ...LEGACY_ITEMS.map((i) => i.to), HOME.to, DASHBOARD.to, ...shortcuts, ...Object.keys(WORKSPACE_SECTION).map((id) => `/workspaces/${id}`)]) {
      expect(resolves(to), to).toBe(true);
    }
  });

  it.each([
    ['/j/product/edit/7', '/j/allproducts'],
    ['/j/product/7', '/j/allproducts'],
    ['/j/product/11111111-1111-4111-8111-111111111111/content', '/j/allproducts'],
    ['/j/product/11111111-1111-4111-8111-111111111111/content/edit', '/j/allproducts'],
    ['/j/product/11111111-1111-4111-8111-111111111111/content/review', '/j/allproducts'],
    ['/j/product/11111111-1111-4111-8111-111111111111/content/requests/22222222-2222-4222-8222-222222222222', '/j/allproducts'],
    ['/j/product/create', '/j/allproducts'],
    ['/j/coupon/create', '/j/coupons'],
    ['/j/coupon/abc', '/j/coupons'],
    ['/j/categories/edit/1', '/j/categories'],
    ['/j/categories/create', '/j/categories'],
    ['/j/supplier/edit/3', '/j/suppliers'],
    ['/j/order/123', '/j/order'],
    ['/j/order/import', '/j/order'],
    ['/marketing/growth/results/w1', '/marketing/growth'],
    ['/marketing/growth/plans/new', '/marketing/growth/plans'],
    ['/reports/orders/A-1', '/reports/orders'],
    ['/products/42', '/j/allproducts'],
    ['/josh/coupons', '/j/coupons'],
    ['/josh/credit_terms', '/j/credit-terms'],
    ['/j/cs/sample-requests', '/cs'],
    ['/cs/orders/new', '/cs'],
    ['/cs/samples/r1/approved', '/cs'],
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
    ...NAV_ENTRIES.flatMap((e) => [e.label, e.description, ...Object.values(e.roleLabels ?? {})]),
    HOME.label, HOME.description!, DASHBOARD.label, DASHBOARD.description!,
    ...Object.values(FEATURE_ACTIONS).flatMap(actions => actions.map(action => action.label)),
    'แสดงเพิ่มเติม ({0})', 'แสดงน้อยลง', 'วันนี้ต้องการทำอะไร', 'เลือกงานด้านล่าง หรือใช้เมนูด้านซ้ายเพื่อไปหน้าอื่น', 'ตอนนี้อยู่ที่', 'ระบบหลังบ้าน', 'สำหรับทีมงาน', 'หน้าหลัก',
  ];

  it('menu copy is named by task: no internal module or system names, in either language', () => {
    const jargon = /josh|commerce|replica|\bMCP\b|workspace|ERP hub|\bhub\b|stub|shadow|ingest|platform|แพลตฟอร์ม|\(ทดลอง\)|webhook/i;
    for (const key of new Set(keys)) {
      for (const text of [key, catalogue[key]?.th ?? '', catalogue[key]?.en ?? '']) expect(text, key).not.toMatch(jargon);
    }
  });

  it('Thai menu copy has no code names a new hire would not know: no SKU / KYC / API / B2B / push, and ERP only in brackets after a Thai name', () => {
    const jargon = /SKU|KYC|\bAPI\b|B2B|\bpush\b|(?<!\()ERP|ERP(?!\))/i;
    for (const key of new Set(keys)) {
      for (const text of [key, catalogue[key]?.th ?? '']) expect(text, key).not.toMatch(jargon);
      expect(catalogue[key]?.en ?? '', key).not.toMatch(/SKU|KYC/);
    }
    expect('ข้อมูลที่รับจากระบบหลัก (ERP)').not.toMatch(jargon);
    expect('ข้อมูลที่รับจาก ERP').toMatch(jargon);
    expect('สินค้าตาม SKU').toMatch(jargon);
  });

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

// #83: sale / sales manager menus
// (adapted: every role's sidebar now starts with Home, /home)
const destinations = (role: string) => navFor(role).flatMap(group => group.links.map(link => link.to)).filter(path => !path.startsWith('/workspaces/'));

describe('sale navigation', () => {
  it('includes only own reports and read-only catalog / prices / stock / password', () => {
    expect(destinations('sale').sort()).toEqual([
      '/account/password', '/erp/inventory-warehouse', '/home', '/products', '/reports/customers',
      '/reports/orders', '/reports/prices', '/reports/sales', '/reports/winback/my',
    ].sort());
  });
  it('manager has team reports, rep KPIs and assignment without PII pages or write areas', () => {
    expect(destinations('sales_manager').sort()).toEqual([
      '/account/password', '/cs/sales-assignment', '/home', '/reports/customers', '/reports/health',
      '/reports/orders', '/reports/order-targetgroup', '/reports/prices', '/reports/sales', '/reports/winback', '/reports/winback/opportunities',
    ].sort());
    expect(navFor('sale_manager')).toEqual(navFor('sales_manager'));
    expect(navFor(' SALE_MANAGER ')).toEqual(navFor('sales_manager'));
  });
  it('every role home appears in its navigation and is permitted by ROLE_ACCESS', () => {
    for (const role of Object.keys(ROLE_HOME)) {
      expect(destinations(role)).toContain(homeForRole(role));
      if (role !== 'admin') expect(ROLE_ACCESS[homeForRole(role)]).toContain(role);
    }
  });
});

describe('role home shortcuts', () => {
  it.each(STAFF_ROLES)('%s: 3–6 shortcuts, each a main task the role may open and has in its sidebar', (role) => {
    const shortcuts = shortcutsFor(role);
    expect(shortcuts.length).toBe(ROLE_SHORTCUTS[role].length); // none dropped for lack of access
    expect(shortcuts.length).toBeGreaterThanOrEqual(3);
    expect(shortcuts.length).toBeLessThanOrEqual(6);
    const links = linksOf(role);
    for (const s of shortcuts) {
      expect(isRouteAllowed(role, s.to), `${role} → ${s.to}`).toBe(true);
      expect(links).toContain(s.to);
      expect(s.description, s.to).toBeTruthy();
    }
    expect(new Set(shortcuts.map((s) => s.to)).size).toBe(shortcuts.length);
  });

  it('shortcuts use the role\'s own labels (a rep sees "My sales")', () => {
    expect(shortcutsFor('sale')[0]).toMatchObject({ to: '/reports/sales', label: 'ยอดขายของฉัน' });
    expect(shortcutsFor('sale_manager')).toEqual(shortcutsFor('sales_manager'));
    expect(shortcutsFor('developer')).toEqual([]);
  });

  it.each(STAFF_ROLES)('%s lands on its home page, which it may open', (role) => {
    expect(landingFor(role)).toBe('/home');
    expect(isRouteAllowed(role, '/home')).toBe(true);
  });
});
