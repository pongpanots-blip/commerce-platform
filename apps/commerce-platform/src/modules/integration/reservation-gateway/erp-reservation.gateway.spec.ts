import { ErpReservationGateway } from './erp-reservation.gateway';

function makeGateway(adapter: Partial<Record<string, jest.Mock>>, integration: unknown = { id: 'i1', type: 'erp-stub', config: {}, status: 'active' }) {
  const registry = { resolve: jest.fn().mockReturnValue(adapter), has: () => true };
  const repo = { findOne: jest.fn().mockResolvedValue(integration) };
  return new ErpReservationGateway(registry as never, repo as never);
}

describe('ErpReservationGateway', () => {
  it('passes lines through and returns adapter results', async () => {
    const gw = makeGateway({
      reserveStock: jest.fn().mockResolvedValue([{ ok: true, externalRef: 'x1' }]),
    });
    const res = await gw.reserve([{ sku: 'A', qty: 1, idempotencyKey: 'k' }]);
    expect(res).toEqual([{ ok: true, externalRef: 'x1' }]);
  });

  it('returns erp_unavailable per line when no active integration exists', async () => {
    const gw = makeGateway({}, null);
    const res = await gw.reserve([{ sku: 'A', qty: 1, idempotencyKey: 'k' }]);
    expect(res[0]).toMatchObject({ ok: false, code: 'erp_unavailable' });
  });

  it('times out slow adapters as erp_unavailable', async () => {
    process.env.RESERVATION_TIMEOUT_MS = '20';
    const gw = makeGateway({
      reserveStock: jest.fn(() => new Promise((r) => setTimeout(() => r([{ ok: true }]), 200))),
    });
    const res = await gw.reserve([{ sku: 'A', qty: 1, idempotencyKey: 'k' }]);
    expect(res[0]).toMatchObject({ ok: false, code: 'erp_unavailable' });
    delete process.env.RESERVATION_TIMEOUT_MS;
  });

  it('opens the breaker after threshold failures and short-circuits', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('boom'));
    const gw = makeGateway({ reserveStock: failing });
    for (let i = 0; i < 5; i++) {
      await gw.reserve([{ sku: 'A', qty: 1, idempotencyKey: `k${i}` }]);
    }
    failing.mockClear();
    const res = await gw.reserve([{ sku: 'A', qty: 1, idempotencyKey: 'k9' }]);
    expect(res[0]).toMatchObject({ ok: false, code: 'erp_unavailable' });
    expect(failing).not.toHaveBeenCalled(); // short-circuited
  });

  it('retries a failing reserve exactly twice per call', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('boom'));
    const gw = makeGateway({ reserveStock: failing });
    await gw.reserve([{ sku: 'A', qty: 1, idempotencyKey: 'k' }]);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('resets the failure counter on success so the breaker does not open early', async () => {
    let fail = true;
    const reserveStock = jest.fn(() =>
      fail
        ? Promise.reject(new Error('boom'))
        : Promise.resolve([{ ok: true, externalRef: 'x' }]),
    );
    const gw = makeGateway({ reserveStock });

    // threshold-1 failures...
    for (let i = 0; i < 4; i++) {
      await gw.reserve([{ sku: 'A', qty: 1, idempotencyKey: `k${i}` }]);
    }
    // ...then one success, which must reset the counter...
    fail = false;
    const ok = await gw.reserve([{ sku: 'A', qty: 1, idempotencyKey: 'k-ok' }]);
    expect(ok).toEqual([{ ok: true, externalRef: 'x' }]);
    // ...then threshold-1 more failures — the breaker must still be closed.
    fail = true;
    for (let i = 0; i < 4; i++) {
      await gw.reserve([{ sku: 'A', qty: 1, idempotencyKey: `k2${i}` }]);
    }
    reserveStock.mockClear();
    await gw.reserve([{ sku: 'A', qty: 1, idempotencyKey: 'probe' }]);
    expect(reserveStock).toHaveBeenCalled(); // not short-circuited
  });

  it('clears the timeout timer once the adapter settles (no timer leak)', async () => {
    jest.useFakeTimers();
    try {
      const gw = makeGateway({
        reserveStock: jest.fn().mockResolvedValue([{ ok: true, externalRef: 'x1' }]),
      });
      await gw.reserve([{ sku: 'A', qty: 1, idempotencyKey: 'k' }]);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('confirm / release', () => {
    it('maps adapter success through confirm', async () => {
      const confirmReservation = jest.fn().mockResolvedValue({ ok: true });
      const gw = makeGateway({ confirmReservation });
      expect(await gw.confirm(['r1'])).toEqual({ ok: true });
      expect(confirmReservation).toHaveBeenCalledWith(
        ['r1'],
        expect.objectContaining({ integrationId: 'i1' }),
      );
    });

    it('maps adapter failure through release', async () => {
      const releaseReservation = jest.fn().mockResolvedValue({ ok: false, error: 'nope' });
      const gw = makeGateway({ releaseReservation });
      expect(await gw.release(['r1'])).toEqual({ ok: false, error: 'nope' });
    });

    it('fails when no active integration exists', async () => {
      const gw = makeGateway({}, null);
      expect(await gw.confirm(['r1'])).toMatchObject({
        ok: false,
        error: expect.stringContaining('no active'),
      });
      expect(await gw.release(['r1'])).toMatchObject({
        ok: false,
        error: expect.stringContaining('no active'),
      });
    });

    it('maps a thrown adapter error to { ok: false, error }', async () => {
      const gw = makeGateway({
        confirmReservation: jest.fn().mockRejectedValue(new Error('boom')),
      });
      expect(await gw.confirm(['r1'])).toEqual({ ok: false, error: 'boom' });
    });

    it('times out slow adapters', async () => {
      process.env.RESERVATION_TIMEOUT_MS = '20';
      try {
        const gw = makeGateway({
          confirmReservation: jest.fn(
            () => new Promise((r) => setTimeout(() => r({ ok: true }), 200)),
          ),
        });
        expect(await gw.confirm(['r1'])).toEqual({
          ok: false,
          error: 'reservation call timed out',
        });
      } finally {
        delete process.env.RESERVATION_TIMEOUT_MS;
      }
    });

    it('records failures toward the shared breaker (reserve short-circuits after)', async () => {
      const reserveStock = jest.fn().mockResolvedValue([{ ok: true }]);
      const gw = makeGateway({
        confirmReservation: jest.fn().mockRejectedValue(new Error('boom')),
        reserveStock,
      });
      for (let i = 0; i < 5; i++) {
        await gw.confirm(['r']);
      }
      const res = await gw.reserve([{ sku: 'A', qty: 1, idempotencyKey: 'k' }]);
      expect(res[0]).toMatchObject({
        ok: false,
        code: 'erp_unavailable',
        error: 'circuit breaker open',
      });
      expect(reserveStock).not.toHaveBeenCalled();
    });
  });
});
