import { z } from 'zod';

export const PACK_HOME = '/planning/pack-prices';
export const PACK_API = '/reports/pack-price-planning';
export const packRoles = ['admin', 'marketing', 'business_analyst'] as const;
export const canSavePack = (role: string) => role === 'admin' || role === 'marketing';
export const uuid = z.uuid().transform(v => v.toLowerCase());
const instant = z.iso.datetime({ offset: true });
const rawDecimal = z.string().max(40).nullable();
const amount = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
const positiveAmount = amount.refine(v => Number(v) > 0);
const quantity = z.string().regex(/^\d{1,7}(\.\d{1,4})?$/).refine(v => Number(v) > 0 && Number(v) <= 1000000);
export const baseUnit = z.enum(['kg', 'l', 'piece']);
export const packSchema = z.object({ unit: z.enum(['kg', 'g', 'l', 'ml', 'piece']), quantity, count: z.number().int().min(1).max(1000) }).strict().superRefine((v, c) => {
  if (v.unit === 'piece' && !Number.isInteger(Number(v.quantity))) c.addIssue({ code: 'custom', path: ['quantity'], message: 'Pieces must be whole' });
});
export const proposalSchema = z.object({ label: z.string().trim().min(1).max(60), pack: packSchema, salePriceIncVat: positiveAmount,
  additionalCostExVat: amount, assumption: z.string().trim().max(120) }).strict().superRefine((v, c) => {
  if (Number(v.additionalCostExVat) > 0 && !v.assumption) c.addIssue({ code: 'custom', path: ['assumption'], message: 'Label the additional cost assumption' });
});
export const packScenarioSchema = z.object({ kind: z.literal('pack_price'), name: z.string().trim().min(1).max(120), sku: z.string().trim().min(1).max(100).regex(/^[^\x00-\x1f\x7f]+$/),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/), observationIds: z.array(uuid).max(20), proposals: z.array(proposalSchema).min(1).max(6) }).strict().superRefine((v, c) => {
  if (new Set(v.observationIds).size !== v.observationIds.length) c.addIssue({ code: 'custom', path: ['observationIds'], message: 'Duplicate observation' });
  const labels = new Set<string>(); v.proposals.forEach((p, index) => { if (labels.has(p.label)) c.addIssue({ code: 'custom', path: ['proposals', index, 'label'], message: 'Option names must differ' }); labels.add(p.label); });
});
export type PackScenario = z.infer<typeof packScenarioSchema>;
const internalCostSchema = z.object({ kind: z.literal('authoritative_internal_unit_cost'), sku: z.string(), unit: baseUnit, currency: z.literal('THB'), unitCostExVat: amount,
  sourceId: z.string().min(1), effectiveFrom: instant, effectiveUntil: instant }).strict();
export const observationSchema = z.object({ id: uuid, revision: z.number().int().positive(), vendor: z.string().min(1).max(500), productName: z.string().min(1).max(500),
  originalPack: z.object({ unit: z.string().max(16).nullable(), min: rawDecimal, max: rawDecimal, count: z.number().int().min(1).max(1000) }),
  priceIncVat: rawDecimal, currency: z.string().max(8).nullable(), taxBasis: z.enum(['inclusive', 'unverified']), priceBasis: z.enum(['public', 'member']),
  observedAt: z.string().max(64).nullable(), validUntil: z.string().max(64).nullable(), mapped: z.boolean(), sourceCurrent: z.boolean(), sourceFailed: z.boolean() }).strict();
