import {
  sellUnitWeightRange,
  resolvePackTotalQty,
  resolveQuotationPrivateSellingPrice,
  resolveSellUnit,
} from './pack-order-price.helper';

describe('resolveSellUnit', () => {
  it('SFYCWT26852027 — 450 - 550 GM X 15 KG, otu KG → {KG, 15, 15}', () => {
    expect(
      resolveSellUnit({ order_taking_unit: 'KG', pack_size: '450 - 550 GM X 15 KG' }),
    ).toEqual({ unit: 'KG', qty: 15, factor: 15 });
  });

  it('SFLUNB26521055 — 5 - 7 PC X 3 KG, otu KG → {KG, 3, 3}', () => {
    expect(
      resolveSellUnit({ order_taking_unit: 'KG', pack_size: '5 - 7 PC X 3 KG' }),
    ).toEqual({ unit: 'KG', qty: 3, factor: 3 });
  });

  it('DRCHUNB732321635 — 5 - 5.2 KG X 1 PC, otu KG → {PC, 1, 5.2}', () => {
    expect(
      resolveSellUnit({ order_taking_unit: 'KG', pack_size: '5 - 5.2 KG X 1 PC' }),
    ).toEqual({ unit: 'PC', qty: 1, factor: 5.2 });
  });

  it('VBCUNB08120130 — 90 - 110 GM X 1 PK, otu GM → {PK, 1, 110}', () => {
    expect(
      resolveSellUnit({ order_taking_unit: 'GM', pack_size: '90 - 110 GM X 1 PK' }),
    ).toEqual({ unit: 'PK', qty: 1, factor: 110 });
  });

  it('SFFUNB31921188 — Fixed 3 KG X 1 BX, otu KG → {BX, 1, 3}', () => {
    expect(
      resolveSellUnit({ order_taking_unit: 'KG', pack_size: '3 KG X 1 BX' }),
    ).toEqual({ unit: 'BX', qty: 1, factor: 3 });
  });

  it('SFFUNB305421637 — 6 - 8 PC X 1 KG, otu KG → not really a pack → {KG, 1, 1}', () => {
    expect(
      resolveSellUnit({ order_taking_unit: 'KG', pack_size: '6 - 8 PC X 1 KG' }),
    ).toEqual({ unit: 'KG', qty: 1, factor: 1 });
  });

  it('SFYUNB675622569 — 0.30 - 0.40 KG X 10 PC, otu KG → {PC, 10, 4}', () => {
    expect(
      resolveSellUnit({ order_taking_unit: 'KG', pack_size: '0.30 - 0.40 KG X 10 PC' }),
    ).toEqual({ unit: 'PC', qty: 10, factor: 4 });
  });

  it('DRCHBA575920884 — otu BX (not weight/volume) → {BX, 1, 1} regardless of pack', () => {
    expect(
      resolveSellUnit({ order_taking_unit: 'BX', pack_size: '1.5 KG X 4 PC' }),
    ).toEqual({ unit: 'BX', qty: 1, factor: 1 });
  });

  it('no pack_size → {U, 1, 1}', () => {
    expect(resolveSellUnit({ order_taking_unit: 'KG', pack_size: null })).toEqual({
      unit: 'KG',
      qty: 1,
      factor: 1,
    });
  });

  it('SFJUNB699523305 — 0.02 - 0.04 KG X 1 PC, otu KG — pack SMALLER than 1 KG → not a sell unit → {KG, 1, 1}', () => {
    expect(
      resolveSellUnit({ order_taking_unit: 'KG', pack_size: '0.02 - 0.04 KG X 1 PC' }),
    ).toEqual({ unit: 'KG', qty: 1, factor: 1 });
  });

  it('SFLCWT34720708 — 0.40 - 0.50 KG X 1 PC, otu KG — pack still smaller than 1 KG → {KG, 1, 1} (stays ฿1,800/KG)', () => {
    expect(
      resolveSellUnit({ order_taking_unit: 'KG', pack_size: '0.40 - 0.50 KG X 1 PC' }),
    ).toEqual({ unit: 'KG', qty: 1, factor: 1 });
  });

  it('7.5 GM X 1 PK, otu GM — pack bigger than 1 GM → {PK, 1, 7.5}', () => {
    expect(
      resolveSellUnit({ order_taking_unit: 'GM', pack_size: '7.5 GM X 1 PK' }),
    ).toEqual({ unit: 'PK', qty: 1, factor: 7.5 });
  });

  it('473 ML X 1 BT, otu ML → {BT, 1, 473}', () => {
    expect(
      resolveSellUnit({ order_taking_unit: 'ML', pack_size: '473 ML X 1 BT' }),
    ).toEqual({ unit: 'BT', qty: 1, factor: 473 });
  });

  it('350 GM X 1 PK, otu GM → exactly {PK, 1, 350} — not float-noised (0.35/0.001)', () => {
    expect(
      resolveSellUnit({ order_taking_unit: 'GM', pack_size: '350 GM X 1 PK' }),
    ).toEqual({ unit: 'PK', qty: 1, factor: 350 });
  });

  it('missing inventory → {"", 1, 1}', () => {
    expect(resolveSellUnit(null)).toEqual({ unit: '', qty: 1, factor: 1 });
  });
});

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

