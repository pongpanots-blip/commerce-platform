import { describe, expect, it } from 'vitest';
import {
  formToPromotionRules,
  hasAnyPromotionPrice,
  rulesToForm,
} from './promotion-mechanic.helpers';

describe('untouched tier form (EditProduct) — B2 regression', () => {
  // EditProduct used to default the first tier row's price from
  // selling_price/base_selling_price (a TOTAL per order_taking_unit). The
  // backend multiplies a tier rule's price by pack weight, assuming a
  // per-selling_unit rate, so an untouched default silently inflated prices
  // (e.g. 3,960 -> 23,760) on every save. The fix: pass no price default, and
  // gate sending/validating `promotion_rules` on `hasAnyPromotionPrice`
  // rather than on `formToPromotionRules(...).length`, since `Number('')`
  // is `0` (not `NaN`) — a blank row would otherwise look like a real
  // "price 0" rule and still get sent.

  it('has no price when a product has no saved promotion_rules and no price default is passed', () => {
    const form = rulesToForm(undefined, undefined, 'กล่อง');
    expect(hasAnyPromotionPrice(form)).toBe(false);
    // Demonstrates the trap hasAnyPromotionPrice avoids: an untouched blank
    // row still parses to a "valid" price-0 rule via formToPromotionRules.
    expect(formToPromotionRules(form)).toEqual([
      { min_qty: 1, promotion_price: 0, unit_label: 'กล่อง', badge_text: undefined },
    ]);
  });

  it('is true once the admin actually fills in a price', () => {
    const form = rulesToForm(undefined, undefined, 'กล่อง');
    form.rules[0].promotionPrice = '95';
    expect(hasAnyPromotionPrice(form)).toBe(true);
    expect(formToPromotionRules(form)).toEqual([
      { min_qty: 1, promotion_price: 95, unit_label: 'กล่อง', badge_text: undefined },
    ]);
  });

  it('is true for existing saved rules loaded from the server (not a default-from-price case)', () => {
    const form = rulesToForm(
      [{ min_qty: 1, promotion_price: 3960, unit_label: 'กล่อง' }],
      undefined,
      'กล่อง',
    );
    expect(hasAnyPromotionPrice(form)).toBe(true);
    expect(formToPromotionRules(form)).toEqual([
      { min_qty: 1, promotion_price: 3960, unit_label: 'กล่อง', badge_text: undefined },
    ]);
  });
});