export type PackObservation = z.infer<typeof observationSchema>;
export const packInputsSchema = z.object({ schemaVersion: z.literal(1), sku: z.string().min(1), capturedAt: instant, sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/), upstreamFreshness: z.literal('unverified'),
  product: z.object({ id: uuid, sku: z.string(), name: z.string(), sellingUnit: z.string().nullable(), packText: z.string().nullable(), packagingType: z.string().nullable(),
    basis: packSchema.nullable(), currentPriceIncVat: rawDecimal, currency: z.literal('THB'), vatRateBasisPoints: z.number().int().min(0).max(10000).nullable(), sourceAsOf: instant.nullable(), sourceVersion: z.string().nullable() }),
  cost: internalCostSchema.nullable(), observations: z.array(observationSchema).max(200), observationsTruncated: z.boolean(), operationalWrites: z.literal(false), activationAllowed: z.literal(false)
}).superRefine((v, c) => { if (v.sku !== v.product.sku || new Set(v.observations.map(o => o.id)).size !== v.observations.length) c.addIssue({ code: 'custom', message: 'Invalid product or observation identity' }); });
export type PackInputs = z.infer<typeof packInputsSchema>;

// Rational decimal arithmetic: no binary-float price, quantity, profit or percentage calculations.
type Rational = { n: bigint; d: bigint };
const B = BigInt;
const rat = (n: bigint, d = B(1)): Rational => ({ n, d });
const mul = (a: Rational, b: Rational) => rat(a.n * b.n, a.d * b.d);
const div = (a: Rational, b: Rational) => { if (b.n === B(0)) throw Error('Zero denominator'); return rat(a.n * b.d, a.d * b.n); };
const add = (a: Rational, b: Rational) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational) => add(a, rat(-b.n, b.d));
const scaleFor = (places: number) => B('1' + '0'.repeat(places));
function decimal(v: string): Rational { const [whole, fraction = ''] = v.split('.'); return rat(B(whole + fraction), scaleFor(fraction.length)); }
function rounded(v: Rational, places: number) {
  const scale = scaleFor(places), negative = v.n < B(0), n = (negative ? -v.n : v.n) * scale;
  const value = (n * B(2) + v.d) / (v.d * B(2)), digits = value.toString().padStart(places + 1, '0');
  return (negative && value !== B(0) ? '-' : '') + (places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits);
}
const trimmed = (v: Rational) => rounded(v, 7).replace(/\.?0+$/, '') || '0';
function normalized(pack: z.infer<typeof packSchema>) {
  const unit = pack.unit === 'g' ? 'kg' : pack.unit === 'ml' ? 'l' : pack.unit;
  const factor = ['g', 'ml'].includes(pack.unit) ? rat(B(1), B(1000)) : rat(B(1));
  return { unit, total: mul(mul(decimal(pack.quantity), factor), rat(B(pack.count))) };
}
export type Exclusion = 'mapping_unverified' | 'pack_unavailable' | 'pack_range' | 'unit_mismatch' | 'price_unavailable' | 'currency_unavailable' | 'currency_fx_unsupported' | 'tax_unverified' | 'source_date_unavailable' | 'source_date_future' | 'observation_stale' | 'source_changed' | 'source_failed' | 'product_basis_unavailable' | 'product_tax_unavailable';
export function inspectObservation(o: PackObservation, inputs: PackInputs, at = inputs.capturedAt) {
  const reasons: Exclusion[] = [];
  const own = inputs.product.basis ? normalized(inputs.product.basis) : null;
  if (!own) reasons.push('product_basis_unavailable');
  if (inputs.product.vatRateBasisPoints === null) reasons.push('product_tax_unavailable');
  if (!o.mapped) reasons.push('mapping_unverified');
  const pack = packSchema.safeParse({ unit: o.originalPack.unit, quantity: o.originalPack.min, count: o.originalPack.count });
  let size: ReturnType<typeof normalized> | null = null;
  if (!pack.success || o.originalPack.max === null || !quantity.safeParse(o.originalPack.max).success) reasons.push('pack_unavailable');
  else if (decimal(o.originalPack.min!).n * decimal(o.originalPack.max).d !== decimal(o.originalPack.max).n * decimal(o.originalPack.min!).d) reasons.push('pack_range');
  else size = normalized(pack.data);
  if (own && size && own.unit !== size.unit) reasons.push('unit_mismatch');
  if (!positiveAmount.safeParse(o.priceIncVat).success) reasons.push('price_unavailable');
  if (!o.currency) reasons.push('currency_unavailable'); else if (o.currency !== 'THB') reasons.push('currency_fx_unsupported');
  if (o.taxBasis !== 'inclusive') reasons.push('tax_unverified');
  const observed = o.observedAt ? Date.parse(o.observedAt) : NaN, until = o.validUntil ? Date.parse(o.validUntil) : NaN, now = Date.parse(at);
  if (!Number.isFinite(observed) || !Number.isFinite(until) || until < observed) reasons.push('source_date_unavailable');
  else if (observed > now) reasons.push('source_date_future'); else if (until < now) reasons.push('observation_stale');
  if (!o.sourceCurrent) reasons.push('source_changed');
  if (o.sourceFailed) reasons.push('source_failed');
  const rate = !reasons.length && size ? div(decimal(o.priceIncVat!), size.total) : null;
  return { id: o.id, eligible: reasons.length === 0, reasons, unit: size?.unit ?? null, quantity: size ? trimmed(size.total) : null, pricePerBaseIncVat: rate ? rounded(rate, 6) : null };
}
export function comparePacks(rawScenario: unknown, rawInputs: unknown) {
  const scenario = packScenarioSchema.parse(rawScenario), inputs = packInputsSchema.parse(rawInputs);
  if (scenario.sku !== inputs.sku || scenario.sourceFingerprint !== inputs.sourceFingerprint || scenario.observationIds.some(id => !inputs.observations.some(o => o.id === id))) throw Error('Planning source identity changed');
  const observations = inputs.observations.filter(o => scenario.observationIds.includes(o.id));
  const inspected = observations.map(o => inspectObservation(o, inputs));
  const own = inputs.product.basis ? normalized(inputs.product.basis) : null;
  const scenarios = scenario.proposals.map(p => {
    const size = normalized(p.pack), price = decimal(p.salePriceIncVat);
    const issues: Exclusion[] = !own ? ['product_basis_unavailable'] : size.unit !== own.unit ? ['unit_mismatch'] : [];
    if (inputs.product.vatRateBasisPoints === null) issues.push('product_tax_unavailable');
    const rate = div(price, size.total);
    const comparisons = observations.map((o, i) => {
      const basis = inspected[i];
      if (issues.length || !basis.eligible) return { observationId: o.id, priceBasis: o.priceBasis, differencePerBaseIncVat: null, differenceForPackIncVat: null, differencePercent: null };
      const competitorSize = normalized(packSchema.parse({ unit: o.originalPack.unit, quantity: o.originalPack.min, count: o.originalPack.count })), theirRate = div(decimal(o.priceIncVat!), competitorSize.total), difference = sub(rate, theirRate);
      return { observationId: o.id, priceBasis: o.priceBasis, differencePerBaseIncVat: rounded(difference, 6), differenceForPackIncVat: rounded(mul(difference, size.total), 2), differencePercent: rounded(mul(div(difference, theirRate), rat(B(100))), 4) };
    });
    const cost = inputs.cost, time = Date.parse(inputs.capturedAt);
    const supportedCost = cost && cost.sku === scenario.sku && cost.unit === size.unit && Date.parse(cost.effectiveFrom) <= time && Date.parse(cost.effectiveUntil) >= time;
    const revenue = inputs.product.vatRateBasisPoints === null ? null : div(mul(price, rat(B(10000))), rat(B(10000 + inputs.product.vatRateBasisPoints)));
    const totalCost = supportedCost && !issues.length ? add(mul(decimal(cost.unitCostExVat), size.total), decimal(p.additionalCostExVat)) : null;
    const profit = revenue && totalCost ? sub(revenue, totalCost) : null;
    return { label: p.label, unit: size.unit, totalQuantity: trimmed(size.total), salePriceIncVat: rounded(price, 2), pricePerBaseIncVat: issues.length ? null : rounded(rate, 6), issues,
      revenueExVat: revenue ? rounded(revenue, 2) : null, costExVat: totalCost ? rounded(totalCost, 2) : null, grossProfitExVat: profit ? rounded(profit, 2) : null,
      grossMarginPercent: profit && revenue ? rounded(mul(div(profit, revenue), rat(B(100))), 4) : null,
      markupPercent: profit && totalCost && totalCost.n !== B(0) ? rounded(mul(div(profit, totalCost), rat(B(100))), 4) : null, comparisons };
  });
  return { mode: 'preview' as const, persisted: false as const, operationalWrites: false as const, activationAllowed: false as const, status: 'review_required' as const,
    inputAuthority: 'server_existing_catalog_and_competitor_observations' as const, roundingPolicy: 'rational_half_up_money_2_rate_6_percent_4' as const, observations: inspected, scenarios };
}
const signed = z.string().regex(/^-?\d+(\.\d+)?$/).nullable();
const resultSchema = z.object({ mode: z.literal('preview'), persisted: z.literal(false), operationalWrites: z.literal(false), activationAllowed: z.literal(false), status: z.literal('review_required'),
  inputAuthority: z.literal('server_existing_catalog_and_competitor_observations'), roundingPolicy: z.literal('rational_half_up_money_2_rate_6_percent_4'),
  observations: z.array(z.object({ id: uuid, eligible: z.boolean(), reasons: z.array(z.string()), unit: baseUnit.nullable(), quantity: signed, pricePerBaseIncVat: signed })),
  scenarios: z.array(z.object({ label: z.string(), unit: baseUnit, totalQuantity: z.string(), salePriceIncVat: z.string(), pricePerBaseIncVat: signed, issues: z.array(z.string()), revenueExVat: signed, costExVat: signed, grossProfitExVat: signed, grossMarginPercent: signed, markupPercent: signed,
    comparisons: z.array(z.object({ observationId: uuid, priceBasis: z.enum(['public', 'member']), differencePerBaseIncVat: signed, differenceForPackIncVat: signed, differencePercent: signed })) })) });
