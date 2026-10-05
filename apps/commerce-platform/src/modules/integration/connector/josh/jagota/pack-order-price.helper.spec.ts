import {
  normalizeApproxPerKgRate,
  resolveApproxOrderUnitPrice,
  resolveCatalogOrderingPrice,
  resolvePackTotalQty,
  resolveQuotationPrivateSellingPrice,
} from './pack-order-price.helper';

describe('resolvePackTotalQty — all major pack_size templates', () => {
  it('Approx KG × N PC — total = max kg × piece count', () => {
    expect(
      resolvePackTotalQty({ pack_size: '0.60 - 2.5 KG X 9 PC' }),
    ).toEqual({ min: 5.4, max: 22.5, unit: 'KG' });
    expect(
      resolvePackTotalQty({ pack_size: '7 - 12 KG X 2 PC' }),
    ).toEqual({ min: 14, max: 24, unit: 'KG' });
  });

  it('Approx KG × N BX / PK — count multiplier', () => {
    expect(
      resolvePackTotalQty({ pack_size: '0.20 - 0.40 KG X 1 BX' }),
    ).toEqual({ min: 0.2, max: 0.4, unit: 'KG' });
    expect(
      resolvePackTotalQty({ pack_size: '0.15 - 0.17 KG X 24 PK' }),
    ).toEqual({ min: 3.6, max: 4.08, unit: 'KG' });
  });

  it('Approx KG × N KG — second side is pack total weight', () => {
    expect(
      resolvePackTotalQty({ pack_size: '0.10 - 2 KG X 20 KG' }),
    ).toEqual({ min: 20, max: 20, unit: 'KG' });
  });

  it('Approx PC × N KG — weight side wins', () => {
    expect(
      resolvePackTotalQty({ pack_size: '1 - 2 PC X 1 KG' }),
    ).toEqual({ min: 1, max: 1, unit: 'KG' });
  });

  it('Approx GM × N KG — both weight, right wins', () => {
    expect(
      resolvePackTotalQty({ pack_size: '100 - 300 GM X 6 KG' }),
    ).toEqual({ min: 6, max: 6, unit: 'KG' });
  });

  it('Approx GM × N PC — gm × count → KG', () => {
    expect(
      resolvePackTotalQty({ pack_size: '170 - 220 GM X 3 PC' }),
    ).toEqual({ min: 0.51, max: 0.66, unit: 'KG' });
  });

  it('Fixed / single-value ML × N PC — e.g. 473 ML X 8 PC → litres', () => {
    expect(
      resolvePackTotalQty({ pack_size: '473 ML X 8 PC' }),
    ).toEqual({ min: 3.78, max: 3.78, unit: 'L' });
  });

  it('Fixed LT × N PC', () => {
    expect(
      resolvePackTotalQty({ pack_size: '1 LT X 12 PC' }),
    ).toEqual({ min: 12, max: 12, unit: 'L' });
  });

  it('Fixed GM × N PC', () => {
    expect(
      resolvePackTotalQty({ pack_size: '100 GM X 10 PC' }),
    ).toEqual({ min: 1, max: 1, unit: 'KG' });
  });

  it('count × count → null (no weight/volume total)', () => {
    expect(resolvePackTotalQty({ pack_size: '1 PC X 1 BX' })).toBeNull();
    expect(resolvePackTotalQty({ pack_size: '10 PC X 1 PK' })).toBeNull();
  });

  it('broken range missing bound → null', () => {
    expect(resolvePackTotalQty({ pack_size: '10 -  KG X 1 BX' })).toBeNull();
  });

  it('falls back to weight_per_unit × units_per_box', () => {
    expect(
      resolvePackTotalQty({
        pack_size: null,
        weight_per_unit: '2.50 KG',
        units_per_box: '9 PC',
      }),
    ).toEqual({ min: 22.5, max: 22.5, unit: 'KG' });
  });

  it('fallback ML × units_per_box', () => {
    expect(
      resolvePackTotalQty({
        pack_size: null,
        weight_per_unit: '473.00 ML',
        units_per_box: '8 PC',
      }),
    ).toEqual({ min: 3.78, max: 3.78, unit: 'L' });
  });
});

