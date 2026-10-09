// Synthetic test fixtures only; never imported by application code.
import {packInputsSchema,type PackInputs,type PackScenario} from './pack-price';
export const fixtureInputs = (): PackInputs => packInputsSchema.parse({ schemaVersion: 1, sku: 'SYNTHETIC-SKU', capturedAt: '2026-10-09T12:00:00.000Z', sourceFingerprint: 'a'.repeat(64), upstreamFreshness: 'unverified',
  product: { id: '00000000-0000-4000-8000-000000000001', sku: 'SYNTHETIC-SKU', name: 'Synthetic product', sellingUnit: 'PK', packText: '1 KG', packagingType: 'fixed', basis: { unit: 'kg', quantity: '1', count: 1 }, currentPriceIncVat: '107.00', currency: 'THB', vatRateBasisPoints: 700, sourceAsOf: null, sourceVersion: null },
  cost: null, observationsTruncated: false, operationalWrites: false, activationAllowed: false,
  observations: [
    { id: '00000000-0000-4000-8000-000000000002', revision: 1, vendor: 'Vendor A', productName: 'Pack A', originalPack: { unit: 'g', min: '250', max: '250', count: 4 }, priceIncVat: '100.00', currency: 'THB', taxBasis: 'inclusive', priceBasis: 'public', observedAt: '2026-10-09T11:00:00.000Z', validUntil: '2026-10-10T11:00:00.000Z', mapped: true, sourceCurrent: true, sourceFailed: false },
    { id: '00000000-0000-4000-8000-000000000003', revision: 1, vendor: 'Vendor B', productName: 'Pack B', originalPack: { unit: 'kg', min: '2', max: '2', count: 1 }, priceIncVat: '180.00', currency: 'THB', taxBasis: 'inclusive', priceBasis: 'member', observedAt: '2026-10-09T11:00:00.000Z', validUntil: '2026-10-10T11:00:00.000Z', mapped: true, sourceCurrent: true, sourceFailed: false },
  ] });
export const fixtureScenario = (inputs = fixtureInputs()): PackScenario => ({ kind: 'pack_price', name: 'Synthetic plan', sku: inputs.sku, sourceFingerprint: inputs.sourceFingerprint, observationIds: inputs.observations.map(o => o.id),
  proposals: [{ label: 'Small pack', pack: { unit: 'g', quantity: '500', count: 1 }, salePriceIncVat: '53.50', additionalCostExVat: '0', assumption: '' }, { label: 'Large pack', pack: { unit: 'kg', quantity: '2', count: 1 }, salePriceIncVat: '192.60', additionalCostExVat: '2', assumption: 'Assumed packaging per pack, ex VAT' }] });