export const packPreviewSchema = z.object({ scenario: packScenarioSchema, inputs: packInputsSchema, preview: resultSchema }).superRefine((v, c) => {
  try { if (JSON.stringify(comparePacks(v.scenario, v.inputs)) !== JSON.stringify(v.preview)) c.addIssue({ code: 'custom', message: 'Invalid comparison arithmetic' }); } catch { c.addIssue({ code: 'custom', message: 'Invalid source identity' }); }
});
export type PackPreview = z.infer<typeof packPreviewSchema>;
export const packReceiptSchema = packPreviewSchema.safeExtend({ id: uuid, revision: z.number().int().positive(), status: z.literal('draft'), saved: z.literal(true), persisted: z.literal(true),
  operationalWrites: z.literal(false), activationAllowed: z.literal(false), createdAt: instant, updatedAt: instant, replayed: z.boolean().optional() }).superRefine((v, c) => {
  if (Date.parse(v.updatedAt) < Date.parse(v.createdAt)) c.addIssue({ code: 'custom', message: 'Invalid receipt time' });
});
export type PackReceipt = z.infer<typeof packReceiptSchema>;
export const packDraftPageSchema = z.object({ items: z.array(packReceiptSchema).max(20), next: uuid.nullable() }).superRefine((v, c) => {
  if (new Set(v.items.map(i => i.id)).size !== v.items.length || v.next !== null && v.next !== v.items[v.items.length - 1]?.id) c.addIssue({ code: 'custom', message: 'Invalid draft page' });
});
export const createPackSchema = z.object({ requestId: uuid, scenario: packScenarioSchema }).strict();
export const updatePackSchema = createPackSchema.extend({ revision: z.number().int().positive().max(2147483646) }).strict();
export const samePackScenario = (a: PackScenario, b: PackScenario) => JSON.stringify(packScenarioSchema.parse(a)) === JSON.stringify(packScenarioSchema.parse(b));
export function packPreviewUrl(value: PackScenario) {
  const bytes = new TextEncoder().encode(JSON.stringify(packScenarioSchema.parse(value)));
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (encoded.length > 7000) throw Error('Planning text exceeds the bounded preview request');
  return `${PACK_API}/preview?scenario=${encoded}`;
}
