import { ErpStubConnector } from './erp-stub.connector';

/** Fake EntityManager: scripted responses for the raw UPDATE + repos. */
function makeManager(decrementRowsAffected: number, existing: unknown = null) {
  const stubResRepo = {
    findOne: jest.fn().mockResolvedValue(existing),
    save: jest.fn().mockImplementation(async (r) => ({ id: 'ext-1', ...r })),
    create: (r: unknown) => r,
    update: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
  };
  const manager = {
    query: jest.fn().mockResolvedValue([[], decrementRowsAffected]),
    getRepository: jest.fn().mockReturnValue(stubResRepo),
  };
  const dataSource = { transaction: (fn: (m: unknown) => unknown) => fn(manager) };
  return { dataSource, manager, stubResRepo };
}

describe('ErpStubConnector.reserveStock', () => {
  const ctx = { integrationId: 'i1', config: {} };

  it('holds when stock decrements', async () => {
    const { dataSource } = makeManager(1);
    const c = new ErpStubConnector(dataSource as never);
    const [r] = await c.reserveStock([{ sku: 'A', qty: 1, idempotencyKey: 'k1' }], ctx);
    expect(r.ok).toBe(true);
    expect(r.externalRef).toBeDefined();
  });

  it('fails with insufficient_stock when decrement misses', async () => {
    const { dataSource } = makeManager(0);
    const c = new ErpStubConnector(dataSource as never);
    const [r] = await c.reserveStock([{ sku: 'A', qty: 5, idempotencyKey: 'k2' }], ctx);
    expect(r).toMatchObject({ ok: false, code: 'insufficient_stock' });
  });

  it('is idempotent: replays an existing held row without decrementing again', async () => {
    const { dataSource, manager } = makeManager(1, { id: 'ext-9', status: 'held' });
    const c = new ErpStubConnector(dataSource as never);
    const [r] = await c.reserveStock([{ sku: 'A', qty: 1, idempotencyKey: 'k3' }], ctx);
    expect(r).toMatchObject({ ok: true, externalRef: 'ext-9' });
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('returns erp_unavailable for configured failSkus', async () => {
    const { dataSource } = makeManager(1);
    const c = new ErpStubConnector(dataSource as never);
    const [r] = await c.reserveStock(
      [{ sku: 'BAD', qty: 1, idempotencyKey: 'k4' }],
      { integrationId: 'i1', config: { failSkus: ['BAD'] } });
    expect(r).toMatchObject({ ok: false, code: 'erp_unavailable' });
  });

  it('converges on the winner row when a concurrent duplicate key makes save throw', async () => {
    // Both callers passed the findOne check; the loser's save hits the unique
    // constraint. The loser must re-read and return the winner's externalRef,
    // and the batch's remaining lines must still be processed.
    const { dataSource, stubResRepo } = makeManager(1);
    stubResRepo.save
      .mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'))
      .mockImplementation(async (r: unknown) => ({ id: 'ext-1', ...(r as object) }));
    const reRead = { findOne: jest.fn().mockResolvedValue({ id: 'ext-win', status: 'held' }) };
    (dataSource as { getRepository?: unknown }).getRepository = jest.fn().mockReturnValue(reRead);

    const c = new ErpStubConnector(dataSource as never);
    const [r1, r2] = await c.reserveStock(
      [
        { sku: 'A', qty: 1, idempotencyKey: 'dup' },
        { sku: 'B', qty: 2, idempotencyKey: 'k6' },
      ],
      ctx,
    );
    expect(r1).toMatchObject({ ok: true, externalRef: 'ext-win' });
    expect(r2).toMatchObject({ ok: true, externalRef: 'ext-1' });
  });

  it('maps an unexpected per-line failure to a per-line error without aborting the batch', async () => {
    const { dataSource, stubResRepo } = makeManager(1);
    stubResRepo.save
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockImplementation(async (r: unknown) => ({ id: 'ext-1', ...(r as object) }));
    const reRead = { findOne: jest.fn().mockResolvedValue(null) };
    (dataSource as { getRepository?: unknown }).getRepository = jest.fn().mockReturnValue(reRead);

    const c = new ErpStubConnector(dataSource as never);
    const [r1, r2] = await c.reserveStock(
      [
        { sku: 'A', qty: 1, idempotencyKey: 'k7' },
        { sku: 'B', qty: 1, idempotencyKey: 'k8' },
      ],
      ctx,
    );
    expect(r1).toMatchObject({ ok: false, code: 'error' });
    expect(r2).toMatchObject({ ok: true, externalRef: 'ext-1' });
  });
});
