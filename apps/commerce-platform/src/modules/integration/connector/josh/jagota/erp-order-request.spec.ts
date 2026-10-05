import { buildErpCreateOrderRequest, diffErpRequests, ErpOrderInput, InventoryRow } from './erp-order-request';

// Fixtures and expected payloads from josh app/jagota-order/jagota-order.service.spec.ts (origin/main d84d692b).
const inventory = new Map<string, InventoryRow>([['inv-1', {
  product_inventory_id: 'inv-1', product_inventory_sku: 'SKU-1', selling_unit: 'KG', order_taking_unit: null, order_taking_flag: 'N',
}]]);
const input: ErpOrderInput = {
  orderNumber: '2026090700001', parentOrderNumber: 'JOSH-1757238401-482', customerCode: 'TMI0360',
  deliveryDate: new Date('2026-09-12T00:00:00.000Z'), lineItems: [{ productInventoryId: 'inv-1', quantity: 10, unitPrice: 100 }],
};

describe('ERP order request (josh builder, rebuilt in commerce)', () => {
  it('builds exactly what josh\'s own test expects josh to send', () => {
    expect(buildErpCreateOrderRequest(input, inventory, '7')).toEqual({
      P_CUST_CODE: 'TMI0360', MAGENTO_ORDER_NO: '2026090700001', MAGENTO_PARENT_ORDER_NO: 'JOSH-1757238401-482', JOSH_ORDER_NO: 2026090700001,
      orderItems: [{ P_PRODUCT_CODE: 'SKU-1', P_UNIT: 'KG', P_QTY: 10, P_RATE: 100, P_DELIVERY_DATE: '20260912', P_CUST_BRANCH_SEQ: '7', P_PO_NUMBER: '', PACKING_REMARKS: '' }],
    });
  });

  it('PO and remark (trimmed) on every line; legacy references stay strings; a date read as text works the same', () => {
    const r = buildErpCreateOrderRequest({ ...input, poNumber: '  PO-2026-001  ', remark: 'ห่อแยกกล่อง', orderNumber: 'JOSH-1757238401-482-1', deliveryDate: '2026-09-12',
      lineItems: [{ productInventoryId: 'inv-1', quantity: 10, unitPrice: 100 }, { productInventoryId: 'inv-1', quantity: 2, unitPrice: 100 }] }, inventory, null);
    expect(r.JOSH_ORDER_NO).toBe('JOSH-1757238401-482-1');
    expect(r.orderItems.map((l) => [l.P_PO_NUMBER, l.PACKING_REMARKS, l.P_DELIVERY_DATE, l.P_CUST_BRANCH_SEQ])).toEqual([
      ['PO-2026-001', 'ห่อแยกกล่อง', '20260912', ''], ['PO-2026-001', 'ห่อแยกกล่อง', '20260912', ''],
    ]);
  });

  it('no delivery date → the day josh sent it, not the day of the check', () => {
    const r = buildErpCreateOrderRequest({ ...input, deliveryDate: null }, inventory, '7', new Date('2026-10-01T05:00:00Z'));
    expect(r.orderItems[0].P_DELIVERY_DATE).toBe('20261001');
  });
});

describe('diffErpRequests', () => {
  const josh = buildErpCreateOrderRequest({ ...input, lineItems: [
    { productInventoryId: 'inv-1', quantity: 10, unitPrice: 100 },
    { productInventoryId: 'inv-2', quantity: 1, unitPrice: 50 },
  ] }, new Map([...inventory, ['inv-2', { product_inventory_id: 'inv-2', product_inventory_sku: 'SKU-2', selling_unit: 'PCS' }]]), '7');

  it('same request in another line order is a match', () => {
    expect(diffErpRequests(josh, { ...josh, orderItems: [...josh.orderItems].reverse() })).toEqual([]);
  });

  it('names each differing field; a number sent as text is a difference (ERP is strict)', () => {
    const commerce = { ...josh, JOSH_ORDER_NO: '2026090700001', orderItems: [{ ...josh.orderItems[0], P_RATE: 95 }, josh.orderItems[1]] };
    expect(diffErpRequests(josh, commerce)).toEqual([
      { path: 'JOSH_ORDER_NO', josh: 2026090700001, commerce: '2026090700001' },
      { path: 'orderItems[SKU-1].P_RATE', josh: 100, commerce: 95 },
    ]);
  });

  it('a missing line is a difference', () => {
    expect(diffErpRequests(josh, { ...josh, orderItems: [josh.orderItems[0]] })).toEqual([{ path: 'orderItems[SKU-2]', josh: 1, commerce: 0 }]);
  });
});
