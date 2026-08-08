import { StorefrontCheckoutService } from './storefront-checkout.service';

function makeService(payments: { id: string; status: string }[] = []) {
  const orders = {
    createWithLines: jest.fn().mockResolvedValue({ id: 'o1' }),
    findByIdempotencyKey: jest.fn().mockResolvedValue(null),
  };
  const saga = { checkout: jest.fn().mockResolvedValue({
    orderId: 'o1', status: 'pending_payment', paymentId: 'pay1', lines: [] }) };
  const paymentService = {
    list: jest.fn().mockResolvedValue({ items: payments }),
    markPaid: jest.fn().mockResolvedValue({ id: 'pay1', status: 'paid' }),
    markFailed: jest.fn().mockResolvedValue({ id: 'pay1', status: 'failed' }),
  };
  const service = new StorefrontCheckoutService(orders as never, saga as never, paymentService as never);
  return { service, orders, saga, paymentService };
}

describe('StorefrontCheckoutService', () => {
  it('checkout creates the order then runs the saga with the client key', async () => {
    const { service, orders, saga } = makeService();
    const res = await service.checkout(
      { customerId: 'c1', lines: [{ productId: 'p1', qty: 1, unitPrice: 100 }] }, 'idem-1');
    expect(orders.createWithLines).toHaveBeenCalledWith(
      { customerId: 'c1', currency: undefined, lines: [{ productId: 'p1', qty: 1, unitPrice: 100 }] });
    expect(saga.checkout).toHaveBeenCalledWith('o1', 'idem-1');
    expect(res).toMatchObject({ orderId: 'o1', status: 'pending_payment', paymentId: 'pay1' });
  });

  it('checkout rejects a missing Idempotency-Key before creating anything', async () => {
    const { service, orders, saga } = makeService();
    await expect(service.checkout(
      { customerId: 'c1', lines: [{ productId: 'p1', qty: 1, unitPrice: 100 }] },
      undefined as never,
    )).rejects.toThrow('Idempotency-Key header is required');
    expect(orders.createWithLines).not.toHaveBeenCalled();
    expect(saga.checkout).not.toHaveBeenCalled();
  });

  it('checkout rejects an empty Idempotency-Key before creating anything', async () => {
    const { service, orders } = makeService();
    await expect(service.checkout(
      { customerId: 'c1', lines: [{ productId: 'p1', qty: 1, unitPrice: 100 }] }, '',
    )).rejects.toThrow('Idempotency-Key header is required');
    expect(orders.createWithLines).not.toHaveBeenCalled();
  });

  it('checkout replays the saga on an existing order for a repeated key instead of creating a second draft', async () => {
    const { service, orders, saga } = makeService();
    orders.findByIdempotencyKey.mockResolvedValue({ id: 'o-existing' });
    const res = await service.checkout(
      { customerId: 'c1', lines: [{ productId: 'p1', qty: 1, unitPrice: 100 }] }, 'idem-1');
    expect(orders.findByIdempotencyKey).toHaveBeenCalledWith('idem-1');
    expect(orders.createWithLines).not.toHaveBeenCalled();
    expect(saga.checkout).toHaveBeenCalledWith('o-existing', 'idem-1');
    expect(res).toMatchObject({ orderId: 'o1', status: 'pending_payment', paymentId: 'pay1' });
  });

  it('checkout creates a fresh order when no order exists for the key (unchanged behavior)', async () => {
    const { service, orders, saga } = makeService();
    await service.checkout(
      { customerId: 'c1', lines: [{ productId: 'p1', qty: 1, unitPrice: 100 }] }, 'idem-2');
    expect(orders.findByIdempotencyKey).toHaveBeenCalledWith('idem-2');
    expect(orders.createWithLines).toHaveBeenCalledWith(
      { customerId: 'c1', currency: undefined, lines: [{ productId: 'p1', qty: 1, unitPrice: 100 }] });
    expect(saga.checkout).toHaveBeenCalledWith('o1', 'idem-2');
  });

  it('paymentResult(paid) marks the pending payment paid', async () => {
    const { service, paymentService } = makeService([{ id: 'pay1', status: 'pending' }]);
    await service.paymentResult('o1', 'paid');
    expect(paymentService.markPaid).toHaveBeenCalledWith('pay1');
  });

  it('paymentResult picks the newest pending payment (list is createdAt DESC)', async () => {
    const { service, paymentService } = makeService([
      { id: 'pay2', status: 'pending' },
      { id: 'pay1', status: 'failed' },
    ]);
    await service.paymentResult('o1', 'paid');
    expect(paymentService.markPaid).toHaveBeenCalledWith('pay2');
  });

  it('paymentResult skips newer non-pending payments to find the first pending', async () => {
    const { service, paymentService } = makeService([
      { id: 'pay3', status: 'paid' },
      { id: 'pay2', status: 'pending' },
    ]);
    await service.paymentResult('o1', 'paid');
    expect(paymentService.markPaid).toHaveBeenCalledWith('pay2');
  });

  it('paymentResult(failed) marks it failed', async () => {
    const { service, paymentService } = makeService([{ id: 'pay1', status: 'pending' }]);
    await service.paymentResult('o1', 'failed');
    expect(paymentService.markFailed).toHaveBeenCalledWith('pay1');
  });

  it('404s when the order has no pending payment', async () => {
    const { service } = makeService([{ id: 'pay1', status: 'paid' }]);
    await expect(service.paymentResult('o1', 'paid')).rejects.toThrow('no pending payment');
  });
});
