import { OrderCheckoutSaga } from './order-checkout.saga';

function makeSaga(reserveResult: { status: string; orderLineId?: string; failReason?: string | null }[]) {
  const order = { id: 'o1', status: 'draft', idempotencyKey: null, total: '100.00', currency: 'THB' };
  const repos: Record<string, ReturnType<typeof repoStub>> = {};
  function repoStub(name: string) {
    return {
      findOne: jest.fn().mockResolvedValue(name === 'Order' ? order : null),
      find: jest.fn().mockResolvedValue(
        name === 'OrderLine' ? [{ id: 'l1', orderId: 'o1', productId: 'p1', qty: '1' }]
        : name === 'Product' ? [{ id: 'p1', sku: 'A', fulfillmentMode: 'on_hand', leadTimeDays: null }]
        : []),
      save: jest.fn().mockImplementation(async (r) => r),
      create: (r: unknown) => r,
      update: jest.fn(),
    };
  }
  const manager = {
    getRepository: jest.fn().mockImplementation((e: { name: string }) =>
      (repos[e.name] ??= repoStub(e.name))),
  };
  const dataSource = {
    transaction: (fn: (m: unknown) => unknown) => fn(manager),
    getRepository: (e: { name: string }) => manager.getRepository(e),
  };
  const facade = {
    reserve: jest.fn().mockResolvedValue(reserveResult),
    confirmOrder: jest.fn().mockResolvedValue(undefined),
    releaseOrder: jest.fn().mockResolvedValue(undefined),
    setExpiry: jest.fn().mockResolvedValue(undefined),
  };
  const settings = { get: jest.fn().mockResolvedValue(null) };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const saga = new OrderCheckoutSaga(dataSource as never, facade as never, settings as never, eventBus as never);
  return { saga, facade, order, repos, eventBus };
}

describe('OrderCheckoutSaga.checkout', () => {
  it('all lines held → pending_payment, payment created, TTL stamped', async () => {
    const { saga, facade, order } = makeSaga([
      { status: 'held', orderLineId: 'l1', failReason: null },
    ]);
    const result = await saga.checkout('o1', 'key-1');
    expect(order.status).toBe('pending_payment');
    expect(facade.setExpiry).toHaveBeenCalled();
    expect(result.lines[0]).toMatchObject({ orderLineId: 'l1', status: 'held' });
  });

  it('a failed line → releaseOrder compensation and order failed', async () => {
    const { saga, facade, order } = makeSaga([
      { status: 'failed', orderLineId: 'l1', failReason: 'insufficient_stock: no stock' },
    ]);
    const result = await saga.checkout('o1', 'key-2');
    expect(order.status).toBe('failed');
    expect(facade.releaseOrder).toHaveBeenCalledWith('o1', 'released');
    expect(result.lines[0].failReason).toContain('insufficient_stock');
  });

  it('replays idempotently: same key on a non-draft order returns state without re-reserving', async () => {
    const { saga, facade, order } = makeSaga([{ status: 'held', orderLineId: 'l1' }]);
    await saga.checkout('o1', 'key-3');
    facade.reserve.mockClear();
    order.status = 'pending_payment';
    await saga.checkout('o1', 'key-3');
    expect(facade.reserve).not.toHaveBeenCalled();
  });

  it('rejects a different key on an already-checked-out order', async () => {
    const { saga, order } = makeSaga([{ status: 'held', orderLineId: 'l1' }]);
    await saga.checkout('o1', 'key-4');
    order.status = 'pending_payment';
    (order as { idempotencyKey: string | null }).idempotencyKey = 'key-4';
    await expect(saga.checkout('o1', 'other-key')).rejects.toThrow('already');
  });
});

