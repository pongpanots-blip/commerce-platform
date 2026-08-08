import { StorefrontCustomersService } from './storefront-customers.service';

function makeService(existing: unknown = null, erpIntegration: unknown = { id: 'i-erp', type: 'erp', status: 'active', config: {} }) {
  const customerRepo = { findOne: jest.fn().mockResolvedValue(existing) };
  const customers = {
    create: jest.fn().mockImplementation(async (d) => ({ id: 'c-new', ...d })),
    // Merges onto `existing` (when the id matches) rather than replacing it
    // outright — a real partial UPDATE preserves fields not in the patch
    // (e.g. `code`), and callers like syncToErp() rely on that.
    update: jest.fn().mockImplementation(async (id, d) => {
      const base = (existing as { id?: string } | null)?.id === id ? (existing as Record<string, unknown>) : {};
      return { ...base, id, ...d };
    }),
  };
  const integrations = { findOne: jest.fn().mockResolvedValue(erpIntegration) };
  const erpClient = { upsertCustomer: jest.fn().mockResolvedValue({ ok: true, customerCode: 'JGT-001' }) };
  const mapping = { link: jest.fn().mockResolvedValue(undefined) };
  const service = new StorefrontCustomersService(
    customers as never, customerRepo as never, integrations as never, erpClient as never, mapping as never);
  return { service, customers, customerRepo, erpClient, mapping };
}

describe('StorefrontCustomersService.upsert', () => {
  it('creates a new customer, gets ERP code (mock), stores code + mapping', async () => {
    const { service, customers, erpClient, mapping } = makeService();
    const res = await service.upsert({ name: 'K. Somchai', email: ' A@B.co ', phone: '081-234-5678' });
    expect(customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'K. Somchai', email: 'a@b.co', phone: '0812345678' }));
    expect(erpClient.upsertCustomer).toHaveBeenCalled();
    expect(customers.update).toHaveBeenCalledWith('c-new', { code: 'JGT-001' });
    // MappingService.link signature confirmed against
    // modules/integration/mapping/application/mapping.service.ts:
    // link(integrationId, entityType, platformId, externalId, externalRef?)
    expect(mapping.link).toHaveBeenCalledWith('i-erp', 'customer', 'c-new', 'JGT-001');
    expect(res).toEqual({ customerId: 'c-new', customerCode: 'JGT-001' });
  });

  it('matches an existing customer by normalized email and updates the name', async () => {
    const { service, customers } = makeService({ id: 'c-old', name: 'Old', email: 'a@b.co', phone: null, code: 'JGT-9' });
    const res = await service.upsert({ name: 'New Name', email: 'A@B.CO ' });
    expect(customers.update).toHaveBeenCalledWith('c-old', expect.objectContaining({ name: 'New Name' }));
    expect(res.customerId).toBe('c-old');
  });

  it('an already-ERP-coded customer (e.g. from inbound ingest) keeps that code — the mock round trip must not clobber it', async () => {
    const { service, erpClient, customers, mapping } = makeService({
      id: 'c-old', name: 'Somchai Restaurant Co., Ltd.', email: 'ap@somchai.co.th', phone: null, code: 'JGT-00871',
    });
    const res = await service.upsert({ name: 'Somchai Restaurant', email: 'ap@somchai.co.th' });
    expect(erpClient.upsertCustomer).not.toHaveBeenCalled();
    expect(mapping.link).not.toHaveBeenCalled();
    expect(customers.update).toHaveBeenCalledTimes(1); // only the name/email/phone update, never a code overwrite
    expect(res).toEqual({ customerId: 'c-old', customerCode: 'JGT-00871' });
  });

  it('no erp integration → still upserts locally, customerCode null', async () => {
    const { service, erpClient } = makeService(null, null);
    const res = await service.upsert({ name: 'X', phone: '02 111 2222' });
    expect(erpClient.upsertCustomer).not.toHaveBeenCalled();
    expect(res).toEqual({ customerId: 'c-new', customerCode: null });
  });

  it('erp client throws (liveMode network/HTTP failure) → local upsert survives, customerCode null', async () => {
    const { service, erpClient, customers, mapping } = makeService();
    erpClient.upsertCustomer.mockRejectedValue(new Error('ERP down'));
    const res = await service.upsert({ name: 'K. Somchai', email: 'a@b.co' });
    expect(res).toEqual({ customerId: 'c-new', customerCode: null });
    expect(customers.update).not.toHaveBeenCalled();
    expect(mapping.link).not.toHaveBeenCalled();
  });

  it('rejects when neither email nor phone provided', async () => {
    const { service } = makeService();
    await expect(service.upsert({ name: 'X' })).rejects.toThrow('email or phone');
  });
});
