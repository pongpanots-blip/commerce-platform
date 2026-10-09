import { PromotionRehearsalInput, rehearsePromotion } from './promotion-rehearsal';

const at = '2026-10-09T12:00:00Z';
const source = { id: 'snapshot-1', version: '12', asOf: '2026-10-09T11:59:00Z', validUntil: '2026-10-09T13:00:00Z' };
export const promotionFixture = (): PromotionRehearsalInput => ({ at,
  line: { sku: 'SKU-1', quantity: 1, unit: 'PC', quantityKind: 'count' },
  price: { kind: 'selling_price', sku: 'SKU-1', unit: 'PC', currency: 'THB', unitPrice: '107.00', pricingSource: 'base',
    pricingBasis: 'fixed_selling_unit',
    source: { ...source, id: 'selling-price' }, tax: { basis: 'inclusive', rateBasisPoints: 700 } },
  cost: { kind: 'authoritative_unit_cost', sku: 'SKU-1', unit: 'PC', currency: 'THB', unitCostExVat: '60.00',
    source: { ...source, id: 'cost' }, effectiveFrom: '2026-10-01T00:00:00Z', effectiveUntil: null },
  stock: { sku: 'SKU-1', warehouseId: 'warehouse-1', unit: 'PC', quantity: 10, reserved: 2, source: { ...source, id: 'stock' } },
  rules: [{ source: { ...source, id: 'proposal-rule' }, scope: 'sku', value: { type: 'percentage', percent: 10 }, capacity: { kind: 'uncapped' } }],
  stacking: 'none', minimumGrossMarginPercent: 20,
});
const codes = (input: PromotionRehearsalInput) => rehearsePromotion(input).issues.map(i => i.code);
const freeze = (o: any) => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };

