import { JoshActionsController } from './josh-actions.controller';

describe('JoshActionsController — back-office actions', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const req = { staff: { userId: 'staff-1', email: 'ba@jagota.co.th' } } as never;
  const josh = { run: jest.fn(async () => ({ ok: true })) };
  const catalog = { syncId: jest.fn(async () => undefined) };
  const c = new JoshActionsController(josh as never, catalog as never);
  beforeEach(() => { josh.run.mockClear(); catalog.syncId.mockClear(); });

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
});
