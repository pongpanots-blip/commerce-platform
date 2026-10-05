import { diffTotals, distributeDiscount, orderTotals, QuoteLine, splitPriceIncVat } from './order-totals';

const line = (p: Partial<QuoteLine>): QuoteLine => ({ quantity: 1, unitPriceIncVat: 107, vatType: '7%', fulfillmentType: 'standard', unitListPriceIncVat: null, isSpecialPrice: false, ...p });

describe('josh checkout math (copied)', () => {
  it('splits VAT per unit first, like josh', () => {
    expect(splitPriceIncVat(100, 0.07)).toEqual({ exVat: 93.46, vat: 6.54 });
    expect(splitPriceIncVat(100, 0)).toEqual({ exVat: 100, vat: 0 });
  });

  it('below 2,500 ex VAT pays 100 delivery per group; at or above is free', () => {
    const small = orderTotals([line({ quantity: 2 })], { exVat: 0, incVat: 0 });
    expect(small).toMatchObject({ subtotal_ex_vat: 200, vat_amount: 14, delivery_fee: 100, total_price: 314 });
    const big = orderTotals([line({ quantity: 25 })], { exVat: 0, incVat: 0 });
    expect(big).toMatchObject({ subtotal_ex_vat: 2500, delivery_fee: 0, total_price: 2675 });
    // Two fulfillment types = two groups, each judged on its own.
    const split = orderTotals([line({ quantity: 25 }), line({ fulfillmentType: 'order_taking' })], { exVat: 0, incVat: 0 });
    expect(split.delivery_fee).toBe(100);
  });

  it('VAT 0% lines and a checkout discount spread by largest remainder', () => {
    const t = orderTotals([line({ quantity: 10 }), line({ unitPriceIncVat: 50, vatType: '0%', quantity: 3, fulfillmentType: 'frozen' })], { exVat: 100, incVat: 107 });
    expect(t).toMatchObject({ discount_amount: 100, discount_inc_vat: 107, subtotal_ex_vat: 1050, vat_amount: 63, total_price: 1313 });
    expect(distributeDiscount([1, 1, 1], 3, 1)).toEqual([0.34, 0.33, 0.33]);
  });

  it('product discount from a higher list price, never for special prices', () => {
    const t = orderTotals([line({ unitListPriceIncVat: 214, quantity: 2 }), line({ unitListPriceIncVat: 214, isSpecialPrice: true })], { exVat: 0, incVat: 0 });
    expect(t.product_discount_ex_vat).toBe(200);
    expect(t.gross_ex_vat).toBe(500);
  });

  it('diff reports fields off by a satang or more and skips what josh did not store', () => {
    const c = orderTotals([line({})], { exVat: 0, incVat: 0 });
    expect(diffTotals({ ...c, total_price: 207.01, gross_ex_vat: null }, c)).toEqual([{ field: 'total_price', josh: 207.01, commerce: 207 }]);
  });
});
