import { isSellUnitTotalConversion } from './promotion-rules-adopt-josh';

describe('isSellUnitTotalConversion', () => {
  const rate = [{ min_qty: 1, max_qty: 4, promotion_price: 156 }, { min_qty: 5, promotion_price: 148.2 }];

  it('adopts tiers that are Josh-side rate × one factor (a 12-pack box: 156 → 1,872)', () => {
    expect(isSellUnitTotalConversion(rate, [{ min_qty: 1, max_qty: 4, promotion_price: 1872 }, { min_qty: 5, promotion_price: 1778.4 }])).toBe(true);
  });

  it('leaves anything else to a human: an edited price, different tiers, nothing to convert', () => {
    expect(isSellUnitTotalConversion(rate, [{ min_qty: 1, max_qty: 4, promotion_price: 1872 }, { min_qty: 5, promotion_price: 1700 }])).toBe(false);
    expect(isSellUnitTotalConversion(rate, [{ min_qty: 1, max_qty: 9, promotion_price: 1872 }, { min_qty: 10, promotion_price: 1778.4 }])).toBe(false);
    expect(isSellUnitTotalConversion(rate, rate)).toBe(false);
    expect(isSellUnitTotalConversion([], [])).toBe(false);
  });
});