describe('resolveApproxOrderUnitPrice', () => {
  it('MTBFMAG718611915 — cart uses ERP ordering 22950, per-kg 1020', () => {
    const result = resolveApproxOrderUnitPrice({
      packaging_type: 'Approx',
      selling_unit: 'KG',
      selling_unit_price: 1020,
      ordering_price: 22950,
      pack_size: '0.60 - 2.5 KG X 9 PC',
      units_per_box: '9 PC',
      weight_per_unit: '2.50 KG',
    });
    expect(result.orderUnitPrice).toBe(22950);
    expect(result.perKgRate).toBe(1020);
    expect(result.packTotalMax).toBe(22.5);
    expect(result.usedOrdering).toBe(true);
  });

  it('MTBFMAG718611927 — ordering 17280 = 720 × 24 kg', () => {
    const result = resolveApproxOrderUnitPrice({
      packaging_type: 'Approx',
      selling_unit: 'KG',
      selling_unit_price: 720,
      ordering_price: 17280,
      pack_size: '7 - 12 KG X 2 PC',
    });
    expect(result.orderUnitPrice).toBe(17280);
    expect(result.perKgRate).toBe(720);
    expect(result.packTotalMax).toBe(24);
  });

  it('KG × N KG pack — ordering = sell × total kg side', () => {
    const result = resolveApproxOrderUnitPrice({
      packaging_type: 'Approx',
      selling_unit: 'KG',
      selling_unit_price: 780,
      ordering_price: 15600,
      pack_size: '0.10 - 2 KG X 20 KG',
    });
    expect(result.orderUnitPrice).toBe(15600);
    expect(result.perKgRate).toBe(780);
    expect(result.packTotalMax).toBe(20);
  });

  it('GM × KG Approx — ordering uses pack total kg', () => {
    const result = resolveApproxOrderUnitPrice({
      packaging_type: 'Approx',
      selling_unit: 'KG',
      selling_unit_price: 300,
      ordering_price: 1800,
      pack_size: '100 - 300 GM X 6 KG',
    });
    expect(result.orderUnitPrice).toBe(1800);
    expect(result.packTotalMax).toBe(6);
  });

  it('customer per-kg recomputes box — does not keep catalog ordering', () => {
    const result = resolveApproxOrderUnitPrice({
      packaging_type: 'Approx',
      selling_unit: 'KG',
      selling_unit_price: 1020,
      ordering_price: 22950,
      resolved_per_kg: 90,
      pack_size: '0.60 - 2.5 KG X 9 PC',
    });
    expect(result.orderUnitPrice).toBe(2025); // 90 × 22.5
    expect(result.perKgRate).toBe(90);
    expect(result.usedOrdering).toBe(false);
  });

  it('promotion_mechanic per-kg (resolved) × pack total', () => {
    const result = resolveApproxOrderUnitPrice({
      packaging_type: 'Approx',
      selling_unit: 'KG',
      selling_unit_price: 720,
      ordering_price: 17280,
      resolved_per_kg: 90,
      pack_size: '7 - 12 KG X 2 PC',
    });
    expect(result.orderUnitPrice).toBe(2160);
    expect(result.usedOrdering).toBe(false);
  });

  it('does not multiply pack when special is already the catalog box', () => {
    const result = resolveApproxOrderUnitPrice({
      packaging_type: 'Approx',
      selling_unit: 'KG',
      selling_unit_price: 750,
      ordering_price: 4875,
      resolved_per_kg: 4875,
      pack_size: '5.5 - 6.5 KG X 1 PC',
    });
    expect(result.orderUnitPrice).toBe(4875);
    expect(result.perKgRate).toBe(750);
    expect(result.usedOrdering).toBe(true);
  });

  it('does not multiply pack twice when special is box × pack', () => {
    const result = resolveApproxOrderUnitPrice({
      packaging_type: 'Approx',
      selling_unit: 'KG',
      selling_unit_price: 750,
      ordering_price: 4875,
      resolved_per_kg: 31687.5,
      pack_size: '5.5 - 6.5 KG X 1 PC',
    });
    expect(result.orderUnitPrice).toBe(4875);
    expect(result.perKgRate).toBe(750);
    expect(result.usedOrdering).toBe(true);
  });

  it('keeps a real per-kg special (760 vs catalog 750)', () => {
    const result = resolveApproxOrderUnitPrice({
      packaging_type: 'Approx',
      selling_unit: 'KG',
      selling_unit_price: 750,
      ordering_price: 4875,
      resolved_per_kg: 760,
      pack_size: '5.5 - 6.5 KG X 1 PC',
    });
    expect(result.orderUnitPrice).toBe(4940);
    expect(result.perKgRate).toBe(760);
    expect(result.usedOrdering).toBe(false);
  });

  it('Fixed 473 ML X 8 PC — no pack cal (ERP selling used by cart)', () => {
    expect(
      resolveApproxOrderUnitPrice({
        packaging_type: 'Fixed',
        selling_unit: 'BX',
        selling_unit_price: 2340,
        ordering_price: null,
        pack_size: '473 ML X 8 PC',
      }).orderUnitPrice,
    ).toBeNull();
  });

  it('returns empty for Fixed packaging', () => {
    expect(
      resolveApproxOrderUnitPrice({
        packaging_type: 'Fixed',
        selling_unit: 'KG',
        selling_unit_price: 100,
        ordering_price: 800,
        pack_size: '5 - 8 KG X 1 PC',
      }).orderUnitPrice,
    ).toBeNull();
  });
});

