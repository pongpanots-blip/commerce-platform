import { compareLine, JoshOrderLine } from './price-shadow';

const line = (over: Partial<JoshOrderLine> = {}): JoshOrderLine => ({
  id: 'oi-1', order_number: 'JOSH-1', sku: '1007310', product_inventory_id: 'inv-1', quantity: 2, unit_price: 450,
  price_source: 'customer_sku', promotion_mechanic_id: null, company_id: 'co-1', branch_id: 'br-1', ordered_at: new Date('2026-10-01T03:00:00Z'),
  packaging_type: null, selling_unit: 'PC', selling_unit_price: 500, ordering_price: null, pack_size: null, units_per_box: null, weight_per_unit: null, ...over,
});
const resolved = (over: Record<string, unknown> = {}) => ({ price: 450, base_price: 500, source: 'customer_sku', promotion_mechanic_id: null, endDate: null, ...over }) as never;

describe('compareLine', () => {
  it('matches when price, source and mechanic are what josh stored', () => {
    expect(compareLine(line(), resolved())).toEqual({ unitPrice: 450, diffs: [] });
  });

  it('names each difference', () => {
    expect(compareLine(line(), resolved({ price: 500, source: 'base' })).diffs).toEqual(['price', 'source']);
    expect(compareLine(line({ price_source: 'promotion_mechanic', promotion_mechanic_id: 'm-1' }), resolved({ source: 'promotion_mechanic', promotion_mechanic_id: 'm-2' })).diffs).toEqual(['mechanic']);
  });

  it('ignores sub-satang rounding, not a satang', () => {
    expect(compareLine(line({ unit_price: 449.996 }), resolved()).diffs).toEqual([]);
    expect(compareLine(line({ unit_price: 449.99 }), resolved()).diffs).toEqual(['price']);
  });

  it('old lines without a recorded source compare the price only', () => {
    expect(compareLine(line({ price_source: null }), resolved({ source: 'base' })).diffs).toEqual([]);
  });

  it('a weight-priced approx box is compared per order unit (josh pack-order-price fixture: 720/kg × 24 kg box)', () => {
    const approx = line({ packaging_type: 'Approx', selling_unit: 'KG', selling_unit_price: 720, ordering_price: 17280, pack_size: '7 - 12 KG X 2 PC',
      unit_price: 17280, price_source: 'base' });
    expect(compareLine(approx, resolved({ price: 720, source: 'base' }))).toEqual({ unitPrice: 17280, diffs: [] });
  });
});