describe('promotion rehearsal business contract', () => {
  it('uses inclusive VAT after discount, authoritative cost, margin and distinct markup', () => {
    const r = rehearsePromotion(promotionFixture());
    expect(r.status).toBe('complete');
    expect(r.amounts).toMatchObject({ beforeDiscountMinor: 10700, discountMinor: 1070, afterDiscountMinor: 9630,
      totalIncVatMinor: 9630, revenueExVatMinor: 9000, vatMinor: 630, costExVatMinor: 6000,
      grossProfitMinor: 3000, grossMarginPercent: 33.3333, markupPercent: 50 });
    expect(r.stock).toEqual({ available: 8, required: 1, shortage: 0, warehouseId: 'warehouse-1' });
    expect(r).toMatchObject({ mode: 'preview', persisted: false, activationAllowed: false, inputAuthority: 'caller_attested_snapshots' });
  });
  it('does not assume a VAT rate and supports explicit zero or exclusive VAT', () => {
    const p = promotionFixture(); p.price!.tax = { basis: 'exclusive', rateBasisPoints: 700 }; p.price!.unitPrice = '100.00';
    expect(rehearsePromotion(p).amounts).toMatchObject({ afterDiscountMinor: 9000, totalIncVatMinor: 9630, revenueExVatMinor: 9000, vatMinor: 630 });
    p.price!.tax.rateBasisPoints = 0;
    expect(rehearsePromotion(p).amounts!.vatMinor).toBe(0);
    p.price!.tax.rateBasisPoints = null;
    const r = rehearsePromotion(p);
    expect(r.status).toBe('incomplete'); expect(r.amounts!.grossProfitMinor).toBeNull(); expect(r.amounts!.totalIncVatMinor).toBeNull();
  });
  it('rounds half-up at the line boundary, including fractional measure quantities', () => {
    const p = promotionFixture(); p.price!.unitPrice = '0.05'; p.price!.tax.rateBasisPoints = 0; p.cost!.unitCostExVat = '0';
    expect(rehearsePromotion(p).amounts).toMatchObject({ beforeDiscountMinor: 5, discountMinor: 0, afterDiscountUnitMinor: 5, afterDiscountMinor: 5 });
    p.line = { ...p.line, unit: 'KG', quantityKind: 'measure', quantity: 1.2345 };
    p.price!.unit = p.cost!.unit = p.stock!.unit = 'KG'; p.price!.unitPrice = '10.00'; p.rules = [];
    expect(rehearsePromotion(p).amounts!.afterDiscountMinor).toBe(1235);
  });
  it.each([2, 3, 5, 6])('BOGO qty %i uses whole sets and costs every delivered item', qty => {
    const p = promotionFixture(); p.line.quantity = qty; p.price!.unitPrice = '50.00'; p.price!.tax.rateBasisPoints = 0;
    p.cost!.unitCostExVat = '20.00'; p.rules![0].value = { type: 'bogo', buy_qty: 2, get_qty: 1, get_discount_percent: 100 };
    const r = rehearsePromotion(p);
    const nominal = qty * 5000 - Math.floor(qty / 3) * 5000;
    const storedUnit = Math.round(nominal / qty);
    expect(r.amounts!.discountMinor).toBe(qty * 5000 - storedUnit * qty);
    expect(r.amounts!.nominalEngineAfterDiscountMinor).toBe(nominal);
    expect(r.amounts!.costExVatMinor).toBe(qty * 2000);
  });
  it('exposes the one-cent BOGO adjustment from the actual Josh stored-unit rounding', () => {
    const p = promotionFixture(); p.line.quantity = 3; p.price!.unitPrice = '50'; p.price!.tax.rateBasisPoints = 0;
    p.rules![0].value = { type: 'bogo', buy_qty: 2, get_qty: 1, get_discount_percent: 100 };
    expect(rehearsePromotion(p).amounts).toMatchObject({ afterDiscountUnitMinor: 3333, afterDiscountMinor: 9999,
      nominalEngineAfterDiscountMinor: 10000, roundingAdjustmentMinor: -1, discountMinor: 5001 });
  });
  it('keeps approximate or unknown pack price basis unavailable without inventing a UOM conversion', () => {
    const p = promotionFixture(); p.price!.pricingBasis = 'approx_weight_pack';
    expect(rehearsePromotion(p)).toMatchObject({ status: 'incomplete', amounts: null });
    expect(codes(p)).toContain('approx_or_unknown_price_basis_unsupported');
  });
  it.each([[1, 10000], [4, 40000], [5, 45000], [6, 54000]])('tier qty %i respects engine boundaries', (q, minor) => {
    const p = promotionFixture(); p.line.quantity = q; p.price!.unitPrice = '120';
    p.rules![0].value = { type: 'tiered', tiers: [{ min_qty: 1, max_qty: 4, promotion_price: 100 }, { min_qty: 5, promotion_price: 90 }] };
    expect(rehearsePromotion(p).amounts!.afterDiscountMinor).toBe(minor);
  });
  it('caps a fixed discount at the line total and leaves zero-denominator percentages unavailable', () => {
    const p = promotionFixture(); p.rules![0].value = { type: 'fixed', amount: 1000 }; p.minimumGrossMarginPercent = null;
    const r = rehearsePromotion(p);
    expect(r.amounts).toMatchObject({ afterDiscountMinor: 0, revenueExVatMinor: 0, grossProfitMinor: -6000, grossMarginPercent: null, markupPercent: -100 });
    p.cost!.unitCostExVat = '0'; p.rules = [];
    expect(rehearsePromotion(p).amounts).toMatchObject({ grossMarginPercent: 100, markupPercent: null });
  });
  it.each(['supplier_quote', 'competitor_observation', 'current_metadata'] as const)('%s never becomes cost', kind => {
    const p = promotionFixture(); p.cost!.kind = kind;
    const r = rehearsePromotion(p); expect(r.status).toBe('incomplete'); expect(r.amounts!.costExVatMinor).toBeNull();
    expect(r.amounts!.grossMarginPercent).toBeNull(); expect(codes(p)).toContain('cost_not_authoritative');
  });
  it('preserves missing inputs instead of substituting zero or no rules', () => {
    const p = promotionFixture(); p.cost = null; p.stock = null;
    expect(rehearsePromotion(p)).toMatchObject({ status: 'incomplete', stock: null, amounts: { costExVatMinor: null, grossProfitMinor: null } });
    p.rules = null; expect(rehearsePromotion(p).amounts).toBeNull();
    p.price = null; expect(codes(p)).toContain('selling_price_unavailable');
  });
  it('uses effective and fresh data, with inclusive validity boundaries', () => {
    const p = promotionFixture(); p.cost!.source.validUntil = at; expect(rehearsePromotion(p).status).toBe('complete');
    p.cost!.source.validUntil = '2026-10-09T11:59:59Z'; expect(rehearsePromotion(p).amounts!.costExVatMinor).toBeNull();
    p.cost!.source.validUntil = source.validUntil; p.cost!.effectiveFrom = '2026-10-10T00:00:00Z'; expect(codes(p)).toContain('cost_not_effective');
    p.rules![0].source.validUntil = '2026-10-09T11:59:59Z'; expect(rehearsePromotion(p).amounts).toBeNull();
    p.price!.source.asOf = '2026-10-09T12:01:00Z'; expect(codes(p)).toContain('input_not_yet_effective');
  });
  it('fails UOM and identity checks without inventing conversions', () => {
    const p = promotionFixture(); p.stock!.unit = 'KG'; p.cost!.sku = 'OTHER';
    const r = rehearsePromotion(p); expect(r.status).toBe('incomplete'); expect(r.stock).toBeNull(); expect(r.amounts!.costExVatMinor).toBeNull();
    p.price!.currency = 'USD'; expect(rehearsePromotion(p).status).toBe('rejected');
  });
  it('blocks stock/cap constraints at exact unreserved availability', () => {
    const p = promotionFixture(); p.line.quantity = 8; expect(rehearsePromotion(p).stock!.shortage).toBe(0);
    p.line.quantity = 9; expect(codes(p)).toContain('insufficient_unreserved_stock'); expect(rehearsePromotion(p).status).toBe('constraints_failed');
    p.line.quantity = 1; p.rules![0].capacity = { kind: 'capped', remainingUnits: 0 }; expect(codes(p)).toContain('promotion_capacity_exceeded');
    p.rules![0].capacity = { kind: 'unknown' }; expect(rehearsePromotion(p).status).toBe('incomplete');
  });
  it('checks the unrounded margin threshold rather than a rounded display percentage', () => {
    const p = promotionFixture(); p.rules = []; p.price!.unitPrice = '10000'; p.price!.tax.rateBasisPoints = 0; p.cost!.unitCostExVat = '9000.01'; p.minimumGrossMarginPercent = 10;
    expect(codes(p)).toContain('margin_below_minimum');
  });
  it('rejects stacking, unsupported predicates/scopes, higher-priority prices and invalid tiers', () => {
    const p = promotionFixture(); p.rules!.push({ ...p.rules![0] }); expect(codes(p)).toContain('stacking_not_supported');
    p.rules!.pop(); p.stacking = 'requested'; expect(rehearsePromotion(p).amounts).toBeNull();
    p.stacking = 'none'; p.rules![0].predicate = { field: 'cart.total', op: '>=', value: 500 }; expect(codes(p)).toContain('rule_scope_or_predicate_not_supported');
    delete p.rules![0].predicate; p.price!.pricingSource = 'contract_sku'; expect(codes(p)).toContain('higher_priority_price_or_existing_rule');
    p.price!.pricingSource = 'base'; p.rules![0].value = { type: 'tiered', tiers: [{ min_qty: 5, max_qty: 2, promotion_price: 90 }] };
    expect(codes(p)).toContain('invalid_promotion_rule');
  });
  it('rejects fractional counts, measure BOGO, malformed/unsafe quantities and money overflow', () => {
    const p = promotionFixture(); p.line.quantity = 1.5; expect(codes(p)).toContain('fractional_count_quantity');
    p.line.quantityKind = 'measure'; p.rules![0].value = { type: 'bogo', buy_qty: 1, get_qty: 1, get_discount_percent: 100 };
    expect(codes(p)).toContain('bogo_requires_count_units');
    p.line.quantity = 0; expect(() => rehearsePromotion(p)).toThrow();
    p.line.quantity = NaN; expect(() => rehearsePromotion(p)).toThrow();
    p.line.quantity = 1.00001; expect(() => rehearsePromotion(p)).toThrow();
    p.line.quantity = 1_000_000; p.rules = []; p.price!.unitPrice = '9999999999.99'; expect(codes(p)).toContain('money_out_of_range');
  });
  it('is deterministic and does not mutate frozen inputs or fetch/persist', () => {
    const p = freeze(promotionFixture()); const fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'));
    try { expect(rehearsePromotion(p)).toEqual(rehearsePromotion(p)); expect(fetchSpy).not.toHaveBeenCalled(); }
    finally { fetchSpy.mockRestore(); }
  });
});
