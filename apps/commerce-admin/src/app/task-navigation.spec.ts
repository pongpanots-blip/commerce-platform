import { describe, expect, it } from 'vitest';
import { navFor } from './navigation';
import { taskFeatureNavFor, taskSectionsFor, taskSidebarFor, isProtectedWelcome } from './task-navigation';
import { isRouteAllowed, resolvePostLoginPath } from '../lib/landing';
const roles = ['admin', 'marketing', 'merchandising', 'cs', 'sale', 'sales_manager', 'business_analyst', 'graphic'];
describe('canonical task indexes', () => {
  it.each(roles)('%s preserves every authorized canonical feature with fewer sidebar destinations', role => {
    const original = navFor(role).filter(group => group.group).flatMap(group => group.links.filter(link => role !== 'admin' || link.to !== '/reports/winback/my').map(link => link.to));
    const indexes = taskSectionsFor(role);
    const destinations = indexes.flatMap(section => section.links.map(link => link.to));
    expect(destinations.sort()).toEqual([...original, ...(['admin','sale','sales_manager'].includes(role)?['/planning/sales-work']:[]), ...(['admin','marketing'].includes(role)?['/planning/marketing-readiness']:[]), ...(['admin', 'sales_manager', 'business_analyst'].includes(role) ? ['/planning/profit-goals'] : []), ...(['admin', 'marketing', 'business_analyst'].includes(role) ? ['/planning/pack-prices'] : []), ...(role === 'admin' ? ['/planning/promotions', '/review/orders'] : [])].sort());
    expect(new Set(destinations).size).toBe(destinations.length);
    const sidebar = taskSidebarFor(role).flatMap(group => group.links);
    expect(new Set(sidebar.map(link => link.to)).size).toBe(sidebar.length);
    expect(sidebar.length).toBeLessThanOrEqual(9);
    for (const section of indexes) {
      expect(isRouteAllowed(role, section.to)).toBe(true);
      expect(resolvePostLoginPath(role, `${section.to}?q=price#tasks`)).toBe(`${section.to}?q=price#tasks`);
      for (const link of section.links) expect(isRouteAllowed(role, link.to)).toBe(true);
    }
  });
  it('admin has one Sales home while legacy own/team URLs and sale scope remain available', () => {
    const admin = taskFeatureNavFor('admin').flatMap(g => g.links);
    expect(admin.filter(l => l.to === '/reports/winback/my')).toEqual([]);
    expect(admin.filter(l => l.to === '/reports/winback/opportunities')).toHaveLength(1);
    expect(admin.find(l => l.to === '/reports/winback/opportunities')?.activeFor).toContain('/reports/winback/my');
    expect(navFor('admin').flatMap(g => g.links).some(l => l.to === '/reports/winback/my')).toBe(true);
    expect(isRouteAllowed('admin', '/reports/winback/my/leads')).toBe(true);
    expect(taskFeatureNavFor('sale').flatMap(g => g.links).filter(l => l.to === '/reports/winback/my')).toHaveLength(1);
  });
  it('does not grant inaccessible indexes or expand feature permissions', () => {
    expect(isRouteAllowed('cs', '/tasks/catalog')).toBe(false);
    expect(isRouteAllowed('sale', '/tasks/advanced')).toBe(false);
    expect(isRouteAllowed('merchandising', '/j/marketing/competitor-prices')).toBe(false);
    expect(isRouteAllowed('cs', '/j/payment-transactions/attempt-1')).toBe(false);
    expect(isRouteAllowed('cs', '/cs/accounts/merge')).toBe(false);
    expect(isRouteAllowed('graphic', '/j/product/create')).toBe(false);
    expect(isRouteAllowed('graphic', '/tasks/catalog')).toBe(true);
    expect(isRouteAllowed('sale', '/tasks/not-a-section')).toBe(false);
    expect(taskSidebarFor('sale_manager')).toEqual(taskSidebarFor('sales_manager'));
    expect(taskSectionsFor('unrecognized')).toEqual([]);
  });
  it.each(roles)('%s has one canonical Today entry and retains legacy home access', role => {
    expect(taskFeatureNavFor(role).flatMap(g => g.links).filter(l => l.to === '/today')).toHaveLength(1);
    expect(taskSidebarFor(role).flatMap(g => g.links).filter(l => l.to === '/today')).toHaveLength(1);
    expect(isRouteAllowed(role, '/today?group=gap')).toBe(true);
    expect(isRouteAllowed(role, '/home')).toBe(true);
    expect(resolvePostLoginPath(role, '/today?group=pending')).toBe('/today?group=pending');
  });
  it('protects the welcome route including trailing slash without excluding other marketing pages', () => {
    expect(isProtectedWelcome('/j/marketing/welcome-lead-email')).toBe(true);
    expect(isProtectedWelcome('/j/marketing/welcome-lead-email/')).toBe(true);
    expect(isProtectedWelcome('/j/marketing/notify-templates')).toBe(false);
  });
  it.each(roles)('%s inherits only existing competitor permission for pack planning deep links', role => {
    const allowed = ['admin', 'marketing', 'business_analyst'].includes(role);
    expect(isRouteAllowed(role, '/planning/pack-prices/new/review')).toBe(allowed);
    expect(taskFeatureNavFor(role).flatMap(g => g.links).filter(l => l.to === '/planning/pack-prices')).toHaveLength(allowed ? 1 : 0);
    expect(resolvePostLoginPath(role, '/planning/pack-prices/new/observations')).toBe(allowed ? '/planning/pack-prices/new/observations' : '/home');
  });
});

it.each(roles)('%s has one canonical commercial task home and preserves action deep links',role=>{for(const [home,allowed] of [['/planning/sales-work',['admin','sale','sales_manager']],['/planning/marketing-readiness',['admin','marketing']]] as const){expect(taskFeatureNavFor(role).flatMap(g=>g.links).filter(l=>l.to===home)).toHaveLength(allowed.includes(role as never)?1:0);expect(isRouteAllowed(role,home+'/new/review')).toBe(allowed.includes(role as never));expect(isRouteAllowed(role,home+'/requests/00000000-0000-4000-8000-000000000099')).toBe(allowed.includes(role as never));}});
