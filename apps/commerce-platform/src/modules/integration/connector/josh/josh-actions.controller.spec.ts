import { JoshActionsController } from './josh-actions.controller';

describe('JoshActionsController — back-office actions', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const req = { staff: { userId: 'staff-1', email: 'ba@jagota.co.th' } } as never;
  const josh = { run: jest.fn(async () => ({ ok: true })) };
  const catalog = { syncId: jest.fn(async () => undefined) };
  const local = { act: jest.fn(async () => ({ local: true })) };
  const c = new JoshActionsController(josh as never, catalog as never, { get: () => local } as never);
  beforeEach(() => { josh.run.mockClear(); catalog.syncId.mockClear(); local.act.mockClear(); });
  afterEach(() => { delete process.env.WINBACK_OWNER; });

  it('winback buttons go to josh until commerce runs winback, then to commerce\'s own services', async () => {
    await c.assign(ID, { assignedSalesUserId: null }, req);
    expect(josh.run).toHaveBeenCalledWith('winback', 'assign', { accountId: ID, assignedSalesUserId: null }, { userId: 'staff-1', email: 'ba@jagota.co.th' }, 'admin');
    process.env.WINBACK_OWNER = 'commerce';
    await expect(c.setTarget({ period_month: '2026-10' }, req)).resolves.toEqual({ local: true });
    expect(local.act).toHaveBeenCalledWith('set_target', { period_month: '2026-10' }, 'ba@jagota.co.th');
    expect(josh.run).toHaveBeenCalledTimes(1);
  });

  it('credit review passes only the review fields josh\'s DTO knows', async () => {
    await c.reviewCredit(ID, { status: 'APPROVED', approved_credit_limit: 50000, approved_term_days: 30, company_id: 'x', credit_limit: 9e9 }, req);
    expect(josh.run).toHaveBeenCalledWith('credit-applications', 'review',
      { applicationId: ID, status: 'APPROVED', approved_credit_limit: 50000, approved_term_days: 30, reject_reason: undefined, accounting_remark: undefined },
      { userId: 'staff-1', email: 'ba@jagota.co.th' }, 'admin');
  });

  it('admin access approve / reject and coupon on/off map to josh\'s actions', async () => {
    await c.approveAccess(ID, { role: 'cs' }, req);
    await c.rejectAccess(ID, { reason: 'ข้อมูลไม่ครบ' }, req);
    await c.setCouponActive(ID, { isActive: false }, req);
    expect(josh.run.mock.calls.map((call) => (call as unknown[]).slice(0, 3))).toEqual([
      ['admin-access', 'approve', { requestId: ID, role: 'cs' }],
      ['admin-access', 'reject', { requestId: ID, reason: 'ข้อมูลไม่ครบ' }],
      ['coupons', 'set_active', { couponId: ID, isActive: false }],
    ]);
  });

  it('product update sends the fields to josh, then refreshes the catalog copy', async () => {
    await c.updateProduct(ID, { fields: { product_name_th: 'ซอส' } }, req);
    expect(josh.run).toHaveBeenCalledWith('products', 'update', { id: ID, fields: { product_name_th: 'ซอส' } }, { userId: 'staff-1', email: 'ba@jagota.co.th' }, 'admin');
    expect(catalog.syncId).toHaveBeenCalledWith(ID);
    await c.updateProduct(ID, { fields: ['x'] as never }, req);
    expect(josh.run).toHaveBeenLastCalledWith('products', 'update', { id: ID, fields: {} }, expect.anything(), 'admin');
  });

  it('product create goes to josh and refreshes the copy of the new product; cuisine tags go as a list', async () => {
    josh.run.mockResolvedValueOnce({ product_inventory_id: ID } as never);
    await c.createProduct({ product: { product_inventory_sku: 'SKU-1' } }, req);
    expect(josh.run).toHaveBeenCalledWith('products', 'create', { product: { product_inventory_sku: 'SKU-1' } }, expect.anything(), 'admin');
    expect(catalog.syncId).toHaveBeenCalledWith(ID);
    await c.setProductCuisines(ID, { cuisineIds: ['c-1'] }, req);
    expect(josh.run).toHaveBeenLastCalledWith('products', 'set_cuisines', { id: ID, cuisine_ids: ['c-1'] }, expect.anything(), 'admin');
    await c.setProductCuisines(ID, { cuisineIds: 'x' }, req);
    expect(josh.run).toHaveBeenLastCalledWith('products', 'set_cuisines', { id: ID, cuisine_ids: [] }, expect.anything(), 'admin');
  });

  it('customer edits map to josh customers actions; suppliers and docs too', async () => {
    await c.updateUser(ID, { changes: { mobile_phone: '0812345678' } }, req);
    await c.updateBranch(ID, { changes: ['x'] as never }, req);
    await c.updateCompany(ID, { changes: { credit_limit: 50000 } }, req);
    await c.assignSales(ID, {}, req);
    await c.removeSupplier(ID, req);
    await c.uploadDoc({ category: 'api', filename: 'a.md', content: '# a' }, req);
    expect(josh.run.mock.calls.map((call) => (call as unknown[]).slice(0, 3))).toEqual([
      ['customers', 'update_user', { userId: ID, changes: { mobile_phone: '0812345678' } }],
      ['customers', 'update_branch', { branchId: ID, changes: {} }],
      ['customers', 'update_company', { companyId: ID, changes: { credit_limit: 50000 } }],
      ['customers', 'assign_sales', { companyId: ID, salesUserId: null }],
      ['suppliers', 'remove', { id: ID }],
      ['internal-docs', 'upload', { category: 'api', title: undefined, filename: 'a.md', content: '# a' }],
    ]);
  });
});
