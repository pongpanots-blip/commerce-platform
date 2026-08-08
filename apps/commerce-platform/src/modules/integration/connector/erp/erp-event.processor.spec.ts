import { ErpEventProcessor } from './erp-event.processor';

function makeProcessor(integrationType = 'erp') {
  const integrations = {
    findOne: jest.fn().mockResolvedValue(
      integrationType ? { id: 'i1', type: integrationType } : null),
  };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const ingest = { stageAndApply: jest.fn().mockResolvedValue(undefined) };
  const processor = new ErpEventProcessor(integrations as never, eventBus as never, ingest as never);
  return { processor, eventBus, ingest };
}

const emitted = (payload: unknown) => ({
  aggregateId: 'i1',
  payload: { webhookEventId: 'w1', payload },
});

describe('ErpEventProcessor', () => {
  it('maps sale_order.created → erp.sale-order.created with the ERP payload', async () => {
    const { processor, eventBus } = makeProcessor();
    await processor.onWebhookReceived(emitted({ event_type: 'sale_order.created', order: { id: 'SO-1' } }) as never);
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    const event = eventBus.publish.mock.calls[0][0];
    expect(event.type).toBe('erp.sale-order.created');
    expect(event.payload).toEqual({ webhookEventId: 'w1', order: { id: 'SO-1' } });
  });

  it('maps stock.changed → inventory.updated, product.changed → product.updated, customer.changed → customer.updated', async () => {
    const { processor, eventBus } = makeProcessor();
    for (const [inType, outType] of [
      ['stock.changed', 'inventory.updated'],
      ['product.changed', 'product.updated'],
      ['customer.changed', 'customer.updated'],
    ]) {
      eventBus.publish.mockClear();
      await processor.onWebhookReceived(emitted({ event_type: inType }) as never);
      expect(eventBus.publish.mock.calls[0][0].type).toBe(outType);
    }
  });

  it('ignores non-erp integrations', async () => {
    const { processor, eventBus } = makeProcessor('shopify');
    await processor.onWebhookReceived(emitted({ event_type: 'sale_order.created' }) as never);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('unknown event_type → logged, no publish, NO throw', async () => {
    const { processor, eventBus } = makeProcessor();
    await expect(
      processor.onWebhookReceived(emitted({ event_type: 'mystery.thing' }) as never),
    ).resolves.toBeUndefined();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('product.changed also routes the item payload into stageAndApply as entityType "product"', async () => {
    const { processor, ingest } = makeProcessor();
    const item = { INVENTORY_ITEM_ID: 1, SEGMENT1: 'SKU-1' };
    await processor.onWebhookReceived(emitted({ event_type: 'product.changed', item }) as never);
    expect(ingest.stageAndApply).toHaveBeenCalledWith('i1', 'product', item);
  });

  it('stock.changed routes raw.onhand into stageAndApply as entityType "stock"', async () => {
    const { processor, ingest } = makeProcessor();
    const onhand = { SUBINVENTORY_CODE: 'BKK-MAIN', ON_HAND_QTY: 42 };
    await processor.onWebhookReceived(emitted({ event_type: 'stock.changed', onhand }) as never);
    expect(ingest.stageAndApply).toHaveBeenCalledWith('i1', 'stock', onhand);
  });

  it('customer.changed routes raw.account into stageAndApply as entityType "customer"', async () => {
    const { processor, ingest } = makeProcessor();
    const account = { ACCOUNT_NUMBER: 'JGT-1', PARTY_NAME: 'X' };
    await processor.onWebhookReceived(emitted({ event_type: 'customer.changed', account }) as never);
    expect(ingest.stageAndApply).toHaveBeenCalledWith('i1', 'customer', account);
  });

  it('sale_order.created routes raw.order into stageAndApply as entityType "sale_order"', async () => {
    const { processor, ingest } = makeProcessor();
    const order = { ORDER_NUMBER: 'SO-1' };
    await processor.onWebhookReceived(emitted({ event_type: 'sale_order.created', order }) as never);
    expect(ingest.stageAndApply).toHaveBeenCalledWith('i1', 'sale_order', order);
  });

  it('falls back to the rest-of-payload object when the nested data key is absent', async () => {
    const { processor, ingest } = makeProcessor();
    await processor.onWebhookReceived(
      emitted({ event_type: 'product.changed', INVENTORY_ITEM_ID: 7, SEGMENT1: 'FLAT-SKU' }) as never,
    );
    expect(ingest.stageAndApply).toHaveBeenCalledWith('i1', 'product', { INVENTORY_ITEM_ID: 7, SEGMENT1: 'FLAT-SKU' });
  });

  it('unknown event_type stages nothing (no publish AND no staging)', async () => {
    const { processor, ingest } = makeProcessor();
    await processor.onWebhookReceived(emitted({ event_type: 'mystery.thing' }) as never);
    expect(ingest.stageAndApply).not.toHaveBeenCalled();
  });

  it('non-erp integrations stage nothing', async () => {
    const { processor, ingest } = makeProcessor('shopify');
    await processor.onWebhookReceived(emitted({ event_type: 'product.changed', item: {} }) as never);
    expect(ingest.stageAndApply).not.toHaveBeenCalled();
  });
});
