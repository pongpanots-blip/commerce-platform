import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { comparePacks, inspectObservation, packInputsSchema, packScenarioSchema, packSchema, type PackInputs } from './pack-price';
import { CompetitorPricesService } from '../competitor-prices/competitor-prices.service';

const iso = (value: unknown): string | null => {
  const time = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
/** Exact, explicit catalog dimensions only. No name guesses or midpoint of Approx ranges. */
export function catalogPlanningPack(sellingUnit: string | null, packText: string | null, packagingType: string | null) {
  const selling = sellingUnit?.trim().toUpperCase();
  const direct: Record<string, 'kg' | 'g' | 'l' | 'ml' | 'piece'> = { KG: 'kg', G: 'g', GM: 'g', L: 'l', LT: 'l', ML: 'ml', PC: 'piece', EA: 'piece' };
  if (selling && direct[selling] && ['KG', 'G', 'GM', 'L', 'LT', 'ML'].includes(selling)) return { unit: direct[selling], quantity: '1', count: 1 };
  if (/^approx$/i.test(packagingType ?? '')) return null;
  const match = packText?.trim().match(/^(\d+(?:\.\d{1,4})?)\s*(KG|G|GM|L|LT|ML|PC|PCS|EA|กก\.?|กรัม|ลิตร|มล\.?|ชิ้น)(?:\s*[x×]\s*(\d{1,4}))?$/i);
  if (!match) return selling && ['PC', 'EA'].includes(selling) && !packText ? { unit: 'piece' as const, quantity: '1', count: 1 } : null;
  const units: Record<string, string> = { KG: 'kg', G: 'g', GM: 'g', L: 'l', LT: 'l', ML: 'ml', PC: 'piece', PCS: 'piece', EA: 'piece', 'กก': 'kg', 'กรัม': 'g', 'ลิตร': 'l', 'มล': 'ml', 'ชิ้น': 'piece' };
  const parsed = packSchema.safeParse({ unit: units[match[2].toUpperCase().replace('.', '')], quantity: match[1], count: Number(match[3] ?? 1) });
  return parsed.success ? parsed.data : null;
}
export function catalogVatBasis(value: string | null): number | null {
  const v = value?.trim().toLowerCase();
  return v === '7%' || v === '7' ? 700 : v === '0%' || v === '0' || v === 'exempt' ? 0 : null;
}
@Injectable()
export class PackInputsService {
  constructor(private readonly competitors: CompetitorPricesService) {}
  async inputs(rawSku: string, clock: () => Date = () => new Date()): Promise<PackInputs> {
    if (typeof rawSku !== 'string' || !rawSku.trim() || rawSku.length > 100 || /[\x00-\x1f\x7f]/.test(rawSku)) throw new BadRequestException('Invalid SKU');
    const sku = rawSku.trim(), capturedAt = clock().toISOString();
    // Read the existing local catalog and recorded pairs only; never pull/scrape or capture observations.
    const [product, pairs] = await Promise.all([this.competitors.catalog(sku, true), this.competitors.list()]);
    const relevant = pairs.filter(p => p.ourProduct.id === product.id && p.ourProduct.sku === sku).sort((a, b) => a.id.localeCompare(b.id));
    const observations = relevant.slice(0, 200).map(p => ({ id: p.id, revision: p.revision, vendor: p.sourceName, productName: p.competitorName,
      originalPack: { unit: p.planningEvidence.unit, min: p.planningEvidence.min, max: p.planningEvidence.max, count: p.planningEvidence.count },
      priceIncVat: p.planningEvidence.originalPriceIncVat, currency: p.planningEvidence.currency, taxBasis: p.planningEvidence.taxIncluded ? 'inclusive' as const : 'unverified' as const,
      priceBasis: p.priceBasis, observedAt: iso(p.observedAt), validUntil: p.planningEvidence.validUntil, mapped: p.verified,
      sourceCurrent: p.planningEvidence.sourceCurrent, sourceFailed: !!p.lastError }));
    const evidence = { product: { id: product.id, sku, name: product.name, sellingUnit: product.sellingUnit, packText: product.packSize,
      packagingType: product.packagingType, basis: catalogPlanningPack(product.sellingUnit, product.packSize, product.packagingType),
      currentPriceIncVat: product.originalPriceIncVat, currency: 'THB' as const, vatRateBasisPoints: catalogVatBasis(product.vatType), sourceAsOf: iso(product.updatedAt), sourceVersion: null },
      cost: null, observations, observationsTruncated: relevant.length > 200 };
    const inputs = packInputsSchema.parse({ schemaVersion: 1, sku, capturedAt, sourceFingerprint: '0'.repeat(64), upstreamFreshness: 'unverified', ...evidence, operationalWrites: false, activationAllowed: false });
    // Crossing an observation's validity boundary invalidates an old preview too, without hashing wall time.
    inputs.sourceFingerprint = createHash('sha256').update(JSON.stringify({ evidence, eligibility: inputs.observations.map(o => inspectObservation(o, inputs).reasons) })).digest('hex');
    return inputs;
  }
  async preview(raw: unknown) {
    const scenario = packScenarioSchema.parse(raw), inputs = await this.inputs(scenario.sku);
    if (inputs.sourceFingerprint !== scenario.sourceFingerprint || scenario.observationIds.some(id => !inputs.observations.some(o => o.id === id))) throw new ConflictException('Planning evidence changed. Reload before reviewing.');
    return { scenario, inputs, preview: comparePacks(scenario, inputs) };
  }
}
