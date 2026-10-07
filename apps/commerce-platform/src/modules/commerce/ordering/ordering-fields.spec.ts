import { BadRequestException } from '@nestjs/common';
import { logisticsFromJosh, normDeliveryDates, splitLogistics } from './logistics-fields';
import { mapErpOrderPeriods, toBangkokTimestamp, toDateOnly } from './order-periods';

describe('order periods (stage 4f) — josh upsertFromErp mapping', () => {
  it('takes calendar dates literally and reads EST_CLOSE_DATE as Bangkok wall-clock time', () => {
    expect(toDateOnly('2026-09-12 00:00:00')).toBe('2026-09-12');
    expect(toDateOnly('')).toBeNull();
    expect(toBangkokTimestamp('2026-09-12 06:20:02')).toBe('2026-09-11T23:20:02.000Z');
    expect(toBangkokTimestamp('2026-09-12T06:20:02Z')).toBe('2026-09-12T06:20:02.000Z');
    expect(toBangkokTimestamp('2026-09-12T06:20:02+07:00')).toBe('2026-09-11T23:20:02.000Z');
    expect(toBangkokTimestamp(null)).toBeNull();
  });

  it('skips incomplete rows, defaults the status, last row of a repeated round wins', () => {
    expect(mapErpOrderPeriods([
      { SUP_CODE: ' 316 ', ORDER_PERIOD: 12, DATE_FROM: '2026-10-01 00:00:00', DATE_TO: '2026-10-07', EST_CLOSE_DATE: '2026-09-28 17:00:00', STATUS: 'O' },
      { SUP_CODE: '316', ORDER_PERIOD: '13', DATE_FROM: '2026-10-08', DATE_TO: '2026-10-14' },
      { SUP_CODE: '316', ORDER_PERIOD: '12', DATE_FROM: '2026-10-01', DATE_TO: '2026-10-08', STATUS: 'O' },
      { SUP_CODE: '', ORDER_PERIOD: '1', DATE_FROM: '2026-10-01', DATE_TO: '2026-10-02' },
      { SUP_CODE: '400', ORDER_PERIOD: '1', DATE_FROM: '2026-10-01' },
      null,
    ])).toEqual([
      { sup_code: '316', erp_order_period: '12', date_from: '2026-10-01', date_to: '2026-10-08', close_at: null, status: 'O' },
      { sup_code: '316', erp_order_period: '13', date_from: '2026-10-08', date_to: '2026-10-14', close_at: null, status: 'N' },
    ]);
    expect(mapErpOrderPeriods({ SUP_CODE: '316' })).toEqual([]);
  });
});

describe('logistics fields (stage 4f)', () => {
  it('normalises delivery days to josh rows in week order; every day / none = null', () => {
    expect(normDeliveryDates('friday, monday')).toEqual([{ day: 'MONDAY' }, { day: 'FRIDAY' }]);
    expect(normDeliveryDates([{ day: 'TUESDAY' }, 'tuesday'])).toEqual([{ day: 'TUESDAY' }]);
    expect(normDeliveryDates(['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'].map((day) => ({ day })))).toBeNull();
    expect(normDeliveryDates('')).toBeNull();
    expect(() => normDeliveryDates('MON')).toThrow(BadRequestException);
  });

  it('splits the product form: logistics keys validated, the rest left alone', () => {
    expect(splitLogistics({ unit_ratio: ' 1:12 ', product_unit: '', expected_restock_at: '2026-11-01T00:00:00Z', delivery_dates: 'MONDAY', brand_name: 'X' })).toEqual({
      logistics: { unit_ratio: '1:12', product_unit: null, expected_restock_at: '2026-11-01T00:00:00.000Z', delivery_dates: [{ day: 'MONDAY' }] },
      rest: { brand_name: 'X' },
    });
    expect(() => splitLogistics({ expected_restock_at: 'soon' })).toThrow(BadRequestException);
    expect(() => splitLogistics({ sub_packing_unit: 'x'.repeat(51) })).toThrow(BadRequestException);
    expect(() => splitLogistics({ product_unit: { a: 1 } })).toThrow(BadRequestException);
  });

  it('reads a josh row the same way (import / parity)', () => {
    expect(logisticsFromJosh({ unit_ratio: '12', sub_packing_unit: null, product_unit: 'PC', expected_restock_at: new Date('2026-11-01T00:00:00Z'),
      delivery_dates: ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'].map((day) => ({ day })) })).toEqual({
      unit_ratio: '12', sub_packing_unit: null, product_unit: 'PC', expected_restock_at: '2026-11-01T00:00:00.000Z', delivery_dates: null,
    });
  });
});
