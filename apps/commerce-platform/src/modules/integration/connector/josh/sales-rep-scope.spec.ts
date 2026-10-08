import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { JoshCustomers } from './josh-customers';
import { JoshOrders } from './josh-orders';
import { JoshInsights, bangkokRange } from './josh-insights';
import { JoshPrices } from './josh-prices';
import { ShopReportsController } from './shop-reports.controller';

const REP = '11111111-1111-4111-8111-111111111111';
const LINKED = '22222222-2222-4222-8222-222222222222';
const COMPANY = '33333333-3333-4333-8333-333333333333';
const ids = [REP, LINKED];
const sale = { staff: { userId: REP, email: 'rep@example.test', role: 'sale' as const } };
const manager = { staff: { ...sale.staff, role: 'sales_manager' as const } };
const person = { first_name: 'Somchai', last_name: 'Customer', email: 'customer@example.test', mobile_phone: '0898765432' };

function customers() {
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    const scope = params.find(Array.isArray) as string[] | undefined;
    const own = scope === undefined || scope.includes(LINKED);
    if ((/\bAS total\b/).test(sql)) return [{ total: own ? 1 : 0 }];
    if (sql.includes('SELECT c.id')) return own ? [{ id: COMPANY, phone: '0898765432', register_number: '1234567890123' }] : [];
    if (sql.includes('FROM branch WHERE')) return [{ phone: '0898765432', tax_id: '1234567890123' }];
    if (sql.includes('FROM users WHERE')) return [{ id: 'person', ...person }];
    return [];
  });
  return { service: new JoshCustomers({ query } as never), query };
}

describe('customer own scope and masking', () => {
  it('binds assignment scope in list, count and summary, even for no mapping', async () => {
    const { service, query } = customers();
    expect((await service.list({ search: 'company', repIds: ids })).total).toBe(1);
    expect(await service.summary({ repIds: ids })).toMatchObject({ total: 1 });
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toMatch(/c\.assigned_sales_user_id = ANY\(\$\d+::uuid\[\]\)/);
      expect(params).toContainEqual(ids);
    }
    expect(await service.list({ repIds: [REP] })).toMatchObject({ items: [], total: 0 });
    expect(await service.summary({ repIds: [] })).toMatchObject({ total: 0 });
  });

  it('non-own detail is 404 and reads no contacts', async () => {
    const { service, query } = customers();
    await expect(service.detail(COMPANY, [REP])).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('AND c.assigned_sales_user_id = ANY($2::uuid[])');
  });

  it('sale sees own contacts unmasked; manager defaults stay masked', async () => {
    const { service } = customers();
    const own = await service.detail(COMPANY, ids, { unmask: true });
    expect(own.phone).toBe('0898765432');
    expect(own.users[0]).toMatchObject(person);
    expect(own.branches[0]).toMatchObject({ phone: '0898765432', tax_id: '1234567890123' });
    const team = await service.detail(COMPANY);
    expect(team.phone).not.toBe('0898765432');
    expect(team.users[0]).not.toMatchObject(person);
    expect(team.users[0].email).not.toBe(person.email);
  });
});

describe.each(['replica', 'copies'] as const)('%s orders / sales', source => {
  const oldSource = process.env.ORDERS_SOURCE;
  beforeEach(() => { process.env.ORDERS_SOURCE = source; });
  afterEach(() => { if (oldSource === undefined) delete process.env.ORDERS_SOURCE; else process.env.ORDERS_SOURCE = oldSource; });

  it('scopes order list, count, summary and detail before reading lines; no mapping stays empty', async () => {
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
      const scope = params.find(Array.isArray) as string[] | undefined;
      const own = scope?.includes(LINKED);
      if ((/\bAS total\b/).test(sql)) return [{ total: own ? 1 : 0 }];
      return [];
    });
    const orders = new JoshOrders({ configured: true, query } as never, { query } as never);
    await orders.list({ repIds: ids });
    await orders.summary({ repIds: ids });
    await expect(orders.detail('SO1', ids)).rejects.toBeInstanceOf(NotFoundException);
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toContain('assigned_sales_user_id');
      expect(sql).toContain('::uuid[])');
      expect(params).toContainEqual(ids);
      if (source === 'copies') expect(sql).toContain('company_sales_reps');
    }
    expect(await orders.list({ repIds: [] })).toMatchObject({ items: [], total: 0 });
  });

  it('scopes every sales query, including previous period, new customers, refunds and top products', async () => {
    const query = jest.fn(async (_sql: string, _params: unknown[]) => [{ revenue_inc_vat: 0, orders: 0, n: 0, amount: 0 }]);
    const insights = new JoshInsights({ query } as never, { query } as never);
    await insights.sales(bangkokRange('this_month'), 20, source, ids);
    expect(query).toHaveBeenCalledTimes(6);
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toContain('assigned_sales_user_id');
      expect(sql).toContain('::uuid[])');
      expect(params).toContainEqual(ids);
      if (source === 'copies') expect(sql).toContain('company_sales_reps');
    }
    query.mockClear();
    const empty = await insights.sales(bangkokRange('this_month'), 20, source, []);
    expect(empty.totals.revenue_inc_vat).toBe(0);
    for (const [, params] of query.mock.calls) expect(params).toContainEqual([]);
  });

  it('rep KPIs group paid orders by current rep without PII', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new JoshInsights({ query } as never, { query } as never).salesByRep(bangkokRange('this_month').current, source);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('AS sales_user_id');
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain('count(DISTINCT o.user_id)');
    expect(sql).not.toMatch(/email|phone/);
    expect(params[2]).toEqual(['paid', 'preparing', 'shipped', 'delivered']);
  });
});

