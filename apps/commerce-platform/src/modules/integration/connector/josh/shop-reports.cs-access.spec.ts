import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { StaffAuthGuard } from '../../../core/auth/presentation/staff-auth.guard';
import { StaffRequest } from '../../../../shared-kernel/presentation/auth.decorators';
import { csCustomerDetailView, csCustomerSearch, csCustomerSearchView, csProductSearch, csProductSearchView } from './cs-desk-search';
import { JoshCustomers } from './josh-customers';
import { JoshProducts } from './josh-products';
import { ShopReportsController } from './shop-reports.controller';

const COMPANY = '33333333-3333-4333-8333-333333333333';
const REP = '11111111-1111-4111-8111-111111111111';
const as = (role: string) => ({ staff: { userId: 'u-1', email: 'a@b.c', role } }) as StaffRequest;
const cs = as('cs');

/** Everything josh-customers / josh-products select, so a projection that leaks a column shows up. */
const companyRow = { id: COMPANY, name: 'Acme', assigned_sales_user_id: REP, erp_customer_code: 'C001', register_number: '1234567890123', business_type: 'hotel',
  phone: '0898765432', credit_limit: 100000, credit_used: 2500, credit_term_days: 30, credit_term_renews_at: null, document_language: 'th', created_at: '2026-01-01',
  kyc_status: 'approved', branch_count: 1, user_count: 1, kyc_docs: 2, last_order_at: '2026-09-01' };
const branchRow = { id: 'b1', name: 'Main', type: 'restaurant', erp_branch_code: 'B01', erp_sync_status: 'ok', is_default_delivery: true, is_out_of_area: false,
  delivery_days: 'mon', credit_term: 30, phone: '0898765432', tax_id: '1234567890123' };
const userRow = { id: 'p1', first_name: 'Somchai', last_name: 'Customer', email: 'customer@example.test', mobile_phone: '0898765432', role: 'owner', is_active: true,
  onboarding_completed: true, last_app_login_at: null, created_at: '2026-01-01' };
const productRow = { product_inventory_id: 'pi1', product_inventory_sku: '1001876', product_status: 'active', name_th: 'แซลมอน', name_en: 'Salmon', category_id: 'c1',
  category_name_th: 'ปลา', category_path: 'fish', brand_code: 'B', brand_name: 'Brand', selling_unit_price: 250, ordering_price: 200, original_price: 180,
  product_inventory_quantity: 7, low_stock_threshold: 1, moq: 1, selling_unit: 'kg', pack_size: '1kg', order_taking_flag: 'Y', sup_code: 'S1' };

function setup() {
  const query = jest.fn(async (sql: string, _params: unknown[] = []) => {
    if ((/\bAS total\b/).test(sql)) return [{ total: 1 }];
    if (sql.includes('FROM product_inventory p')) return [productRow];
    if (sql.includes('SELECT c.id')) return [companyRow];
    if (sql.includes('FROM branch WHERE')) return [branchRow];
    if (sql.includes('FROM users WHERE')) return [userRow];
    if (sql.includes('FROM orders o WHERE')) return [{ orders: 3, paid_value: 1000, last_order_at: '2026-09-01' }];
    return [];
  });
  const replica = { configured: true, query };
  const customers = new JoshCustomers(replica as never);
  const products = new JoshProducts(replica as never, {} as never);
  const identity = { repIdsFor: jest.fn().mockResolvedValue([REP]) };
  const insights = { available: true };
  const c = new ShopReportsController(insights as never, {} as never, {} as never, {} as never, {} as never, products, {} as never, customers, {} as never, identity as never);
  return { c, query, customers, products, identity };
}

const oldSource = process.env.PRODUCTS_SOURCE;
beforeAll(() => { delete process.env.PRODUCTS_SOURCE; });
afterAll(() => { if (oldSource !== undefined) process.env.PRODUCTS_SOURCE = oldSource; });