describe('resolveCatalogOrderingPrice', () => {
  it('keeps stored ERP PRICE', () => {
    expect(
      resolveCatalogOrderingPrice({
        packaging_type: 'Approx',
        selling_unit: 'KG',
        selling_unit_price: 360,
        ordering_price: 8514,
        pack_size: '4 - 4.73 KG X 5 PC',
      }),
    ).toBe(8514);
  });

  it('Approx null ordering → selling × pack_total_max', () => {
    expect(
      resolveCatalogOrderingPrice({
        packaging_type: 'Approx',
        selling_unit: 'KG',
        selling_unit_price: 360,
        ordering_price: null,
        pack_size: '4 - 4.73 KG X 5 PC',
      }),
    ).toBe(8514);
  });

  it('Fixed null ordering → selling_unit_price', () => {
    expect(
      resolveCatalogOrderingPrice({
        packaging_type: 'Fixed',
        selling_unit: 'BX',
        selling_unit_price: 2600,
        ordering_price: null,
        pack_size: '2 PC',
      }),
    ).toBe(2600);
  });

  it('Approx sold per CT, null ordering → selling_unit_price (SFSUN489912364)', () => {
    expect(
      resolveCatalogOrderingPrice({
        packaging_type: 'Approx',
        selling_unit: 'CT',
        selling_unit_price: 2400,
        ordering_price: null,
        pack_size: '600 - 800 GM X 10 KG',
      }),
    ).toBe(2400);
  });

  it('Approx without parseable pack → null', () => {
    expect(
      resolveCatalogOrderingPrice({
        packaging_type: 'Approx',
        selling_unit: 'KG',
        selling_unit_price: 360,
        ordering_price: null,
        pack_size: null,
      }),
    ).toBeNull();
  });
});

describe('normalizeApproxPerKgRate', () => {
  it('leaves a real per-kg special', () => {
    expect(
      normalizeApproxPerKgRate({
        selling_unit_price: 750,
        ordering_price: 4875,
        resolved: 760,
        packTotalMax: 6.5,
      }),
    ).toBe(760);
  });

  it('divides catalog box by pack', () => {
    expect(
      normalizeApproxPerKgRate({
        selling_unit_price: 750,
        ordering_price: 4875,
        resolved: 4875,
        packTotalMax: 6.5,
      }),
    ).toBe(750);
  });

  it('divides box × pack twice', () => {
    expect(
      normalizeApproxPerKgRate({
        selling_unit_price: 750,
        ordering_price: 4875,
        resolved: 31687.5,
        packTotalMax: 6.5,
      }),
    ).toBe(750);
  });
});

describe('resolveQuotationPrivateSellingPrice', () => {
  const carrara = {
    packaging_type: 'Approx',
    selling_unit: 'KG',
    selling_unit_price: 750,
    ordering_price: 4875,
    pack_size: '5.5 - 6.5 KG X 1 PC',
  };

  it('Approx prefers RATE box over inflated ORDERING_RATE → per-kg', () => {
    expect(
      resolveQuotationPrivateSellingPrice(carrara, {
        rate: 4875,
        ordering_rate: 31687.5,
      }),
    ).toBe(750);
  });

  it('Approx with only inflated ORDERING_RATE → per-kg', () => {
    expect(
      resolveQuotationPrivateSellingPrice(carrara, {
        rate: 0,
        ordering_rate: 31687.5,
      }),
    ).toBe(750);
  });

  it('Fixed keeps RATE as-is', () => {
    expect(
      resolveQuotationPrivateSellingPrice(
        {
          packaging_type: 'Fixed',
          selling_unit: 'BX',
          selling_unit_price: 2340,
          ordering_price: 2340,
          pack_size: '473 ML X 8 PC',
        },
        { rate: 2340, ordering_rate: 2340 },
      ),
    ).toBe(2340);
  });
});
