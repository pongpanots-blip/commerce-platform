import { ErpOrderPushSubscriber } from './erp-order-push.subscriber';

function makeSub(opts: {
  integration?: unknown; createOrderResult?: unknown; orderStatus?: string;
} = {}) {
  const order = { id: 'o1', status: opts.orderStatus ?? 'confirmed', customerId: 'c1',
    total: '150.00', currency: 'THB' };
  const repos: Record<string, unknown> = {
    Order: { findOne: jest.fn().mockResolvedValue(order) },
    OrderLine: { find: jest.fn().mockResolvedValue([
      { id: 'l1', productId: 'p1', qty: '1', unitPrice: '150' }]) },
    Product: { find: jest.fn().mockResolvedValue([{ id: 'p1', sku: 'A' }]) },
    Customer: { findOne: jest.fn().mockResolvedValue({ id: 'c1', code: 'JGT-9' }) },
    Integration: { findOne: jest.fn().mockResolvedValue(
      'integration' in opts ? opts.integration : { id: 'i-erp', type: 'erp', status: 'active', config: {} }) },
  };
  const dataSource = { getRepository: (e: { name: string }) => repos[e.name] };
  const client = { createOrder: jest.fn().mockResolvedValue(
    opts.createOrderResult ?? { ok: true, erpOrderRef: 'MOCK-ORD-o1' }) };
  const mapping = { link: jest.fn().mockResolvedValue(undefined) };
  const sub = new ErpOrderPushSubscriber(dataSource as never, client as never, mapping as never);
  return { sub, client, mapping, repos };
}

const event = { aggregateId: 'o1', payload: { id: 'o1' } };
/** The push runs detached from the listener (the outbox relay must not wait on the ERP). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ErpOrderPushSubscriber', () => {
  it('pushes a confirmed order and links the ERP ref', async () => {
    const { sub, client, mapping } = makeSub();
    sub.onOrderConfirmed(event as never);
    await flush();
    expect(client.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        platformOrderId: 'o1', customerCode: 'JGT-9', total: '150.00', currency: 'THB',
        lines: [{ sku: 'A', qty: 1, unitPrice: '150' }],
      }), {});
    expect(mapping.link).toHaveBeenCalledWith('i-erp', 'order', 'o1', 'MOCK-ORD-o1');
  });

  it('skips silently when no active erp integration exists', async () => {
    const { sub, client } = makeSub({ integration: null });
    sub.onOrderConfirmed(event as never);
    await flush();
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('client failure → warn, no mapping, NO throw (push never blocks the order)', async () => {
    const { sub, mapping } = makeSub({ createOrderResult: { ok: false, error: 'down' } });
    expect(sub.onOrderConfirmed(event as never)).toBeUndefined();
    await flush();
    expect(mapping.link).not.toHaveBeenCalled();
  });

  it('client THROW is swallowed with a warn', async () => {
    const { sub, client, mapping } = makeSub();
    client.createOrder.mockRejectedValue(new Error('boom'));
    expect(sub.onOrderConfirmed(event as never)).toBeUndefined();
    await flush();
    expect(mapping.link).not.toHaveBeenCalled();
  });
});
