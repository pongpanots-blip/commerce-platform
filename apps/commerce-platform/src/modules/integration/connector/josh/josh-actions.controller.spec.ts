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

  it('stage 4a: once commerce owns prices the base price is saved in commerce, the rest still goes to josh', async () => {
    const prices = { edit: jest.fn(async () => ({ sku: 'SKU-1', sellingUnitPrice: 12 })) };
    const db = { query: jest.fn(async () => [{ sku: 'SKU-1' }]) };
    const ctl = new JoshActionsController(josh as never, catalog as never, { get: (cls: { name: string }) => (cls.name === 'DataSource' ? db : prices) } as never);
    await ctl.updateProduct(ID, { fields: { selling_unit_price: 10, product_name_th: 'ซอส' } }, req);
    expect(josh.run).toHaveBeenLastCalledWith('products', 'update', { id: ID, fields: { selling_unit_price: 10, product_name_th: 'ซอส' } }, expect.anything(), 'admin');
    process.env.COMMERCE_OWNS_PRICES = 'true';
    try {
      await expect(ctl.updateProduct(ID, { fields: { selling_unit_price: '12', product_name_th: 'ซอส' } }, req))
        .resolves.toMatchObject({ price: { sellingUnitPrice: 12 } });
      expect(prices.edit).toHaveBeenCalledWith('SKU-1', { sellingUnitPrice: 12 }, 'staff-1');
      expect(josh.run).toHaveBeenLastCalledWith('products', 'update', { id: ID, fields: { product_name_th: 'ซอส' } }, expect.anything(), 'admin');
      josh.run.mockClear();
      await ctl.updateProduct(ID, { fields: { selling_unit_price: 13 } }, req);
      expect(josh.run).not.toHaveBeenCalled();
    } finally { delete process.env.COMMERCE_OWNS_PRICES; }
  });

  it('stage 4b: once commerce owns content those keys are validated and saved in commerce, the rest still goes to josh', async () => {
    const contents = { edit: jest.fn(async () => ({ sku: 'SKU-1', fields: {} })) };
    const db = { query: jest.fn(async () => [{ sku: 'SKU-1' }]) };
    const ctl = new JoshActionsController(josh as never, catalog as never, { get: (cls: { name: string }) => (cls.name === 'DataSource' ? db : contents) } as never);
    process.env.COMMERCE_OWNS_PRODUCT_CONTENT = 'true';
    try {
      await ctl.updateProduct(ID, { fields: { product_name_th: ' ซอส ', ingredients: '', selling_unit: 'kg' } }, req);
      expect(contents.edit).toHaveBeenCalledWith('SKU-1', { product_name_th: 'ซอส', ingredients: null }, 'staff-1');
      expect(josh.run).toHaveBeenLastCalledWith('products', 'update', { id: ID, fields: { selling_unit: 'kg' } }, expect.anything(), 'admin');
      josh.run.mockClear(); contents.edit.mockClear();
      await expect(ctl.updateProduct(ID, { fields: { product_name_en: '', selling_unit: 'kg' } }, req)).rejects.toThrow('product_name_en');
      expect(josh.run).not.toHaveBeenCalled();
      expect(contents.edit).not.toHaveBeenCalled();
      josh.run.mockResolvedValueOnce({ product_inventory_id: ID } as never);
      await ctl.createProduct({ product: { product_inventory_sku: 'SKU-2', product_name_th: 'ใหม่', selling_unit: 'kg' } }, req);
      expect(josh.run).toHaveBeenLastCalledWith('products', 'create', { product: { product_inventory_sku: 'SKU-2', product_name_th: 'ใหม่', selling_unit: 'kg' } }, expect.anything(), 'admin');
      expect(contents.edit).toHaveBeenCalledWith('SKU-2', { product_name_th: 'ใหม่' }, 'staff-1', 'create');
    } finally { delete process.env.COMMERCE_OWNS_PRODUCT_CONTENT; }
  });

  it('stage 4d: once commerce owns the product master, status / category / units go to commerce, the rest to josh', async () => {
    const masters = { edit: jest.fn(async () => ({})) };
    const db = { query: jest.fn(async () => [{ sku: 'SKU-1' }]) };
    const ctl = new JoshActionsController(josh as never, catalog as never, { get: (cls: { name: string }) => (cls.name === 'DataSource' ? db : masters) } as never);
    process.env.COMMERCE_OWNS_PRODUCT_MASTER = 'true';
    try {
      await ctl.updateProduct(ID, { fields: { product_status: 'inactive', category_id: 'cat-1', selling_unit: 'KG', low_stock_threshold: 5 } }, req);
      expect(masters.edit).toHaveBeenCalledWith('SKU-1', { product_status: 'inactive', selling_unit: 'KG', category_id: 'cat-1' }, 'staff-1');
      expect(josh.run).toHaveBeenLastCalledWith('products', 'update', { id: ID, fields: { low_stock_threshold: 5 } }, expect.anything(), 'admin');
      await expect(ctl.updateProduct(ID, { fields: { product_status: 'gone' } }, req)).rejects.toThrow('product_status');
    } finally { delete process.env.COMMERCE_OWNS_PRODUCT_MASTER; }
  });

  it('a product not in the catalog copy yet is pulled from josh once before its content / price is saved', async () => {
    const contents = { edit: jest.fn(async () => ({})) };
    const db = { query: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ sku: 'SKU-9' }]) };
    const ctl = new JoshActionsController(josh as never, catalog as never, { get: (cls: { name: string }) => (cls.name === 'DataSource' ? db : contents) } as never);
    process.env.COMMERCE_OWNS_PRODUCT_CONTENT = 'true';
    try {
      await ctl.updateProduct(ID, { fields: { allergens: 'นม' } }, req);
      expect(catalog.syncId).toHaveBeenCalledWith(ID);
      expect(contents.edit).toHaveBeenCalledWith('SKU-9', { allergens: 'นม' }, 'staff-1');
    } finally { delete process.env.COMMERCE_OWNS_PRODUCT_CONTENT; }
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
