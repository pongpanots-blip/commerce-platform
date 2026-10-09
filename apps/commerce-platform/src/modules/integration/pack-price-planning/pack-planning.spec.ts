import { comparePacks, inspectObservation, packInputsSchema, packPreviewSchema, packScenarioSchema, type PackInputs, type PackScenario } from './pack-price';
import { catalogPlanningPack } from './pack-inputs.service';

import {fixtureInputs,fixtureScenario} from './pack-fixtures';

describe('pack and sale-price comparison rules', () => {
  it('retains multiple vendors and public/member evidence without inventing a cheapest recommendation', () => {
    const inputs = fixtureInputs(), scenario = fixtureScenario(inputs), result = comparePacks(scenario, inputs);
    expect(result.observations.map(o => [o.quantity, o.pricePerBaseIncVat])).toEqual([['1', '100.000000'], ['2', '90.000000']]);
    expect(result.scenarios[0]).toMatchObject({ totalQuantity: '0.5', salePriceIncVat: '53.50', pricePerBaseIncVat: '107.000000', revenueExVat: '50.00', grossMarginPercent: null, markupPercent: null });
    expect(result.scenarios[0].comparisons).toEqual([
      { observationId: inputs.observations[0].id, priceBasis: 'public', differencePerBaseIncVat: '7.000000', differenceForPackIncVat: '3.50', differencePercent: '7.0000' },
      { observationId: inputs.observations[1].id, priceBasis: 'member', differencePerBaseIncVat: '17.000000', differenceForPackIncVat: '8.50', differencePercent: '18.8889' },
    ]);
    expect(inputs.observations[0].originalPack).toEqual({ unit: 'g', min: '250', max: '250', count: 4 });
    expect(packPreviewSchema.parse({ scenario, inputs, preview: result }).preview).toEqual(result);
    expect(result).not.toHaveProperty('recommendation');
  });
  it.each([
    ['mapping_unverified', { mapped: false }], ['pack_unavailable', { originalPack: { unit: null, min: null, max: null, count: 1 } }],
    ['pack_range', { originalPack: { unit: 'kg', min: '1', max: '2', count: 1 } }], ['unit_mismatch', { originalPack: { unit: 'l', min: '1', max: '1', count: 1 } }],
    ['currency_unavailable', { currency: null }], ['currency_fx_unsupported', { currency: 'USD' }], ['tax_unverified', { taxBasis: 'unverified' }],
    ['source_date_unavailable', { observedAt: null }], ['source_date_unavailable', { validUntil: null }], ['source_date_future', { observedAt: '2026-10-09T12:00:00.001Z' }],
    ['observation_stale', { validUntil: '2026-10-09T11:59:59.999Z' }], ['source_changed', { sourceCurrent: false }], ['source_failed', { sourceFailed: true }], ['price_unavailable', { priceIncVat: '0' }],
  ])('excludes %s without inventing a normalized price', (reason, override) => {
    const inputs = fixtureInputs(); Object.assign(inputs.observations[0], override);
    const result = comparePacks(fixtureScenario(inputs), inputs);
    expect(result.observations[0]).toMatchObject({ eligible: false, pricePerBaseIncVat: null }); expect(result.observations[0].reasons).toContain(reason);
    expect(result.scenarios[0].comparisons[0].differencePercent).toBeNull(); expect(result.observations[1].eligible).toBe(true);
  });
  it('unknown cost stays unknown even with competitor prices and additional assumptions', () => {
    const inputs = fixtureInputs(), result = comparePacks(fixtureScenario(inputs), inputs);
    for (const scenario of result.scenarios) expect(scenario).toMatchObject({ costExVat: null, grossProfitExVat: null, grossMarginPercent: null, markupPercent: null });
    expect(() => packInputsSchema.parse({ ...inputs, cost: { kind: 'competitor_observation' } })).toThrow();
    expect(() => packScenarioSchema.parse({ ...fixtureScenario(inputs), cost: '1.00' })).toThrow();
  });
  it('distinguishes margin on revenue from markup on authoritative cost and labels additional assumptions', () => {
    const inputs = fixtureInputs(); inputs.cost = { kind: 'authoritative_internal_unit_cost', sku: inputs.sku, unit: 'kg', currency: 'THB', unitCostExVat: '60.00', sourceId: 'internal-fixture-cost', effectiveFrom: '2026-10-09T00:00:00Z', effectiveUntil: '2026-10-10T00:00:00Z' };
    const result = comparePacks(fixtureScenario(inputs), inputs);
    expect(result.scenarios[0]).toMatchObject({ revenueExVat: '50.00', costExVat: '30.00', grossProfitExVat: '20.00', grossMarginPercent: '40.0000', markupPercent: '66.6667' });
    expect(result.scenarios[1]).toMatchObject({ revenueExVat: '180.00', costExVat: '122.00', grossProfitExVat: '58.00', grossMarginPercent: '32.2222', markupPercent: '47.5410' });
    inputs.cost.effectiveUntil = '2026-10-08T00:00:00Z'; expect(comparePacks(fixtureScenario(inputs), inputs).scenarios[0].grossMarginPercent).toBeNull();
  });
  it('keeps half-up decimal arithmetic exact, including zero-cost markup and negative profit', () => {
    const inputs = fixtureInputs(); inputs.product.vatRateBasisPoints = 0; inputs.cost = { kind: 'authoritative_internal_unit_cost', sku: inputs.sku, unit: 'kg', currency: 'THB', unitCostExVat: '0.10', sourceId: 'internal-fixture-cost', effectiveFrom: '2026-10-09T00:00:00Z', effectiveUntil: '2026-10-10T00:00:00Z' };
    const scenario = fixtureScenario(inputs); scenario.proposals = [{ label: 'Decimal case', pack: { unit: 'kg', quantity: '1', count: 1 }, salePriceIncVat: '0.30', additionalCostExVat: '0.20', assumption: 'Synthetic assumption' }];
    expect(comparePacks(scenario, inputs).scenarios[0]).toMatchObject({ costExVat: '0.30', grossProfitExVat: '0.00', grossMarginPercent: '0.0000' });
    inputs.cost.unitCostExVat = '0'; scenario.proposals[0].additionalCostExVat = '0'; expect(comparePacks(scenario, inputs).scenarios[0]).toMatchObject({ grossMarginPercent: '100.0000', markupPercent: null });
    inputs.cost.unitCostExVat = '1.00'; expect(comparePacks(scenario, inputs).scenarios[0]).toMatchObject({ grossProfitExVat: '-0.70', grossMarginPercent: '-233.3333', markupPercent: '-70.0000' });
  });
  it('requires known own unit/tax and forbids duplicate, unlabelled, fractional-piece and foreign evidence intents', () => {
    const inputs = fixtureInputs(), scenario = fixtureScenario(inputs); inputs.product.basis = null;
    expect(comparePacks(scenario, inputs).scenarios[0].comparisons[0].differencePercent).toBeNull(); inputs.product.basis = { unit: 'kg', quantity: '1', count: 1 }; inputs.product.vatRateBasisPoints = null;
    expect(comparePacks(scenario, inputs).observations[0].reasons).toContain('product_tax_unavailable');
    expect(() => comparePacks({ ...scenario, sourceFingerprint: 'b'.repeat(64) }, inputs)).toThrow();
    expect(() => packScenarioSchema.parse({ ...scenario, observationIds: [scenario.observationIds[0], scenario.observationIds[0]] })).toThrow();
    expect(() => packScenarioSchema.parse({ ...scenario, proposals: [{ ...scenario.proposals[1], assumption: '' }] })).toThrow();
    expect(() => packScenarioSchema.parse({ ...scenario, proposals: [{ ...scenario.proposals[0], pack: { unit: 'piece', quantity: '1.5', count: 1 } }] })).toThrow();
    expect(() => comparePacks({ ...scenario, observationIds: ['00000000-0000-4000-8000-000000000099'] }, inputs)).toThrow();
  });
  it('does not infer pack dimensions from unknown labels or midpoint of a range', () => {
    expect(catalogPlanningPack('PK', '250 ML × 24', 'fixed')).toEqual({ unit: 'ml', quantity: '250', count: 24 });
    expect(catalogPlanningPack('PK', '1–2 KG', 'fixed')).toBeNull(); expect(catalogPlanningPack('PK', null, 'fixed')).toBeNull();
    expect(catalogPlanningPack('PK', '1 KG', 'Approx')).toBeNull(); expect(catalogPlanningPack('KG', null, 'Approx')).toEqual({ unit: 'kg', quantity: '1', count: 1 });
  });
  it('rejects a claimed success or tampered comparison result', () => {
    const inputs = fixtureInputs(), scenario = fixtureScenario(inputs), preview = comparePacks(scenario, inputs);
    expect(() => packPreviewSchema.parse({ scenario, inputs, preview: { ...preview, persisted: true } })).toThrow();
    const tampered = JSON.parse(JSON.stringify(preview)); tampered.scenarios[0].comparisons[0].differencePercent = '999.0000';
    expect(() => packPreviewSchema.parse({ scenario, inputs, preview: tampered })).toThrow();
  });
});
