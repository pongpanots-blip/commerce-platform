import { BadRequestException } from '@nestjs/common';
import {
  resolvePromotionValue,
  validatePromotionPredicate,
  validatePromotionValue,
} from './promotion-value';

describe('validatePromotionPredicate', () => {
  it('allows a null predicate', () => {
    expect(() => validatePromotionPredicate(null)).not.toThrow();
  });

  it('rejects a field outside the whitelist', () => {
    expect(() =>
      validatePromotionPredicate({
        field: 'raw_sql_injection' as never,
        op: '>=',
        value: 1,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects an op outside the whitelist', () => {
    expect(() =>
      validatePromotionPredicate({
        field: 'cart.total',
        op: 'DROP TABLE' as never,
        value: 1,
      }),
    ).toThrow(BadRequestException);
  });

  it('recursively validates nested conditions', () => {
    expect(() =>
      validatePromotionPredicate({
        op: 'and',
        conditions: [
          { field: 'cart.total', op: '>=', value: 500 },
          { field: 'bad_field' as never, op: '>=', value: 1 },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects an "and"/"or" node with no conditions', () => {
    expect(() => validatePromotionPredicate({ op: 'and', conditions: [] })).toThrow(
      BadRequestException,
    );
  });
});

describe('validatePromotionValue', () => {
  it('allows a null value', () => {
    expect(() => validatePromotionValue(null)).not.toThrow();
  });

  it('rejects a negative fixed amount', () => {
    expect(() => validatePromotionValue({ type: 'fixed', amount: -1 })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a percentage outside 0-100', () => {
    expect(() => validatePromotionValue({ type: 'percentage', percent: 101 })).toThrow(
      BadRequestException,
    );
  });

  it('rejects an empty tiers array', () => {
    expect(() => validatePromotionValue({ type: 'tiered', tiers: [] })).toThrow(
      BadRequestException,
    );
  });

  it('rejects bogo with non-positive buy/get quantities', () => {
    expect(() =>
      validatePromotionValue({ type: 'bogo', buy_qty: 0, get_qty: 1, get_discount_percent: 100 }),
    ).toThrow(BadRequestException);
  });
});

describe('resolvePromotionValue', () => {
  it('returns nothing for a null value', () => {
    expect(resolvePromotionValue(null, { basePrice: 100, quantity: 1 })).toEqual({});
  });

  it('resolves a fixed discount, capped at the line total', () => {
    expect(
      resolvePromotionValue({ type: 'fixed', amount: 30 }, { basePrice: 100, quantity: 1 }),
    ).toEqual({ discountAmount: 30 });
    expect(
      resolvePromotionValue({ type: 'fixed', amount: 500 }, { basePrice: 100, quantity: 1 }),
    ).toEqual({ discountAmount: 100 });
  });

  it('resolves a percentage discount off the line total', () => {
    expect(
      resolvePromotionValue(
        { type: 'percentage', percent: 10 },
        { basePrice: 200, quantity: 2 },
      ),
    ).toEqual({ discountAmount: 40 });
  });

  it('resolves bogo discount amount from complete buy/get sets only', () => {
    // buy 2 get 1 free, 100% off the free item
    const value = { type: 'bogo' as const, buy_qty: 2, get_qty: 1, get_discount_percent: 100 };
    expect(resolvePromotionValue(value, { basePrice: 50, quantity: 3 })).toEqual({
      discountAmount: 50,
    });
    // 5 items = 1 complete set (3) + 2 leftover, still only 1 set counts
    expect(resolvePromotionValue(value, { basePrice: 50, quantity: 5 })).toEqual({
      discountAmount: 50,
    });
    // below one full set: no discount
    expect(resolvePromotionValue(value, { basePrice: 50, quantity: 2 })).toEqual({
      discountAmount: 0,
    });
  });

  it('resolves tiered pricing using the same tie-break as resolvePromotionPrice', () => {
    const value = {
      type: 'tiered' as const,
      tiers: [
        { min_qty: 1, max_qty: 4, promotion_price: 100 },
        { min_qty: 5, promotion_price: 90 },
      ],
    };
    expect(resolvePromotionValue(value, { basePrice: 120, quantity: 1 })).toEqual({
      finalPrice: 100,
    });
    expect(resolvePromotionValue(value, { basePrice: 120, quantity: 10 })).toEqual({
      finalPrice: 90,
    });
    expect(resolvePromotionValue(value, { basePrice: 120, quantity: 0 })).toEqual({
      finalPrice: 120,
    });
  });
});