describe('cs desk search helpers', () => {
  it('require a non-empty search and refuse every other filter', () => {
    expect(csCustomerSearch({ search: ' acme ', page: '1', limit: '20' })).toEqual({ search: 'acme' });
    for (const q of [{}, { search: '' }, { search: '   ' }, { search: ['a', 'b'] }, { search: { x: 1 } }]) expect(() => csCustomerSearch(q)).toThrow(BadRequestException);
    for (const extra of ['issue', 'salesUserId', 'repIds', 'status']) expect(() => csCustomerSearch({ search: 'a', [extra]: 'x' })).toThrow(BadRequestException);
    expect(csProductSearch({ search: 'salmon' })).toEqual({ search: 'salmon', status: 'active' });
    expect(csProductSearch({ search: 'salmon', status: 'active' })).toEqual({ search: 'salmon', status: 'active' });
    expect(() => csProductSearch({ search: 'salmon', status: 'inactive' })).toThrow(BadRequestException);
    expect(() => csProductSearch({ status: 'active' })).toThrow(BadRequestException);
    for (const extra of ['issue', 'categoryId', 'brand', 'orderTaking']) expect(() => csProductSearch({ search: 'a', [extra]: 'x' } as never)).toThrow(BadRequestException);
  });

  it('project to exactly the columns the desk shows', () => {
    expect(csCustomerSearchView({ items: [companyRow], total: 1 })).toEqual({ items: [{ id: COMPANY, name: 'Acme', erp_customer_code: 'C001' }], total: 1 });
    expect(csCustomerDetailView({ ...companyRow, users: [userRow], branches: [branchRow] })).toEqual({
      id: COMPANY, name: 'Acme', erp_customer_code: 'C001', credit_limit: 100000, credit_used: 2500, credit_term_days: 30,
      users: [{ id: 'p1', first_name: 'Somchai', last_name: 'Customer', role: 'owner', is_active: true }],
      branches: [{ id: 'b1', name: 'Main', is_default_delivery: true }],
    });
    expect(csProductSearchView({ items: [productRow], total: 1, page: 1, limit: 10 })).toEqual({
      items: [{ product_inventory_id: 'pi1', product_inventory_sku: '1001876', name_th: 'แซลมอน', name_en: 'Salmon', selling_unit_price: 250, selling_unit: 'kg' }], total: 1, page: 1, limit: 10,
    });
  });
});