describe('customer-specific prices', () => {
  it('scopes the branch picker and refuses non-own branch / quotation before price reads', async () => {
    const query = jest.fn(async (_sql: string, _params: unknown[]) => []);
    const prices = new JoshPrices({ query } as never);
    await prices.branches('x', ids);
    expect(query.mock.calls[0]).toEqual([expect.stringContaining('c.assigned_sales_user_id = ANY($2::uuid[])'), ['%x%', ids]]);
    await expect(prices.forBranch(COMPANY, undefined, undefined, ids)).rejects.toBeInstanceOf(NotFoundException);
    await expect(prices.quotations('C001', ids)).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledTimes(3);
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toContain('assigned_sales_user_id');
      expect(params).toContainEqual(ids);
    }
  });

  it('allows own branch and quotations with mapping, empty mapping yields no data', async () => {
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('assigned_sales_user_id')) {
        return (params.find(Array.isArray) as string[])?.includes(LINKED) ? [{ id: COMPANY, branch_id: COMPANY, company_id: COMPANY }] : [];
      }
      return [];
    });
    const prices = new JoshPrices({ query } as never);
    expect(await prices.forBranch(COMPANY, undefined, undefined, ids)).toMatchObject({ items: [] });
    expect(await prices.quotations('C001', ids)).toEqual([]);
    expect(await prices.branches('', [])).toEqual([]);
    await expect(prices.quotations('C001', [])).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('report controller derives scope from authenticated DB role', () => {
  const identity = { repIdsFor: jest.fn().mockResolvedValue(ids) };
  const insights = { available: true, salesAvailable: true, sales: jest.fn(), salesByRep: jest.fn() };
  const orders = { available: true, list: jest.fn(), detail: jest.fn(), summary: jest.fn() };
  const customers = { list: jest.fn(), detail: jest.fn(), summary: jest.fn() };
  const prices = { branches: jest.fn(), forBranch: jest.fn(), quotations: jest.fn() };
  const c = new ShopReportsController(insights as never, {} as never, {} as never, {} as never, {} as never, {} as never, orders as never, customers as never, prices as never, identity as never);
  beforeEach(() => jest.clearAllMocks());

  it('overwrites forged repIds / unmask query parameters; manager contacts remain masked', async () => {
    await c.customerList({ repIds: ['forged'] }, sale);
    expect(customers.list).toHaveBeenLastCalledWith({ repIds: ids }, 1, 50, { unmask: true });
    await c.customerDetail(COMPANY, manager);
    expect(customers.detail).toHaveBeenLastCalledWith(COMPANY, undefined, { unmask: false });
    await c.orderList({ repIds: ['forged'] }, sale);
    expect(orders.list).toHaveBeenLastCalledWith({ repIds: ids }, 1, 50);
    await c.sales({}, sale);
    expect(insights.sales).toHaveBeenLastCalledWith(expect.anything(), 20, undefined, ids);
  });

  it('only managers can select a valid rep uuid, consistently across sales / orders / customers', async () => {
    await expect(c.sales({ salesUserId: 'invalid' }, manager)).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.sales({ salesUserId: LINKED }, sale)).rejects.toBeInstanceOf(BadRequestException);
    await c.sales({ salesUserId: LINKED }, manager);
    expect(insights.sales).toHaveBeenLastCalledWith(expect.anything(), 20, undefined, [LINKED]);
    await c.orderList({ salesUserId: LINKED }, manager);
    expect(orders.list).toHaveBeenLastCalledWith(expect.objectContaining({ repIds: [LINKED] }), 1, 50);
    await c.customerSummary({ salesUserId: LINKED }, manager);
    expect(customers.summary).toHaveBeenLastCalledWith({ repIds: [LINKED] });
  });

  it('refuses unavailable sources', async () => {
    insights.salesAvailable = false;
    await expect(c.sales({}, sale)).rejects.toBeInstanceOf(ServiceUnavailableException);
    insights.salesAvailable = true;
    orders.available = false;
    await expect(c.orderList({}, sale)).rejects.toBeInstanceOf(ServiceUnavailableException);
    orders.available = true;
  });
});
