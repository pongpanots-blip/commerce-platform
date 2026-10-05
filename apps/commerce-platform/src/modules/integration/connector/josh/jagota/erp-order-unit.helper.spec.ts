import {
  normalizeErpOrderingUnits,
  resolveErpOrderLine,
  resolveErpOrderUnit,
} from './erp-order-unit.helper';

describe('normalizeErpOrderingUnits', () => {
  it('extracts UNIT_CODE from phase-two ORDERING_OPTIONS', () => {
    expect(
      normalizeErpOrderingUnits([
        { UNIT_CODE: 'PC', UNIT_PRICE: '71.2', UNIT_QTY: '0.80 KG', UNIT_TYPE: 'OU' },
        { UNIT_CODE: ' kg ' },
        { UNIT_CODE: 'PC' },
        { UNIT_CODE: null },
      ]),
    ).toEqual(['PC', 'KG']);
  });

  it('returns null when ERP omitted the array', () => {
    expect(normalizeErpOrderingUnits(undefined)).toBeNull();
    expect(normalizeErpOrderingUnits('PC')).toBeNull();
  });
});

describe('resolveErpOrderUnit', () => {
  it('order-taking: ORDER_TAKING_UNIT when ERP lists it (pumpkin: sells KG, orders PC)', () => {
    expect(
      resolveErpOrderUnit({
        order_taking_flag: 'Y',
        order_taking_unit: 'PC',
        selling_unit: 'KG',
        erp_ordering_units: ['PC'],
      }),
    ).toBe('PC');
  });

  it('stock: selling_unit is not a UNIT_SELLING row → first unit ERP accepts', () => {
    expect(
      resolveErpOrderUnit({
        order_taking_flag: 'N',
        order_taking_unit: null,
        selling_unit: 'KG',
        erp_ordering_units: ['BX', 'PC'],
      }),
    ).toBe('BX');
  });

  it('stock: keeps selling_unit when ERP lists it', () => {
    expect(
      resolveErpOrderUnit({
        order_taking_flag: 'N',
        selling_unit: 'kg',
        erp_ordering_units: ['BX', 'KG'],
      }),
    ).toBe('KG');
  });

  it('legacy fallback when erp_ordering_units never synced', () => {
    expect(
      resolveErpOrderUnit({
        order_taking_flag: 'Y',
        order_taking_unit: null,
        selling_unit: 'KG',
        erp_ordering_units: null,
      }),
    ).toBe('KG');
    expect(resolveErpOrderUnit(null)).toBe('');
  });
});

describe('resolveErpOrderLine', () => {
  const lobster = {
    order_taking_flag: 'Y',
    order_taking_unit: 'KG',
    selling_unit: 'KG',
    erp_ordering_units: ['KG'],
    packaging_type: 'Approx',
    pack_size: '800 - 900 GM X 15 KG',
    units_per_box: '15 KG',
    weight_per_unit: '900.00 GM',
  };

  it('Approx + KG: 1 pack @ 36000 → P_QTY 15 KG, P_RATE 2400/KG', () => {
    expect(resolveErpOrderLine(lobster, { quantity: 1, unitPrice: 36000 })).toEqual({
      unit: 'KG',
      qty: 15,
      rate: 2400,
    });
    expect(resolveErpOrderLine(lobster, { quantity: 2, unitPrice: 36000 })).toEqual({
      unit: 'KG',
      qty: 30,
      rate: 2400,
    });
  });

  it('Approx but ERP orders in PC (pumpkin) → pass through', () => {
    const pumpkin = {
      ...lobster,
      order_taking_unit: 'PC',
      erp_ordering_units: ['PC'],
      pack_size: '0.50 - 0.80 KG X 1 PC',
      units_per_box: '1 PC',
      weight_per_unit: '0.80 KG',
    };
    expect(resolveErpOrderLine(pumpkin, { quantity: 3, unitPrice: 71.2 })).toEqual({
      unit: 'PC',
      qty: 3,
      rate: 71.2,
    });
  });

  it('Fixed pack → pass through', () => {
    expect(
      resolveErpOrderLine(
        { ...lobster, packaging_type: 'Fixed' },
        { quantity: 1, unitPrice: 36000 },
      ),
    ).toEqual({ unit: 'KG', qty: 1, rate: 36000 });
  });

  it('missing inventory → pass through with empty unit', () => {
    expect(resolveErpOrderLine(null, { quantity: 2, unitPrice: 10 })).toEqual({
      unit: '',
      qty: 2,
      rate: 10,
    });
  });
});
