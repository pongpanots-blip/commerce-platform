import { describe, expect, it } from 'vitest';
import { navFor, ROLE_ACCESS } from './navigation';
import { homeForRole, ROLE_HOME } from '../lib/role-home';

const destinations = (role: string) => navFor(role).flatMap(group => group.links.map(link => link.to)).filter(path => !path.startsWith('/workspaces/'));

describe('sale navigation', () => {
  it('includes only own reports and read-only catalog / prices / stock / password', () => {
    expect(destinations('sale').sort()).toEqual([
      '/account/password', '/erp/inventory-warehouse', '/products', '/reports/customers',
      '/reports/orders', '/reports/prices', '/reports/sales', '/reports/winback/my',
    ].sort());
  });
  it('manager has team reports, rep KPIs and assignment without PII pages or write areas', () => {
    expect(destinations('sales_manager').sort()).toEqual([
      '/account/password', '/cs/sales-assignment', '/reports/customers', '/reports/health',
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
