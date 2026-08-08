import { ErpConnector } from './erp.connector';
import { ErpHttpClient } from './erp-http.client';

describe('ErpConnector', () => {
  const ctx = { integrationId: 'i1', config: { baseUrl: 'x' } };

  function makeConnector(clientOverrides: Partial<Record<string, jest.Mock>> = {}) {
    const client = Object.assign(new ErpHttpClient(), clientOverrides) as ErpHttpClient;
    return { connector: new ErpConnector(client), client };
  }

  it('reserveStock maps port lines → client lines and results back (order preserved)', async () => {
    const reserve = jest.fn().mockResolvedValue([
      { ok: true, reservationRef: 'R1' },
      { ok: false, reason: 'no stock' },
    ]);
    const { connector } = makeConnector({ reserve });
    const res = await connector.reserveStock(
      [{ sku: 'A', qty: 1, idempotencyKey: 'k1' }, { sku: 'B', qty: 2, idempotencyKey: 'k2' }], ctx);
    expect(reserve).toHaveBeenCalledWith(
      [{ sku: 'A', qty: 1, idempotencyKey: 'k1' }, { sku: 'B', qty: 2, idempotencyKey: 'k2' }],
      ctx.config,
    );
    expect(res).toEqual([
      { ok: true, externalRef: 'R1' },
      { ok: false, code: 'insufficient_stock', error: 'no stock' },
    ]);
  });

  it('confirm/release map refs through and surface errors', async () => {
    const confirmReservations = jest.fn().mockResolvedValue({ ok: true });
    const releaseReservations = jest.fn().mockResolvedValue({ ok: false, error: 'down' });
    const { connector } = makeConnector({ confirmReservations, releaseReservations });
    expect(await connector.confirmReservation(['R1'], ctx)).toEqual({ ok: true });
    expect(await connector.releaseReservation(['R1'], ctx)).toEqual({ ok: false, error: 'down' });
  });

  it('sync methods run in mock mode without throwing and report zero processed', async () => {
    const { connector } = makeConnector();
    expect(await connector.syncProducts(ctx)).toEqual({ processed: 0, failed: 0 });
    expect(await connector.syncInventory(ctx)).toEqual({ processed: 0, failed: 0 });
  });

  it('createOrder/cancelOrder/updateOrder are honest stubs — not wired to the ERP yet', async () => {
    const { connector } = makeConnector();
    const expected = { ok: false, error: 'erp order push not wired (OMS dispatch cycle)' };
    expect(await connector.createOrder({})).toEqual(expected);
    expect(await connector.cancelOrder('ERP-1')).toEqual(expected);
    expect(await connector.updateOrder({})).toEqual(expected);
  });
});