describe('resolveQuotationPrivateSellingPrice', () => {
  it('shrimp otu KG, quotation unit KG, pack is a sell unit (3 KG bag) → RATE × sell-unit qty (SFLUNB26521055: 2338 → 7014)', () => {
    expect(
      resolveQuotationPrivateSellingPrice(
        { order_taking_unit: 'KG', selling_unit: 'KG', pack_size: '5 - 7 PC X 3 KG' },
        { unit: 'KG', rate: 2338, ordering_rate: null },
      ),
    ).toBe(7014);
  });

  it('lobster otu KG, quotation unit KG, pack is a sell unit (15 KG box) → RATE × sell-unit qty (SFLCWT34720315: 2400 → 36000)', () => {
    expect(
      resolveQuotationPrivateSellingPrice(
        { order_taking_unit: 'KG', selling_unit: 'KG', pack_size: '800 - 900 GM X 15 KG' },
        { unit: 'KG', rate: 2400, ordering_rate: null },
      ),
    ).toBe(36000);
  });

  it('otu PC, quotation already per-PC → RATE unchanged (DCCHBTR731120363R1)', () => {
    expect(
      resolveQuotationPrivateSellingPrice(
        { order_taking_unit: 'PC', selling_unit: 'KG', pack_size: '7 - 9 KG X 1 PC' },
        { unit: 'PC', rate: 31365, ordering_rate: null },
      ),
    ).toBe(31365);
  });

  it('otu PC, quotation per-KG → RATE × pack total (DCCHBTR731120363R1)', () => {
    expect(
      resolveQuotationPrivateSellingPrice(
        { order_taking_unit: 'PC', selling_unit: 'KG', pack_size: '7 - 9 KG X 1 PC' },
        { unit: 'KG', rate: 3485, ordering_rate: null },
      ),
    ).toBe(31365);
  });

  it('Fixed CT, quotation unit CT → RATE unchanged', () => {
    expect(
      resolveQuotationPrivateSellingPrice(
        { order_taking_unit: 'CT', selling_unit: 'CT' },
        { unit: 'CT', rate: 310.32, ordering_rate: null },
      ),
    ).toBe(310.32);
  });

  it('otu BX box of 24 × 1 KG, quotation per-KG → RATE × pack total (24)', () => {
    expect(
      resolveQuotationPrivateSellingPrice(
        {
          order_taking_unit: 'BX',
          selling_unit: 'KG',
          weight_per_unit: '1.00 KG',
          units_per_box: '24 PC',
        },
        { unit: 'KG', rate: 600, ordering_rate: null },
      ),
    ).toBe(14400);
  });

  it('quotation.unit missing → assumes the Josh order unit (no conversion)', () => {
    expect(
      resolveQuotationPrivateSellingPrice(
        { order_taking_unit: 'PC', selling_unit: 'KG', pack_size: '7 - 9 KG X 1 PC' },
        { unit: null, rate: 31365, ordering_rate: null },
      ),
    ).toBe(31365);
  });

  it('unit present, differs from Josh unit, no reliable factor (count ↔ count) → null, no guessed price', () => {
    expect(
      resolveQuotationPrivateSellingPrice(
        { order_taking_unit: 'BX', selling_unit: 'PC' },
        { unit: 'PC', rate: 1800, ordering_rate: null },
      ),
    ).toBeNull();
  });

  it('RATE missing/zero → null, never falls back to ORDERING_RATE (often box × pack)', () => {
    expect(
      resolveQuotationPrivateSellingPrice(
        { order_taking_unit: 'KG', selling_unit: 'KG' },
        { unit: 'KG', rate: 0, ordering_rate: 999 },
      ),
    ).toBeNull();
  });

  it('RATE and ORDERING_RATE both missing → null', () => {
    expect(
      resolveQuotationPrivateSellingPrice(
        { order_taking_unit: 'KG', selling_unit: 'KG' },
        { unit: 'KG', rate: 0, ordering_rate: 0 },
      ),
    ).toBeNull();
  });
});

describe('sellUnitWeightRange (cart น้ำหนักรวม per cart unit)', () => {
  const approx = (pack_size: string, order_taking_unit: string) =>
    sellUnitWeightRange({ packaging_type: 'Approx', pack_size, order_taking_unit });

  it('a count order unit weighs the whole pack, not one piece', () => {
    expect(approx('0.20 - 0.21 KG X 24 PC', 'BX')).toEqual({ min: 4.8, max: 5.04, unit: 'KG' });
    expect(approx('0.70 - 3.5 KG X 6 PC', 'BX')).toEqual({ min: 4.2, max: 21, unit: 'KG' });
    expect(approx('5 - 7 KG X 1 PC', 'PC')).toEqual({ min: 5, max: 7, unit: 'KG' });
  });

  it('a weight order unit: a pack sell unit weighs the pack, per-KG selling weighs 1 KG', () => {
    expect(approx('5 - 7 PC X 3 KG', 'KG')).toEqual({ min: 3, max: 3, unit: 'KG' });
    expect(approx('0.40 - 0.50 KG X 1 PC', 'KG')).toEqual({ min: 1, max: 1, unit: 'KG' });
  });

  it('Fixed SKUs have no weight range', () => {
    expect(sellUnitWeightRange({ packaging_type: 'Fixed', pack_size: '0.18 KG X 1 PC', order_taking_unit: 'PC' })).toBeNull();
  });
});
