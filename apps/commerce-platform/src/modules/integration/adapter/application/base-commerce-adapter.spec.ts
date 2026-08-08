import { BaseCommerceAdapter } from './base-commerce-adapter';
import { AdapterContext, AdapterResult, SyncResult } from '../domain/commerce-adapter.interface';

class NoopAdapter extends BaseCommerceAdapter {
  readonly type = 'noop';
  async syncCustomers(): Promise<SyncResult> { return { processed: 0, failed: 0 }; }
  async syncProducts(): Promise<SyncResult> { return { processed: 0, failed: 0 }; }
  async syncInventory(): Promise<SyncResult> { return { processed: 0, failed: 0 }; }
  async syncPrices(): Promise<SyncResult> { return { processed: 0, failed: 0 }; }
  async createOrder(): Promise<AdapterResult> { return { ok: true }; }
  async cancelOrder(): Promise<AdapterResult> { return { ok: true }; }
  async updateOrder(): Promise<AdapterResult> { return { ok: true }; }
}

describe('BaseCommerceAdapter reservation defaults', () => {
  const ctx: AdapterContext = { integrationId: 'i1' };
  const adapter = new NoopAdapter();

  it('reserveStock defaults to unsupported per line', async () => {
    const res = await adapter.reserveStock(
      [{ sku: 'A', qty: 1, idempotencyKey: 'k1' }], ctx);
    expect(res).toEqual([{ ok: false, code: 'unsupported', error: 'noop does not support reservations' }]);
  });

  it('confirm/release default to unsupported', async () => {
    expect((await adapter.confirmReservation(['r1'], ctx)).ok).toBe(false);
    expect((await adapter.releaseReservation(['r1'], ctx)).ok).toBe(false);
  });
});
