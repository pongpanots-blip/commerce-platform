import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ownsPrices } from '../../commerce/product-prices/product-prices.service';
import { ownsProductMaster } from '../../commerce/product-masters/product-masters.service';
import { ownsPromotions } from '../../commerce/product-promotion-rules/product-promotion-rules.service';
import { rehearsePromotion } from '../commerce-previews/promotion-rehearsal';
import { resolveSellUnit, roundMoney } from '../../../shared-kernel/helpers/pack-order-price.helper';
import { promotionScenarioSchema } from './promotion-planning.schema';
type Row = Record<string, unknown>;
const text = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null;
const date = (v: unknown) => v instanceof Date && Number.isFinite(v.getTime()) ? v.toISOString() : typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const money = (v: unknown) => typeof v === 'string' && /^\d{1,10}(\.\d{1,2})?$/.test(v) && Number(v) > 0 ? v : null;
export const observationHash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export interface PromotionInputs {
  schemaVersion: 1; sku: string; observedAt: string; sourceFreshness: 'unavailable';
  product: { id: string; unit: string | null; packagingType: string | null; packSize: string | null; sourceVersion: string | null; sourceAsOf: string | null };
  price: { unitPrice: string | null; currency: 'THB'; basis: 'inclusive'; vatRateBasisPoints: number | null; source: 'commerce_price' | 'catalog_copy'; sourceAsOf: string | null };
  stock: null; cost: null;
  existingRules: { source: 'commerce' | 'josh_shadow'; rules: unknown[] | null; mechanicAssigned: boolean | null; version: string | null; sourceAsOf: null };
  unavailable: string[]; activationAllowed: false;
}
/** Server observations, not proof of upstream freshness or an executable checkout/stock forecast. */
@Injectable()
export class PromotionInputsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}
  async inputs(rawSku: string, clock: () => Date = () => new Date()): Promise<PromotionInputs> {
    if (typeof rawSku !== 'string' || !rawSku.trim() || rawSku.length > 100 || /[\x00-\x1f\x7f]/.test(rawSku)) throw new BadRequestException('Invalid SKU');
    const sku = rawSku.trim(), unavailable = ['authoritative_effective_cost', 'stock_selling_unit_mapping', 'source_freshness', 'promotion_capacity', 'customer_contract_price_context'];
    let rows: Row[];
    try { rows = await this.db.query(`SELECT id::text, sku, selling_unit, order_taking_unit, packaging_type, pack_size, units_per_box, weight_per_unit, vat_type,
      ordering_price::text AS selling_price, source_version::text, synced_at FROM josh_catalog_products WHERE sku=$1 AND removed_at IS NULL LIMIT 2`, [sku]); }
    catch { throw new ServiceUnavailableException('Catalog observations are unavailable'); }
    if (!rows.length) throw new NotFoundException('SKU not found in the catalog copy');
    if (rows.length !== 1) throw new ConflictException('SKU identity is ambiguous');
    const c = rows[0];
    let metadata = c, metadataAsOf = date(c.synced_at), price = c.selling_price, priceAsOf = date(c.synced_at);
    if (ownsProductMaster()) {
      try {
        const [m]: Row[] = await this.db.query('SELECT fields, updated_at FROM product_masters WHERE product_inventory_sku=$1', [sku]);
        const fields = m?.fields && typeof m.fields === 'object' && !Array.isArray(m.fields) ? m.fields as Row : {};
        // Owned missing/cleared fields cannot fall back to stale copied values.
        metadata = { ...c, selling_unit: fields.selling_unit, packaging_type: fields.packaging_type, pack_size: fields.pack_size, vat_type: fields.vat_type };
        metadataAsOf = date(m?.updated_at); if (!m) unavailable.push('owned_product_metadata');
      } catch { metadata = {}; metadataAsOf = null; unavailable.push('owned_product_metadata'); }
    }
    if (ownsPrices()) {
      // ERP PRICE per order unit → josh's sell-unit total (selling_price), the same way josh applies it; the per-selling-unit rate is not a price.
      try { const [p]: Row[] = await this.db.query('SELECT ordering_price::text, updated_at FROM product_prices WHERE product_inventory_sku=$1', [sku]); price = p?.ordering_price == null ? null : roundMoney(Number(p.ordering_price) * resolveSellUnit({ ...c, ...metadata }).factor).toFixed(2); priceAsOf = date(p?.updated_at); }
      catch { price = null; priceAsOf = null; unavailable.push('owned_selling_price'); }
    }
    let existingRules: PromotionInputs['existingRules'] = { source: ownsPromotions() ? 'commerce' : 'josh_shadow', rules: null, mechanicAssigned: null, version: null, sourceAsOf: null };
    try {
      const [r]: Row[] = await this.db.query('SELECT rules, shadow_rules, version::text, shadow_version::text, lock, lock_version::text FROM product_promotion_rules WHERE sku=$1', [sku]);
      const rules = ownsPromotions() ? r?.rules : r?.shadow_rules;
      existingRules = { ...existingRules, rules: Array.isArray(rules) ? rules : null,
        mechanicAssigned: r?.lock_version != null ? r.lock != null : null, version: text(ownsPromotions() ? r?.version : r?.shadow_version) };
    } catch { unavailable.push('existing_promotion_rules'); }
    if (existingRules.rules === null || existingRules.mechanicAssigned === null) unavailable.push('existing_promotion_ownership');
    const unitPrice = money(price), vat = metadata.vat_type === '7%' ? 700 : metadata.vat_type === '0%' ? 0 : null;
    if (unitPrice === null) unavailable.push('selling_price'); if (vat === null) unavailable.push('tax_basis');
    return { schemaVersion: 1, sku, observedAt: clock().toISOString(), sourceFreshness: 'unavailable',
      product: { id: String(c.id), unit: text(metadata.selling_unit), packagingType: text(metadata.packaging_type), packSize: text(metadata.pack_size), sourceVersion: text(c.source_version), sourceAsOf: metadataAsOf },
      price: { unitPrice, currency: 'THB', basis: 'inclusive', vatRateBasisPoints: vat, source: ownsPrices() ? 'commerce_price' : 'catalog_copy', sourceAsOf: priceAsOf },
      stock: null, cost: null, existingRules, unavailable, activationAllowed: false };
  }
  async preview(raw: unknown) {
    const scenario = promotionScenarioSchema.parse(raw), inputs = await this.inputs(scenario.line.sku);
    // The stamp describes this observation only. Unknown upstream freshness stays an explicit blocking issue.
    const stamp = { id: `observation:${inputs.product.id}`, version: observationHash(inputs), asOf: inputs.observedAt, validUntil: inputs.observedAt };
    const unit = inputs.product.unit, packaging = inputs.product.packagingType?.toLowerCase();
    const preview = rehearsePromotion({ at: inputs.observedAt, line: scenario.line,
      price: inputs.price.unitPrice && unit ? { kind: 'selling_price', sku: inputs.sku, unit, currency: 'THB', unitPrice: inputs.price.unitPrice, source: stamp,
        pricingSource: 'base', pricingBasis: packaging === 'fixed' ? 'fixed_selling_unit' : packaging === 'approx' ? 'approx_weight_pack' : 'unknown',
        tax: { basis: 'inclusive', rateBasisPoints: inputs.price.vatRateBasisPoints } } : null,
      cost: null, stock: null, rules: scenario.proposedValue === null ? [] : [{ source: { ...stamp, id: 'proposed-rule' }, scope: 'sku', value: scenario.proposedValue, capacity: { kind: 'unknown' } }],
      stacking: 'none', minimumGrossMarginPercent: scenario.minimumGrossMarginPercent });
    return { scenario, inputs, preview: { ...preview, inputAuthority: 'server_read_observations' as const,
      status: preview.status === 'complete' ? 'incomplete' as const : preview.status,
      issues: [...preview.issues, { code: 'source_freshness_unavailable', input: 'price' }, { code: 'isolated_proposal_not_checkout_price', input: 'rules' },
        ...(inputs.existingRules.mechanicAssigned !== false ? [{ code: 'existing_promotion_ownership_unresolved', input: 'rules' }] : [])] } };
  }
}
