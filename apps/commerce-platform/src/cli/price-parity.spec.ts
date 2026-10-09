import { erpPriceAsJoshTotal } from './price-parity';

it('scales commerce ERP PRICE to the sell-unit total josh stores as original_price', () => {
  expect(erpPriceAsJoshTotal('2338.00', { order_taking_unit: 'KG', pack_size: '5 - 7 PC X 3 KG' })).toBe(7014);
  expect(erpPriceAsJoshTotal('1872.00', { order_taking_unit: 'BX', pack_size: '0.17 KG X 12 PK' })).toBe(1872);
  expect(erpPriceAsJoshTotal(null, { order_taking_unit: 'BX' })).toBeNull();
});
