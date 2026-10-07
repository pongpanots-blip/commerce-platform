import { unitLabelForStorage } from '../../integration/connector/josh/pricing/unit-label.helper';
import { BadRequestException } from '@nestjs/common';

export interface PromotionRule { min_qty: number; max_qty?: number; promotion_price: number; unit_label?: string; badge_text?: string }
/** Full replacement; [] explicitly clears. Never silently discard malformed rows. */
export function validatePromotionRules(raw: unknown): PromotionRule[] {
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { throw new BadRequestException('promotion_rules must be a JSON array'); } }
  if (!Array.isArray(raw) || raw.length > 100) throw new BadRequestException('promotion_rules must be an array of at most 100 rules');
  const rows: PromotionRule[] = raw.map((r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some(k => !['min_qty', 'max_qty', 'promotion_price', 'unit_label', 'badge_text'].includes(k))) throw new BadRequestException('invalid promotion rule');
    if (!Number.isInteger(r.min_qty) || r.min_qty < 1 || r.min_qty > 2147483647 || (r.max_qty != null && (!Number.isInteger(r.max_qty) || r.max_qty < r.min_qty || r.max_qty > 2147483647))) throw new BadRequestException('invalid quantity range');
    if (typeof r.promotion_price !== 'number' || !Number.isFinite(r.promotion_price) || r.promotion_price < 0 || r.promotion_price > 9999999999.99 || Math.abs(r.promotion_price * 100 - Math.round(r.promotion_price * 100)) > 0.0001) throw new BadRequestException('invalid promotion price');
    for (const [k, limit] of [['unit_label', 50], ['badge_text', 100]] as const) if (r[k] != null && (typeof r[k] !== 'string' || r[k].length > limit)) throw new BadRequestException(`invalid ${k}`);
    return { min_qty: r.min_qty, ...(r.max_qty == null ? {} : { max_qty: r.max_qty }), promotion_price: r.promotion_price,
      ...(r.unit_label == null ? {} : { unit_label: unitLabelForStorage(r.unit_label) }), ...(r.badge_text == null ? {} : { badge_text: r.badge_text }) };
  }).sort((a, b) => a.min_qty - b.min_qty);
  for (let i = 1; i < rows.length; i++) if (rows[i].min_qty <= (rows[i - 1].max_qty ?? rows[i - 1].min_qty)) throw new BadRequestException('overlapping promotion ranges');
  return rows;
}
export function splitPromotionRules(fields: Record<string, unknown>) {
  const { promotion_rules, tier_prices, ...rest } = fields;
  if (promotion_rules !== undefined && tier_prices !== undefined) throw new BadRequestException('send promotion_rules or tier_prices, not both');
  const raw = promotion_rules !== undefined ? promotion_rules : tier_prices;
  return { rules: raw === undefined ? undefined : validatePromotionRules(raw), rest };
}
