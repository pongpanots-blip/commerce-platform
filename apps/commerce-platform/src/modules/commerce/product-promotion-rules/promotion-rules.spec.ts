import { splitPromotionRules, validatePromotionRules } from './promotion-rules';
describe('product promotion rules', () => {
  it('replaces/clears and canonicalizes storage labels', () => {
    expect(validatePromotionRules('[]')).toEqual([]);
    expect(validatePromotionRules([{ min_qty: 2, promotion_price: 0, unit_label: 'box' }])).toEqual([{ min_qty: 2, promotion_price: 0, unit_label: 'BX' }]);
    expect(splitPromotionRules({ tier_prices: '[]', name: 'A' })).toEqual({ rules: [], rest: { name: 'A' } });
    expect(splitPromotionRules({ name: 'A' }).rules).toBeUndefined();
  });
  it.each([null, {}, 'bad', [{ min_qty: 0, promotion_price: 2 }], [{ min_qty: 1, promotion_price: -1 }], [{ min_qty: 1, promotion_price: 1.234 }], [{ min_qty: 1, max_qty: 0, promotion_price: 2 }], [{ min_qty: 1, promotion_price: Infinity }], [{ min_qty: 1, promotion_price: 1, campaign_id: 'x' }], [{ min_qty: 1, promotion_price: 1 }, { min_qty: 1, promotion_price: 2 }], [{ min_qty: 1, max_qty: 3, promotion_price: 1 }, { min_qty: 3, promotion_price: 2 }]])('rejects malformed rows %p', raw => expect(() => validatePromotionRules(raw)).toThrow());
  it('rejects conflicting aliases', () => expect(() => splitPromotionRules({ promotion_rules: [], tier_prices: [] })).toThrow());
});
