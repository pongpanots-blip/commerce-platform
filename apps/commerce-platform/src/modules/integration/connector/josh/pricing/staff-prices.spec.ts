import { BadRequestException } from '@nestjs/common';
import { JoshPriceRow, planImport, StaffPrices } from './staff-prices';
import { StaffPrice } from './staff-price.entity';

const CO = '11111111-1111-4111-8111-111111111111';
const BR = '22222222-2222-4222-8222-222222222222';
const INV = '33333333-3333-4333-8333-333333333333';
const josh = (over: Partial<JoshPriceRow> = {}): JoshPriceRow => ({ josh_id: 'j-1', kind: 'customer', company_id: CO, branch_id: null, product_inventory_id: INV, sku: '1007310',
  price: 450, contract_ref: null, start_date: '2026-10-01', end_date: null, ...over });
const row = (over: Partial<StaffPrice> = {}) => ({ id: '44444444-4444-4444-8444-444444444444', kind: 'customer', companyId: CO, branchId: null, productInventoryId: INV, sku: '1007310', price: '450',
  contractRef: null, startDate: '2026-10-01', endDate: null, joshId: 'j-1', status: 'synced', syncError: null, updatedBy: 'x', deletedAt: null, ...over }) as StaffPrice;

describe('planImport (josh → commerce)', () => {
  it('adds rows commerce has never seen', () => {
    expect(planImport([josh()], []).add).toHaveLength(1);
  });

  it('a synced row follows josh (ERP quotation / CS request changed it); an identical one is left alone', () => {
    expect(planImport([josh({ price: 430 })], [row()]).follow).toHaveLength(1);
    expect(planImport([josh()], [row()])).toEqual({ add: [], follow: [], gone: [] });
  });

  it('never overwrites a commerce edit that is pending or failed — commerce will send it', () => {
    expect(planImport([josh({ price: 430 })], [row({ status: 'pending', price: '470' })]).follow).toHaveLength(0);
    expect(planImport([josh({ price: 430 })], [row({ status: 'failed', price: '470' })]).follow).toHaveLength(0);
  });

  it('marks a synced row josh no longer has as gone, but not one commerce has not sent yet', () => {
    expect(planImport([], [row()]).gone).toHaveLength(1);
    expect(planImport([], [row({ status: 'pending', joshId: null })]).gone).toHaveLength(0);
  });
});

describe('StaffPrices writes', () => {
  const actor = { userId: 'staff-1', email: 'ba@jagota.co.th' };
  let repo: { findOneBy: jest.Mock; save: jest.Mock; create: jest.Mock; update: jest.Mock };
  let joshActions: { run: jest.Mock };
  let svc: StaffPrices;
  beforeEach(() => {
    repo = { findOneBy: jest.fn(async () => null), save: jest.fn(async (r) => ({ id: 'c-new', ...r })), create: jest.fn((r) => r), update: jest.fn() };
    joshActions = { run: jest.fn(async () => ({ data: { id: 'j-new' } })) };
    svc = new StaffPrices(repo as never, { query: jest.fn(async () => [{ sku: '1007310' }]) } as never, joshActions as never);
  });

  it('a new customer price is stored, sent to josh through PrivatePriceService (upsert) and remembers josh\'s id', async () => {
    const r = await svc.create('customer', { companyId: CO, productInventoryId: INV, price: 450, startDate: '2026-10-01' }, actor);
    expect(joshActions.run).toHaveBeenCalledWith('customer-prices', 'upsert', { companyId: CO, productInventoryId: INV, price: 450, startDate: '2026-10-01', endDate: undefined }, actor, 'admin');
    expect(repo.update).toHaveBeenCalledWith({ id: 'c-new' }, expect.objectContaining({ joshId: 'j-new', status: 'synced' }));
    expect(r.status).toBe('synced');
  });

  it('a contract price goes to BranchPricingService (create)', async () => {
    await svc.create('contract', { branchId: BR, productInventoryId: INV, price: 470, contractRef: 'C-1' }, actor);
    expect(joshActions.run).toHaveBeenCalledWith('contract-prices', 'create', expect.objectContaining({ branchId: BR, price: 470, contractRef: 'C-1' }), actor, 'admin');
  });

  it('josh refusing keeps the row failed with josh\'s message (retry later)', async () => {
    joshActions.run.mockRejectedValue(new Error('josh: ราคาลูกค้าแก้ได้เฉพาะ admin, platform_admin, dev'));
    const r = await svc.create('customer', { companyId: CO, productInventoryId: INV, price: 450 }, actor);
    expect(r.status).toBe('failed');
    expect(r.syncError).toContain('เฉพาะ admin');
  });

  it('a second customer price for the same company + product updates the existing one, like josh', async () => {
    repo.findOneBy.mockResolvedValueOnce(row({ status: 'synced' })).mockResolvedValueOnce(row({ status: 'synced' }));
    await svc.create('customer', { companyId: CO, productInventoryId: INV, price: 430 }, actor);
    expect(joshActions.run).toHaveBeenCalledWith('customer-prices', 'update', expect.objectContaining({ id: 'j-1', price: 430 }), actor, 'admin');
  });

  it('validates before anything is stored', async () => {
    await expect(svc.create('customer', { companyId: 'x', productInventoryId: INV, price: 1 }, actor)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create('contract', { branchId: BR, productInventoryId: INV, price: -1 }, actor)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create('customer', { companyId: CO, productInventoryId: INV, price: 1, startDate: '2026-10-10', endDate: '2026-10-01' }, actor)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create('banana' as never, { companyId: CO, productInventoryId: INV, price: 1 }, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('delete: josh first; a row josh already lost counts as deleted, any other error keeps it', async () => {
    repo.findOneBy.mockResolvedValue(row());
    joshActions.run.mockRejectedValueOnce(new Error('josh: ไม่พบราคาพิเศษ'));
    await expect(svc.remove('11111111-1111-4111-8111-aaaaaaaaaaaa', actor)).resolves.toEqual({ deleted: true });
    joshActions.run.mockRejectedValueOnce(new Error('josh is not connected'));
    await expect(svc.remove('11111111-1111-4111-8111-aaaaaaaaaaaa', actor)).rejects.toThrow('not connected');
  });
});
