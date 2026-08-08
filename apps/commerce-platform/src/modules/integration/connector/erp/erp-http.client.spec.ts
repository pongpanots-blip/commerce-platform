import { ErpHttpClient } from './erp-http.client';

describe('ErpHttpClient (mock mode)', () => {
  const client = new ErpHttpClient();
  const cfg = { baseUrl: 'https://erp.example.com', apiKey: 'k' }; // no liveMode

  let fetchSpy: jest.SpyInstance;
  beforeEach(() => { fetchSpy = jest.spyOn(global, 'fetch' as never); });
  afterEach(() => fetchSpy.mockRestore());

  it('reserve returns one ok result per line and never fetches', async () => {
    const res = await client.reserve(
      [{ sku: 'A', qty: 1, idempotencyKey: 'k1' }, { sku: 'B', qty: 2, idempotencyKey: 'k2' }], cfg);
    expect(res).toHaveLength(2);
    expect(res.every((r) => r.ok && r.reservationRef?.startsWith('MOCK-RSV-'))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('upsertCustomer returns a deterministic mock customer code, no fetch', async () => {
    const res = await client.upsertCustomer(
      { platformCustomerId: 'c-1', name: 'N', email: 'a@b.co', phone: null }, cfg);
    expect(res).toEqual({ ok: true, customerCode: 'MOCK-CUST-c-1' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('createOrder / confirm / release / cancel / fetchProducts / fetchStock all mock ok, no fetch', async () => {
    expect((await client.createOrder({ platformOrderId: 'o1', customerCode: null, lines: [], total: '0.00', currency: 'THB' }, cfg)).ok).toBe(true);
    expect((await client.confirmReservations(['r1'], cfg)).ok).toBe(true);
    expect((await client.releaseReservations(['r1'], cfg)).ok).toBe(true);
    expect((await client.cancelOrder('ERP-1', cfg)).ok).toBe(true);
    expect(await client.fetchProducts(null, cfg)).toEqual([]);
    expect(await client.fetchStock(['A'], cfg)).toEqual([{ sku: 'A', qty: 0 }]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('liveMode=true attempts a real fetch (we assert the request shape, mocking fetch)', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ results: [{ ok: true, reservationRef: 'R1' }] }) } as never);
    await client.reserve([{ sku: 'A', qty: 1, idempotencyKey: 'k1' }], { ...cfg, liveMode: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://erp.example.com/api/v1/reservations',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-Api-Key': 'k' }) }),
    );
  });
});
