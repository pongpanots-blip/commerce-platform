import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ERP_RELAY_EVENTS, ErpRelayService, relayExternalId } from './erp-relay.service';

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
