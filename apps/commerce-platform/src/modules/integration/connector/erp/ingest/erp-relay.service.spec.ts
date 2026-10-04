import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ERP_RELAY_EVENTS, ErpRelayService, orderPeriodSnapshotKey, relayExternalId } from './erp-relay.service';

function setup(integration: { id: string } | null = { id: 'int-1' }) {
  const saved: Record<string, unknown>[] = [];
  const repo = { create: (x: Record<string, unknown>) => x, save: async (x: Record<string, unknown>) => { const row = { ...x, id: 'rec-1' }; saved.push(row); return row; } };
  const manager = { getRepository: () => repo };
  const db = { transaction: async (fn: (m: unknown) => unknown) => fn(manager) };
  const bus = { publish: jest.fn() };
  const svc = new ErpRelayService(db as never, { resolve: async () => integration } as never, bus as never);
  return { svc, saved, bus, manager };
}

it('finds a key id for the audit row in the shapes the ERP sends', () => {
  expect(relayExternalId({ PRODUCT_CODE: '1001876', PRODUCT_NAME_E: 'x' })).toBe('1001876');
  expect(relayExternalId([{ PRODUCT_CODE: 'A1' }, { PRODUCT_CODE: 'A2' }])).toBe('A1');
  expect(relayExternalId({ data: [{ quotationId: 77, STATUS: 'APPROVED' }] })).toBe('77');
  expect(relayExternalId({ orderId: 12, orderInfo: {} })).toBe('12');
  expect(relayExternalId({ something: 'else' })).toBeNull();
});

it('keeps the ERP request verbatim and publishes it in the same transaction (not a snapshot)', async () => {
  const { svc, saved, bus, manager } = setup();
  const body = { orderId: 12, orderInfo: { DOC_BOOK: 'SO', DOC_NO: '6900123' } };
  await svc.relay(ERP_RELAY_EVENTS.orderStatus, 'PUT /erp/orders/status', body);
  expect(saved[0]).toMatchObject({ entityType: 'relay', externalId: '12', rawPayload: body, status: 'applied',
    parsedPayload: { eventType: 'erp.order.status_changed', route: 'PUT /erp/orders/status' } });
  const [event, txManager] = bus.publish.mock.calls[0];
  expect(txManager).toBe(manager);
  expect(event).toMatchObject({ type: 'erp.order.status_changed', aggregateId: 'rec-1', metadata: {},
    payload: { route: 'PUT /erp/orders/status', externalId: '12', ingestRecordId: 'rec-1', erp: body } });
});

it('rejects an empty body (400) and answers 503 when the ERP integration is missing, so the ERP retries', async () => {
  await expect(setup().svc.relay(ERP_RELAY_EVENTS.customer, 'POST /erp/customers', [])).rejects.toBeInstanceOf(BadRequestException);
  await expect(setup().svc.relay(ERP_RELAY_EVENTS.customer, 'POST /erp/customers', null)).rejects.toBeInstanceOf(BadRequestException);
  await expect(setup(null).svc.relay(ERP_RELAY_EVENTS.customer, 'POST /erp/customers', { CUSTOMER_CODE: 'C1' })).rejects.toBeInstanceOf(ServiceUnavailableException);
});

it('order periods: latest-wins per SUP_CODE set (same key regardless of order), plain relay otherwise', async () => {
  const a = orderPeriodSnapshotKey([{ SUP_CODE: 'S2' }, { SUP_CODE: 'S1' }, { SUP_CODE: 'S1' }]);
  expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(orderPeriodSnapshotKey([{ SUP_CODE: 'S1' }, { SUP_CODE: ' S2 ' }])).toBe(a);
  expect(orderPeriodSnapshotKey([{ SUP_CODE: 'S1' }])).not.toBe(a);
  expect(orderPeriodSnapshotKey([{ SUP_CODE: 'S1' }, { ORDER_PERIOD: '1' }])).toBeNull();
  expect(orderPeriodSnapshotKey({ SUP_CODE: 'S1' })).toBeNull();

  const { svc, bus, saved } = setup();
  const body = [{ SUP_CODE: 'S1', ORDER_PERIOD: '2610' }];
  await svc.relay(ERP_RELAY_EVENTS.orderPeriods, 'PUT /erp/order-periods', body, orderPeriodSnapshotKey(body));
  const [event] = bus.publish.mock.calls[0];
  expect(saved[0]).toMatchObject({ externalId: 'S1' });
  expect(event).toMatchObject({ type: 'erp.order_periods.pushed', aggregateId: orderPeriodSnapshotKey(body), metadata: { snapshot: true },
    payload: { ingestRecordId: 'rec-1', erp: body } });
});
