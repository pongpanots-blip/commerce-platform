import { In } from 'typeorm';
import { ReservationFacade } from './reservation.facade';

function makeFacade(gatewayOverrides: Partial<Record<string, jest.Mock>> = {}) {
  const rows: Record<string, unknown>[] = [];
  const repo = {
    save: jest.fn().mockImplementation(async (r) => {
      const saved = { id: `res-${rows.length + 1}`, ...r };
      rows.push(saved);
      return saved;
    }),
    find: jest.fn().mockImplementation(async () => rows),
    update: jest.fn(),
    findOne: jest.fn(),
  };
  const gateway = {
    reserve: jest.fn().mockResolvedValue([{ ok: true, externalRef: 'x1' }]),
    confirm: jest.fn().mockResolvedValue({ ok: true }),
    release: jest.fn().mockResolvedValue({ ok: true }),
    integrationId: jest.fn().mockResolvedValue('i1'),
    ...gatewayOverrides,
  };
  return { facade: new ReservationFacade(repo as never, gateway as never), repo, gateway, rows };
}

const onHand = {
  orderId: 'o1', orderLineId: 'l1', productId: 'p1',
  sku: 'A', qty: 2, mode: 'on_hand' as const, promisedDate: null,
};
const toOrder = {
  orderId: 'o1', orderLineId: 'l2', productId: 'p2',
  sku: 'B', qty: 1, mode: 'to_order' as const, promisedDate: '2026-07-24',
};

describe('ReservationFacade.reserve', () => {
  it('holds on_hand lines through the gateway with deterministic idempotency keys', async () => {
    const { facade, gateway } = makeFacade();
    const [r] = await facade.reserve([onHand]);
    expect(gateway.reserve).toHaveBeenCalledWith([
      { sku: 'A', qty: 2, idempotencyKey: 'o1:l1' },
    ]);
    expect(r).toMatchObject({ status: 'held', externalRef: 'x1', integrationId: 'i1' });
  });

  it('records to_order demand WITHOUT calling the gateway', async () => {
    const { facade, gateway } = makeFacade();
    const [r] = await facade.reserve([toOrder]);
    expect(gateway.reserve).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: 'held', mode: 'to_order', promisedDate: '2026-07-24', externalRef: null });
  });

  it('persists a failed row with the gateway fail reason', async () => {
    const { facade } = makeFacade({
      reserve: jest.fn().mockResolvedValue([
        { ok: false, code: 'insufficient_stock', error: 'no stock for A' },
      ]),
    });
    const [r] = await facade.reserve([onHand]);
    expect(r).toMatchObject({ status: 'failed', failReason: 'insufficient_stock: no stock for A' });
  });

  it('stamps a provisional expiresAt on held rows (on_hand) so a crash before the saga setExpiry is still reclaimable', async () => {
    const { facade } = makeFacade();
    const [r] = await facade.reserve([onHand]);
    expect(r.status).toBe('held');
    expect(r.expiresAt).toBeInstanceOf(Date);
    expect((r.expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('stamps a provisional expiresAt on held rows (to_order) too', async () => {
    const { facade } = makeFacade();
    const [r] = await facade.reserve([toOrder]);
    expect(r.status).toBe('held');
    expect(r.expiresAt).toBeInstanceOf(Date);
  });

  it('does NOT stamp expiresAt on failed rows', async () => {
    const { facade } = makeFacade({
      reserve: jest.fn().mockResolvedValue([
        { ok: false, code: 'insufficient_stock', error: 'no stock for A' },
      ]),
    });
    const [r] = await facade.reserve([onHand]);
    expect(r.status).toBe('failed');
    expect(r.expiresAt).toBeNull();
  });

  it('respects RESERVATION_TTL_MINUTES for the provisional stamp', async () => {
    const original = process.env.RESERVATION_TTL_MINUTES;
    process.env.RESERVATION_TTL_MINUTES = '5';
    try {
      const { facade } = makeFacade();
      const before = Date.now();
      const [r] = await facade.reserve([onHand]);
      const expiresAt = r.expiresAt as Date;
      const deltaMs = expiresAt.getTime() - before;
      expect(deltaMs).toBeGreaterThan(4 * 60_000);
      expect(deltaMs).toBeLessThanOrEqual(5 * 60_000 + 1000);
    } finally {
      if (original === undefined) delete process.env.RESERVATION_TTL_MINUTES;
      else process.env.RESERVATION_TTL_MINUTES = original;
    }
  });
});

describe('ReservationFacade.setExpiry', () => {
  it('re-stamps expiresAt on held rows for the order via the repo', async () => {
    const { facade, repo } = makeFacade();
    const expiresAt = new Date('2026-08-01T00:00:00.000Z');
    await facade.setExpiry('o1', expiresAt);
    expect(repo.update).toHaveBeenCalledWith({ orderId: 'o1', status: 'held' }, { expiresAt });
  });
});

describe('confirm / release', () => {
  it('confirmOrder confirms held rows and passes ERP refs to the gateway', async () => {
    const { facade, gateway, repo } = makeFacade();
    repo.find.mockResolvedValue([
      { id: 'r1', status: 'held', mode: 'on_hand', externalRef: 'x1' },
      { id: 'r2', status: 'held', mode: 'to_order', externalRef: null },
    ]);
    await facade.confirmOrder('o1');
    expect(gateway.confirm).toHaveBeenCalledWith(['x1']);
    expect(repo.save).toHaveBeenCalledTimes(2); // both rows → confirmed
  });

  it('releaseOrder marks rows reconcile when the gateway release fails', async () => {
    const { facade, repo } = makeFacade({
      release: jest.fn().mockResolvedValue({ ok: false, error: 'down' }),
    });
    repo.find.mockResolvedValue([
      { id: 'r1', status: 'held', mode: 'on_hand', externalRef: 'x1' },
    ]);
    await facade.releaseOrder('o1', 'released');
    const saved = repo.save.mock.calls.map((c) => c[0]);
    expect(saved[0]).toMatchObject({ id: 'r1', status: 'reconcile' });
  });

  it('releaseOrder retries rows stuck in reconcile from a prior failed gateway call, so they are never silently stuck', async () => {
    const { facade, repo, gateway } = makeFacade();
    repo.find.mockResolvedValue([
      { id: 'r1', status: 'reconcile', mode: 'on_hand', externalRef: 'x1' },
    ]);
    await facade.releaseOrder('o1', 'released');
    expect(repo.find).toHaveBeenCalledWith({ orderId: 'o1', status: In(['held', 'reconcile']) });
    expect(gateway.release).toHaveBeenCalledWith(['x1']);
    const saved = repo.save.mock.calls.map((c) => c[0]);
    expect(saved[0]).toMatchObject({ id: 'r1', status: 'released' });
  });

  it('confirmOrder stays held-only and does NOT retry reconcile rows', async () => {
    const { facade, repo } = makeFacade();
    await facade.confirmOrder('o1');
    expect(repo.find).toHaveBeenCalledWith({ orderId: 'o1', status: 'held' });
  });
});