describe('ShopReportsController as cs', () => {
  it('customer search: what CsDesk sends works, scoped to all customers, projected', async () => {
    const { c, query, identity } = setup();
    const r = await c.customerList({ search: 'acme', page: '1', limit: '20' }, cs);
    expect(r).toEqual({ items: [{ id: COMPANY, name: 'Acme', erp_customer_code: 'C001' }], total: 1 });
    expect(identity.repIdsFor).not.toHaveBeenCalled();
    expect(query.mock.calls[0][0]).not.toContain('assigned_sales_user_id = ANY');
    expect(query.mock.calls[0][1]).toEqual(['%acme%', 20, 0]);
  });

  it('customer search: 400 without search, past 20, with salesUserId or any other filter', async () => {
    const { c, query } = setup();
    for (const q of [{}, { search: ' ' }, { search: 'a', limit: '21' }, { search: 'a', salesUserId: REP }, { search: 'a', issue: 'over_credit' }, { search: 'a', repIds: [REP] }]) {
      await expect(c.customerList(q as never, cs)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('customer detail: only the users / branches / credit the desk shows — no phone, email, address, tax id', async () => {
    const { c } = setup();
    const d = await c.customerDetail(COMPANY, cs) as Record<string, unknown> & { users: object[]; branches: object[] };
    expect(Object.keys(d).sort()).toEqual(['branches', 'credit_limit', 'credit_term_days', 'credit_used', 'erp_customer_code', 'id', 'name', 'users']);
    expect(Object.keys(d.users[0]).sort()).toEqual(['first_name', 'id', 'is_active', 'last_name', 'role']);
    expect(Object.keys(d.branches[0]).sort()).toEqual(['id', 'is_default_delivery', 'name']);
    expect(d.users[0]).toMatchObject({ first_name: 'Somchai', last_name: 'C.' }); // still masked, as for the team roles
    expect(JSON.stringify(d)).not.toMatch(/0898765432|1234567890123|customer@example\.test|register_number|tax_id|phone|email/);
  });

  it('product search: what CsDesk sends works, forced active, capped at 10, projected', async () => {
    const { c, query } = setup();
    const r = await c.productList({ search: 'salmon', status: 'active', page: '1', limit: '10' }, cs);
    expect(r).toEqual({ items: [{ product_inventory_id: 'pi1', product_inventory_sku: '1001876', name_th: 'แซลมอน', name_en: 'Salmon', selling_unit_price: 250, selling_unit: 'kg' }], total: 1, page: 1, limit: 10 });
    expect(query.mock.calls[0][1]).toEqual(['%salmon%', 'active', 10, 0]);
    await c.productList({ search: 'salmon' }, cs);
    expect(query.mock.calls[2][1]).toEqual(['%salmon%', 'active', 10, 0]);
  });

  it('product search: 400 without search, past 10, non-active status or any other filter', async () => {
    const { c, query } = setup();
    for (const q of [{}, { status: 'active' }, { search: 'a', limit: '11' }, { search: 'a', status: 'inactive' }, { search: 'a', issue: 'no_price' }, { search: 'a', brand: 'x' }]) {
      await expect(c.productList(q as never, cs)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(query).not.toHaveBeenCalled();
  });
});

describe('ShopReportsController, other roles unchanged on the three handlers', () => {
  it('returns the service result as-is (no projection, no search requirement)', async () => {
    for (const role of ['admin', 'sales_manager', 'business_analyst', 'sale']) {
      const { c, customers } = setup();
      const list = jest.spyOn(customers, 'list');
      const detail = jest.spyOn(customers, 'detail');
      const r = await c.customerList({}, as(role));
      expect(r).toBe(await list.mock.results[0].value);
      expect(r.items[0]).toHaveProperty('register_number');
      expect(list).toHaveBeenLastCalledWith({ repIds: role === 'sale' ? [REP] : undefined }, 1, 50, { unmask: role === 'sale' });
      const d = await c.customerDetail(COMPANY, as(role));
      expect(d).toBe(await detail.mock.results[0].value);
      expect(d).toHaveProperty('kycDocuments');
      expect(detail).toHaveBeenLastCalledWith(COMPANY, role === 'sale' ? [REP] : undefined, { unmask: role === 'sale' });
    }
    for (const role of ['admin', 'marketing', 'merchandising']) {
      const { c, products } = setup();
      const list = jest.spyOn(products, 'list');
      const r = await c.productList({ status: 'inactive', limit: '200' }, as(role));
      expect(r).toBe(await list.mock.results[0].value);
      expect(list).toHaveBeenLastCalledWith({ status: 'inactive', limit: '200' }, 1, 200);
      expect(r.items[0]).toHaveProperty('ordering_price');
    }
  });

  it('salesUserId stays a manager-only choice', async () => {
    const { c, customers } = setup();
    const list = jest.spyOn(customers, 'list');
    await expect(c.customerList({ salesUserId: REP }, as('sale'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.customerList({ salesUserId: REP }, as('business_analyst'))).rejects.toBeInstanceOf(BadRequestException);
    await c.customerList({ salesUserId: REP }, as('sales_manager'));
    expect(list).toHaveBeenLastCalledWith({ salesUserId: REP, repIds: [REP] }, 1, 50, { unmask: false });
  });
});

describe('role aliases reach the handlers normalised (real guard → controller)', () => {
  const jwt = new JwtService({ secret: 'test-secret' });
  async function through(role: string, handler: unknown) {
    const users = { findOne: jest.fn(async () => ({ id: 'u-1', email: 'a@b.c', role, status: 'active' })) };
    const request: Record<string, unknown> = { headers: { authorization: `Bearer ${await jwt.signAsync({ sub: 'u-1', email: 'a@b.c', role })}` }, method: 'GET' };
    const context = { getType: () => 'http', getHandler: () => handler, getClass: () => ShopReportsController, switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    await new StaffAuthGuard(jwt, new Reflector(), users as never).canActivate(context);
    return request as unknown as StaffRequest;
  }

  it.each(['CS', ' cs '])('"%s" gets the cs view', async role => {
    const { c } = setup();
    const req = await through(role, ShopReportsController.prototype.customerList);
    expect(req.staff.role).toBe('cs');
    await expect(c.customerList({}, req)).rejects.toBeInstanceOf(BadRequestException);
    expect(await c.customerList({ search: 'acme' }, req)).toEqual({ items: [{ id: COMPANY, name: 'Acme', erp_customer_code: 'C001' }], total: 1 });
    const productReq = await through(role, ShopReportsController.prototype.productList);
    expect((await c.productList({ search: 'salmon' }, productReq)).items[0]).not.toHaveProperty('ordering_price');
  });

  it('sale_manager still behaves as sales_manager (full list, may pick a rep)', async () => {
    const { c, customers } = setup();
    const list = jest.spyOn(customers, 'list');
    const req = await through('sale_manager', ShopReportsController.prototype.customerList);
    expect(req.staff.role).toBe('sales_manager');
    const r = await c.customerList({ salesUserId: REP }, req);
    expect(r).toHaveProperty('page', 1);
    expect(list).toHaveBeenLastCalledWith({ salesUserId: REP, repIds: [REP] }, 1, 50, { unmask: false });
  });
});