describe('OrderCheckoutSaga.checkout wedge guard', () => {
  it('an unexpected throw while routing/reserving (unknown product) marks the order failed, best-effort releases, and rethrows', async () => {
    const order = { id: 'o1', status: 'draft', idempotencyKey: null, total: '100.00', currency: 'THB' };
    const orderRepo = {
      findOne: jest.fn().mockResolvedValue(order),
      save: jest.fn().mockImplementation(async (r) => { Object.assign(order, r); return r; }),
      update: jest.fn().mockImplementation(async (_where: unknown, partial: Record<string, unknown>) => {
        Object.assign(order, partial);
        return { affected: 1 };
      }),
    };
    const orderLineRepo = {
      find: jest.fn().mockResolvedValue([{ id: 'l1', orderId: 'o1', productId: 'p1', qty: '1' }]),
    };
    const productRepo = { find: jest.fn().mockResolvedValue([]) }; // unknown product → routeLines throws
    const fulfillRepo = { save: jest.fn(), create: (r: unknown) => r };
    const getRepository = jest.fn().mockImplementation((e: { name: string }) => {
      if (e.name === 'Order') return orderRepo;
      if (e.name === 'OrderLine') return orderLineRepo;
      if (e.name === 'Product') return productRepo;
      return fulfillRepo;
    });
    const dataSource = { getRepository, transaction: (fn: (m: unknown) => unknown) => fn({ getRepository }) };
    const facade = {
      reserve: jest.fn(),
      confirmOrder: jest.fn(),
      releaseOrder: jest.fn().mockResolvedValue(undefined),
      setExpiry: jest.fn(),
    };
    const settings = { get: jest.fn().mockResolvedValue(null) };
    const eventBus = { publish: jest.fn() };
    const saga = new OrderCheckoutSaga(dataSource as never, facade as never, settings as never, eventBus as never);

    await expect(saga.checkout('o1', 'key-wedge')).rejects.toThrow('product p1 not found');
    expect(order.status).toBe('failed');
    expect(facade.releaseOrder).toHaveBeenCalledWith('o1', 'released');
    expect(facade.reserve).not.toHaveBeenCalled();
  });

  it('best-effort release swallows its own failure and still rethrows the original error', async () => {
    const order = { id: 'o1', status: 'draft', idempotencyKey: null, total: '100.00', currency: 'THB' };
    const orderRepo = {
      findOne: jest.fn().mockResolvedValue(order),
      save: jest.fn().mockImplementation(async (r) => { Object.assign(order, r); return r; }),
      update: jest.fn().mockImplementation(async (_where: unknown, partial: Record<string, unknown>) => {
        Object.assign(order, partial);
        return { affected: 1 };
      }),
    };
    const orderLineRepo = { find: jest.fn().mockResolvedValue([{ id: 'l1', orderId: 'o1', productId: 'p1', qty: '1' }]) };
    const productRepo = { find: jest.fn().mockResolvedValue([]) };
    const fulfillRepo = { save: jest.fn(), create: (r: unknown) => r };
    const getRepository = jest.fn().mockImplementation((e: { name: string }) => {
      if (e.name === 'Order') return orderRepo;
      if (e.name === 'OrderLine') return orderLineRepo;
      if (e.name === 'Product') return productRepo;
      return fulfillRepo;
    });
    const dataSource = { getRepository, transaction: (fn: (m: unknown) => unknown) => fn({ getRepository }) };
    const facade = {
      reserve: jest.fn(),
      confirmOrder: jest.fn(),
      releaseOrder: jest.fn().mockRejectedValue(new Error('erp down')),
      setExpiry: jest.fn(),
    };
    const settings = { get: jest.fn().mockResolvedValue(null) };
    const eventBus = { publish: jest.fn() };
    const saga = new OrderCheckoutSaga(dataSource as never, facade as never, settings as never, eventBus as never);

    await expect(saga.checkout('o1', 'key-wedge2')).rejects.toThrow('product p1 not found');
    expect(order.status).toBe('failed');
  });
});

/**
 * Conditional-transition coverage: the order flip (pending_payment → confirmed/
 * failed) is checked-and-written atomically inside the tx; downstream effects
 * (fulfillments, publish, facade confirm/release) only run when that flip
 * actually won (`affected` from the mocked `update`). `orderUpdateAffected: 0`
 * simulates the order having already left pending_payment (e.g. expired by the
 * TTL sweep) by the time the payment result lands.
 */
function makeTransitionSaga(orderUpdateAffected: number) {
  function repoStub() {
    return { update: jest.fn().mockResolvedValue({ affected: orderUpdateAffected }) };
  }
  // Pre-populate both repos (rather than lazily on first getRepository call) so
  // the "not called" assertions in the affected:0 branch have a stub to read.
  const repos: Record<string, { update: jest.Mock }> = { Order: repoStub(), OrderFulfillment: repoStub() };
  const manager = {
    getRepository: jest.fn().mockImplementation((e: { name: string }) => repos[e.name]),
  };
  const dataSource = { transaction: (fn: (m: unknown) => unknown) => fn(manager) };
  const facade = {
    reserve: jest.fn(),
    confirmOrder: jest.fn().mockResolvedValue(undefined),
    releaseOrder: jest.fn().mockResolvedValue(undefined),
    setExpiry: jest.fn(),
  };
  const settings = { get: jest.fn() };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const saga = new OrderCheckoutSaga(dataSource as never, facade as never, settings as never, eventBus as never);
  return { saga, facade, eventBus, repos };
}

describe('OrderCheckoutSaga.onPaymentPaid', () => {
  it('flips order pending_payment→confirmed, confirms fulfillments + publishes, then confirms reservations', async () => {
    const { saga, facade, eventBus, repos } = makeTransitionSaga(1);
    await saga.onPaymentPaid('o1');
    expect(repos['Order'].update).toHaveBeenCalledWith(
      { id: 'o1', status: 'pending_payment' }, { status: 'confirmed' });
    expect(repos['OrderFulfillment'].update).toHaveBeenCalledWith({ orderId: 'o1' }, { status: 'confirmed' });
    expect(eventBus.publish).toHaveBeenCalled();
    expect(facade.confirmOrder).toHaveBeenCalledWith('o1');
  });

  it('paid landing on an order no longer pending_payment (e.g. expired) → no confirm/publish', async () => {
    const { saga, facade, eventBus, repos } = makeTransitionSaga(0);
    await saga.onPaymentPaid('o1');
    expect(repos['OrderFulfillment'].update).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
    expect(facade.confirmOrder).not.toHaveBeenCalled();
  });
});

describe('OrderCheckoutSaga.onPaymentFailed', () => {
  it('flips order pending_payment→failed, releases fulfillments, then releases reservations', async () => {
    const { saga, facade, repos } = makeTransitionSaga(1);
    await saga.onPaymentFailed('o1');
    expect(repos['Order'].update).toHaveBeenCalledWith(
      { id: 'o1', status: 'pending_payment' }, { status: 'failed' });
    expect(repos['OrderFulfillment'].update).toHaveBeenCalledWith({ orderId: 'o1' }, { status: 'released' });
    expect(facade.releaseOrder).toHaveBeenCalledWith('o1', 'released');
  });

  it('failed landing on an order no longer pending_payment (e.g. expired) → no release', async () => {
    const { saga, facade, repos } = makeTransitionSaga(0);
    await saga.onPaymentFailed('o1');
    expect(repos['OrderFulfillment'].update).not.toHaveBeenCalled();
    expect(facade.releaseOrder).not.toHaveBeenCalled();
  });
});
