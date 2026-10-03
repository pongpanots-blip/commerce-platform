import {
  parseErpCustomer, parseErpProduct, parseErpSaleOrder, parseErpStock, parseJagotaMoq, parseJagotaPrice, parseJagotaQty,
} from './erp-payload.parsers';

const productRaw = { INVENTORY_ITEM_ID: 10001, SEGMENT1: 'FISH-SALMON-1KG',
  DESCRIPTION: 'Salmon Fillet 1kg', PRIMARY_UOM_CODE: 'KG',
  INVENTORY_ITEM_STATUS_CODE: 'Active', FULL_LEAD_TIME: 3, LIST_PRICE: 590.0 };

describe('ERP payload parsers (Oracle examples)', () => {
  it('product', () => {
    expect(parseErpProduct(productRaw)).toEqual({
      sku: 'FISH-SALMON-1KG', name: 'Salmon Fillet 1kg', status: 'active',
      leadTimeDays: 3, listPrice: '590.00', uom: 'KG', externalId: '10001' });
  });

  it('product inactive + missing optionals', () => {
    expect(parseErpProduct({ INVENTORY_ITEM_ID: 1, SEGMENT1: 'X', DESCRIPTION: 'X',
      INVENTORY_ITEM_STATUS_CODE: 'Inactive' })).toMatchObject({
      status: 'inactive', leadTimeDays: null, listPrice: null, uom: null });
  });

  it('product missing SEGMENT1 throws', () => {
    expect(() => parseErpProduct({ DESCRIPTION: 'x' })).toThrow('SEGMENT1');
  });

  it('stock', () => {
    expect(parseErpStock({ INVENTORY_ITEM_ID: 10001, SEGMENT1: 'FISH-SALMON-1KG',
      SUBINVENTORY_CODE: 'BKK-MAIN', ON_HAND_QTY: 42 })).toEqual({
      sku: 'FISH-SALMON-1KG', externalItemId: '10001', warehouseCode: 'BKK-MAIN', quantity: 42 });
  });

  it('customer normalizes email/phone like the storefront rules', () => {
    expect(parseErpCustomer({ CUST_ACCOUNT_ID: 5001, ACCOUNT_NUMBER: 'JGT-00871',
      PARTY_NAME: 'Somchai Restaurant Co., Ltd.', EMAIL_ADDRESS: ' AP@Somchai.co.th ',
      PHONE_NUMBER: '02-123-4567', TAX_REFERENCE: '0105561234567' })).toEqual({
      code: 'JGT-00871', name: 'Somchai Restaurant Co., Ltd.', email: 'ap@somchai.co.th',
      phone: '021234567', taxId: '0105561234567', externalId: '5001' });
  });

  it('sale order', () => {
    expect(parseErpSaleOrder({ HEADER_ID: 7001, ORDER_NUMBER: 'SO-2026-045121',
      ORDERED_DATE: '2026-07-18T09:30:00Z', SOLD_TO_ACCOUNT: 'JGT-00871',
      LINES: [{ LINE_NUMBER: 1, SEGMENT1: 'FISH-SALMON-1KG', ORDERED_QUANTITY: 10,
        UNIT_SELLING_PRICE: 550.0 }] })).toEqual({
      orderNumber: 'SO-2026-045121', orderedDate: '2026-07-18T09:30:00Z',
      soldToAccount: 'JGT-00871',
      lines: [{ sku: 'FISH-SALMON-1KG', qty: 10, unitPrice: '550.00' }] });
  });

  it('sale order line missing SEGMENT1 throws naming the field', () => {
    expect(() => parseErpSaleOrder({ ORDER_NUMBER: 'SO-1',
      LINES: [{ ORDERED_QUANTITY: 10, UNIT_SELLING_PRICE: 550.0 }] })).toThrow('SEGMENT1');
  });

  it('sale order line non-numeric ORDERED_QUANTITY throws naming the field', () => {
    expect(() => parseErpSaleOrder({ ORDER_NUMBER: 'SO-1',
      LINES: [{ SEGMENT1: 'X', ORDERED_QUANTITY: 'ten', UNIT_SELLING_PRICE: 550.0 }] })).toThrow('ORDERED_QUANTITY');
  });

  it('sale order line non-numeric UNIT_SELLING_PRICE throws naming the field', () => {
    expect(() => parseErpSaleOrder({ ORDER_NUMBER: 'SO-1',
      LINES: [{ SEGMENT1: 'X', ORDERED_QUANTITY: 10, UNIT_SELLING_PRICE: 'lots' }] })).toThrow('UNIT_SELLING_PRICE');
  });
});

describe('Jagota feed parsers', () => {
  it('qty', () => {
    expect(parseJagotaQty({ PRODUCT_CODE: '1001876', QUANTITY: 48, CHANGED_AT: '2026-10-03T07:01:29Z', REASON: 'SALE' }))
      .toEqual({ sku: '1001876', warehouseCode: null, quantity: 48, reason: 'SALE', changedAt: '2026-10-03T07:01:29Z' });
  });

  it('qty: null QUANTITY means out of stock; WAREHOUSE_CODE passes through', () => {
    expect(parseJagotaQty({ PRODUCT_CODE: '1', QUANTITY: null, WAREHOUSE_CODE: 'CNX' }))
      .toMatchObject({ quantity: 0, warehouseCode: 'CNX', changedAt: null });
  });

  it('qty: rejects a bad CHANGED_AT and a missing PRODUCT_CODE', () => {
    expect(() => parseJagotaQty({ PRODUCT_CODE: '1', QUANTITY: 1, CHANGED_AT: 'yesterday' })).toThrow('CHANGED_AT');
    expect(() => parseJagotaQty({ QUANTITY: 1 })).toThrow('PRODUCT_CODE');
  });

  it('price keeps either side optional', () => {
    expect(parseJagotaPrice({ PRODUCT_CODE: '1', PRICE: { SELLING_UNIT_PRICE: 59 } }))
      .toEqual({ sku: '1', orderingPrice: null, sellingUnitPrice: '59.00' });
  });

  it('moq', () => {
    expect(parseJagotaMoq({ PRODUCT_CODE: '1', MOQ: 6 })).toEqual({ sku: '1', moq: 6 });
    expect(() => parseJagotaMoq({ PRODUCT_CODE: '1' })).toThrow('MOQ');
  });
});
