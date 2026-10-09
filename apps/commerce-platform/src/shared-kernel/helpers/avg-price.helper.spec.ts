import { computeAvgPrice } from './avg-price.helper';

function inv(overrides: {
  pack_size?: string | null;
  units_per_box?: string | null;
  weight_per_unit?: string | null;
  order_taking_unit?: string | null;
} = {}) {
  return {
    pack_size: null,
    units_per_box: null,
    weight_per_unit: null,
    order_taking_unit: null,
    ...overrides,
  };
}

describe('computeAvgPrice — docs/pricing-total-model.md example table (2026-09-25)', () => {
  it('CISNLN633441013 — 55 GM X 6 PC · otu BX (count unit, unchanged), 570 → 1727.27/KG', () => {
    const result = computeAvgPrice(
      570,
      inv({ pack_size: '55 GM X 6 PC', order_taking_unit: 'BX' }),
    );
    expect(result.avgPriceMin).toBeCloseTo(1727.27);
    expect(result.avgPriceMax).toBeCloseTo(1727.27);
    expect(result.avgPriceUnit).toBe('KG');
  });

  it('CIAMLN594040989R — 6 PC X 1 PK · otu PK (count unit, unchanged), 1440 → 240/PC (pure count pack)', () => {
    const result = computeAvgPrice(
      1440,
      inv({ pack_size: '6 PC X 1 PK', order_taking_unit: 'PK' }),
    );
    expect(result.avgPriceMin).toBe(240);
    expect(result.avgPriceMax).toBe(240);
    expect(result.avgPriceUnit).toBe('PC');
  });

  it('DRCHBA575920884 — 1.5 KG X 4 PC · BX, 3960 → 660/KG', () => {
    const result = computeAvgPrice(3960, inv({ pack_size: '1.5 KG X 4 PC' }));
    expect(result.avgPriceMin).toBe(660);
    expect(result.avgPriceMax).toBe(660);
    expect(result.avgPriceUnit).toBe('KG');
  });

  it('MTBFCRK401810878P5 — 0.17 KG X 24 PK · BX, 2407.20 → 590/KG', () => {
    const result = computeAvgPrice(2407.2, inv({ pack_size: '0.17 KG X 24 PK' }));
    expect(result.avgPriceMin).toBe(590);
    expect(result.avgPriceMax).toBe(590);
    expect(result.avgPriceUnit).toBe('KG');
  });

  it('DRCHUNI24320526 — 2.8 - 3 KG X 2 PC · BX, 3420 → 570/KG', () => {
    const result = computeAvgPrice(3420, inv({ pack_size: '2.8 - 3 KG X 2 PC' }));
    expect(result.avgPriceMin).toBe(570);
    expect(result.avgPriceMax).toBe(570);
    expect(result.avgPriceUnit).toBe('KG');
  });

  it('SFYUN603552489 — 2 - 2.5 KG X 1 PC · PC, 6750 → 2700/KG', () => {
    const result = computeAvgPrice(6750, inv({ pack_size: '2 - 2.5 KG X 1 PC' }));
    expect(result.avgPriceMin).toBe(2700);
    expect(result.avgPriceMax).toBe(2700);
    expect(result.avgPriceUnit).toBe('KG');
  });

  it('MTBJWG644921101 — 4.5 - 5.5 KG X 1 PC · PC, 14850 → 2700/KG', () => {
    const result = computeAvgPrice(14850, inv({ pack_size: '4.5 - 5.5 KG X 1 PC' }));
    expect(result.avgPriceMin).toBe(2700);
    expect(result.avgPriceMax).toBe(2700);
    expect(result.avgPriceUnit).toBe('KG');
  });

  it('SFLUNB34210851FZ — 16 - 20 PC X 3 KG · BX, 4500 → 1500/KG', () => {
    const result = computeAvgPrice(4500, inv({ pack_size: '16 - 20 PC X 3 KG' }));
    expect(result.avgPriceMin).toBe(1500);
    expect(result.avgPriceMax).toBe(1500);
    expect(result.avgPriceUnit).toBe('KG');
  });

  it('SFYCWT26852027 — langoustine box, 450 - 550 GM X 15 KG · otu KG, sell unit is the 15 KG pack, 30000 → 2000/KG (÷ pack total, not per-otu)', () => {
    const result = computeAvgPrice(
      30000,
      inv({ pack_size: '450 - 550 GM X 15 KG', order_taking_unit: 'KG' }),
    );
    expect(result.avgPriceMin).toBe(2000);
    expect(result.avgPriceMax).toBe(2000);
    expect(result.avgPriceUnit).toBe('KG');
  });

  it('SFLUNB26521055 — langoustine, 5 - 7 PC X 3 KG · otu KG, sell unit is the 3 KG bag — selling_price is per bag (7014, applyPriceChange(erp) factor 3), ÷ pack total → 2338/KG', () => {
    const result = computeAvgPrice(
      7014,
      inv({ pack_size: '5 - 7 PC X 3 KG', order_taking_unit: 'KG' }),
    );
    expect(result.avgPriceMin).toBe(2338);
    expect(result.avgPriceMax).toBe(2338);
    expect(result.avgPriceUnit).toBe('KG');
  });

  it('SFLCWT34720315 — live lobster, 800 - 900 GM X 15 KG · otu KG, sell unit is the 15 KG box — selling_price 36000 (factor 15) ÷ pack total → 2400/KG', () => {
    const result = computeAvgPrice(
      36000,
      inv({ pack_size: '800 - 900 GM X 15 KG', order_taking_unit: 'KG' }),
    );
    expect(result.avgPriceMin).toBe(2400);
    expect(result.avgPriceMax).toBe(2400);
    expect(result.avgPriceUnit).toBe('KG');
  });

  it('DRCHUNB732321635 — cheese, 5 - 5.2 KG X 1 PC · otu KG, sell unit is 1 PC (5.2 KG) — selling_price 11206 (factor 5.2) ÷ pack total → 2155/KG', () => {
    const result = computeAvgPrice(
      11206,
      inv({ pack_size: '5 - 5.2 KG X 1 PC', order_taking_unit: 'KG' }),
    );
    expect(result.avgPriceMin).toBe(2155);
    expect(result.avgPriceMax).toBe(2155);
    expect(result.avgPriceUnit).toBe('KG');
  });

  it('VBCUNB08120130 — truffle, 90 - 110 GM X 1 PK · otu GM, sell unit is 1 PK (110 GM) — selling_price 3520 (factor 110) ÷ pack total → 32000/KG', () => {
    const result = computeAvgPrice(
      3520,
      inv({ pack_size: '90 - 110 GM X 1 PK', order_taking_unit: 'GM' }),
    );
    expect(result.avgPriceMin).toBe(32000);
    expect(result.avgPriceMax).toBe(32000);
    expect(result.avgPriceUnit).toBe('KG');
  });

  it('VBCUNB08120130 variant — otu GR (not just GM), same sell-unit pack, 3520 → 32000/KG (GR normalizes like GM)', () => {
    const result = computeAvgPrice(
      3520,
      inv({ pack_size: '90 - 110 GM X 1 PK', order_taking_unit: 'GR' }),
    );
    expect(result.avgPriceMin).toBe(32000);
    expect(result.avgPriceMax).toBe(32000);
    expect(result.avgPriceUnit).toBe('KG');
  });

  it('padded order_taking_unit (" GM ") still hits the weight-unit rule, ×1000 not KG-as-is', () => {
    const result = computeAvgPrice(
      32,
      inv({ order_taking_unit: ' GM ' }),
    );
    expect(result.avgPriceMin).toBe(32000);
    expect(result.avgPriceMax).toBe(32000);
    expect(result.avgPriceUnit).toBe('KG');
  });

  it('SFYUNB688122639 — 35 - 45 PC X 1 KG · KG, 79 → 79/KG', () => {
    const result = computeAvgPrice(79, inv({ pack_size: '35 - 45 PC X 1 KG' }));
    expect(result.avgPriceMin).toBe(79);
    expect(result.avgPriceMax).toBe(79);
    expect(result.avgPriceUnit).toBe('KG');
  });

  it('falls back to units_per_box when pack_size is missing', () => {
    const result = computeAvgPrice(288, inv({ units_per_box: '48 PC' }));
    expect(result.avgPriceMin).toBe(6);
    expect(result.avgPriceMax).toBe(6);
    expect(result.avgPriceUnit).toBe('PC');
  });

  it('unparseable pack → null', () => {
    const result = computeAvgPrice(500, inv());
    expect(result.avgPriceMin).toBeNull();
    expect(result.avgPriceMax).toBeNull();
    expect(result.avgPriceUnit).toBeNull();
  });

  it('non-positive total → null', () => {
    expect(computeAvgPrice(0, inv({ pack_size: '1 KG X 1 PC' })).avgPriceMax).toBeNull();
    expect(computeAvgPrice(null, inv({ pack_size: '1 KG X 1 PC' })).avgPriceMax).toBeNull();
  });

  it('box of cans (245 ML X 24 CA) is never null — divides by the pack volume', () => {
    const result = computeAvgPrice(267.36, inv({ pack_size: '245 ML X 24 CA' }));
    expect(result.avgPriceMax).toBe(45.47);
    expect(result.avgPriceUnit).toBe('L');
  });
});
