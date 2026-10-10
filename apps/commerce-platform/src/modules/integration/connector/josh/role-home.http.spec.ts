import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { StaffAuthGuard } from '../../../core/auth/presentation/staff-auth.guard';
import { SalesRepIdentity } from '../../../core/auth/application/sales-rep-identity.service';
import { ShopReportsController } from './shop-reports.controller';
import { JoshInsights } from './josh-insights';
import { JoshProducts } from './josh-products';
import { JoshOrders } from './josh-orders';
import { JoshCustomers } from './josh-customers';
import { JoshPrices } from './josh-prices';
import { JoshPushCampaigns } from './josh-push-campaigns';
import { JoshErpLogs } from './josh-erp-logs';
import { RestaurantPlaces } from './restaurant-places';
import { SystemHealthReport } from './system-health';

describe('role home HTTP scope (isolated localhost)', () => {
  let app: INestApplication, base: string;
  const roles = ['admin', 'marketing', 'merchandising', 'cs', 'sale', 'sales_manager', 'business_analyst', 'graphic', 'sale_manager'];
  const tokens = new Map<string, string>();
  const calls = { catalog: jest.fn(), sales: jest.fn(), orders: jest.fn(), traffic: jest.fn(), push: jest.fn(), identity: jest.fn() };
  beforeAll(async () => {
    const jwt = new JwtService({ secret: 'local-role-home-test-only' });
    const users = { findOne: async ({ where }: { where: { id: string } }) => roles.includes(where.id) ? { id: where.id, email: `${where.id}@example.invalid`, role: where.id, status: 'active' } : null };
    const mod = await Test.createTestingModule({ controllers: [ShopReportsController], providers: [
      { provide: JoshInsights, useValue: { available: true, salesAvailable: true, sales: calls.sales, traffic: calls.traffic } },
      { provide: JoshProducts, useValue: { available: true, summary: calls.catalog } },
      { provide: JoshOrders, useValue: { available: true, summary: calls.orders } },
      { provide: JoshPushCampaigns, useValue: { available: true, overview: calls.push } },
      { provide: SalesRepIdentity, useValue: { repIdsFor: calls.identity } },
      ...[JoshCustomers, JoshPrices, JoshErpLogs, RestaurantPlaces, SystemHealthReport].map(provide => ({ provide, useValue: {} })),
    ] }).compile();
    app = mod.createNestApplication({ logger: false }); app.setGlobalPrefix('api');
    app.useGlobalGuards(new StaffAuthGuard(jwt, new Reflector(), users as never));
    await app.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/reports/home`;
    for (const role of roles) tokens.set(role, await jwt.signAsync({ sub: role, role }));
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    Object.values(calls).forEach(fn => fn.mockReset());
    calls.catalog.mockResolvedValue({ total: 4, no_price: 1, no_image: 2, no_category: 1, out_of_stock: 1 });
    calls.sales.mockResolvedValue({ totals: { revenue_inc_vat: 100, orders: 2, average_order_inc_vat: 50 } });
    calls.orders.mockResolvedValue({ awaiting_payment: 0 }); calls.traffic.mockResolvedValue({ totals: { sessions: 10 } });
    calls.push.mockResolvedValue({ campaigns: 2, totalSent: 5 }); calls.identity.mockResolvedValue(['assigned-rep']);
  });
  const read = (role: string, query = '') => fetch(base + query, { headers: { authorization: `Bearer ${tokens.get(role)}` } });
  it('requires authentication before all reads', async () => { expect((await fetch(base)).status).toBe(401); expect(Object.values(calls).every(fn => !fn.mock.calls.length)).toBe(true); });
  it.each(roles.filter(role => !['cs', 'graphic'].includes(role)))('%s reads only existing authorized sources', async role => {
    const response = await read(role); expect(response.status).toBe(200); const body = await response.json();
    const normalized = role === 'sale_manager' ? 'sales_manager' : role;
    expect(body.role).toBe(normalized);
    expect(calls.catalog.mock.calls.length).toBe(['admin', 'marketing', 'merchandising'].includes(normalized) ? 1 : 0);
    expect(calls.sales.mock.calls.length).toBe(['admin', 'sale', 'sales_manager', 'business_analyst'].includes(normalized) ? 1 : 0);
    expect(calls.orders.mock.calls.length).toBe(calls.sales.mock.calls.length);
    expect(calls.traffic.mock.calls.length).toBe(normalized === 'marketing' ? 1 : 0); expect(calls.push.mock.calls.length).toBe(normalized === 'marketing' ? 1 : 0);
    if (normalized === 'sale') {
      expect(calls.sales.mock.calls[0][3]).toEqual(['assigned-rep']); expect(calls.orders.mock.calls[0][0]).toEqual({ repIds: ['assigned-rep'] });
    } else expect(calls.identity).not.toHaveBeenCalled();
  });
  it.each(['cs', 'graphic'])('%s retains the existing report restriction before reads', async role => {
    expect((await read(role)).status).toBe(403); expect(Object.values(calls).every(fn => !fn.mock.calls.length)).toBe(true);
  });
  it('does not broaden an unmapped salesperson or a failed identity reader', async () => {
    calls.identity.mockResolvedValue([]); await read('sale'); expect(calls.sales.mock.calls[0][3]).toEqual([]);
    calls.sales.mockClear(); calls.orders.mockClear(); calls.identity.mockRejectedValue(new Error('identity SQL secret'));
    const body = await (await read('sale')).json(); expect(body.failedSources).toEqual(['orders', 'sales']);
    expect(calls.sales).not.toHaveBeenCalled(); expect(calls.orders).not.toHaveBeenCalled(); expect(JSON.stringify(body)).not.toContain('secret');
  });
  it('retains independent metrics on failure and recovers on retry', async () => {
    calls.traffic.mockRejectedValueOnce(new Error('db URL secret'));
    const body = await (await read('marketing')).json(); expect(body.failedSources).toEqual(['traffic']);
    expect(body.metrics.find((m: { key: string }) => m.key === 'catalog_records').value).toBe(4); expect(JSON.stringify(body)).not.toContain('secret');
    expect((await (await read('marketing')).json()).failedSources).toEqual([]);
  });
  it('rejects widening/unknown/invalid queries before source reads and exposes no write', async () => {
    for (const q of ['?role=admin', '?salesUserId=11111111-1111-4111-8111-111111111111', '?period=bad', '?period=custom&fromDate=bad&toDate=bad']) expect((await read('sale', q)).status).toBe(400);
    expect(Object.values(calls).every(fn => !fn.mock.calls.length)).toBe(true);
    for (const method of ['POST', 'PATCH', 'DELETE']) expect((await fetch(base, { method, headers: { authorization: `Bearer ${tokens.get('admin')}` } })).status).toBe(404);
  });
});
