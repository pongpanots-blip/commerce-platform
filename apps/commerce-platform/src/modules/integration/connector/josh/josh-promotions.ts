import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JoshReplica } from './josh-replica';

const STATE = `CASE WHEN NOT m.is_active THEN 'off' WHEN now() < COALESCE(c.start_at, m.start_date) THEN 'scheduled'
  WHEN now() > COALESCE(c.end_at, m.end_date) THEN 'ended' WHEN m.max_units IS NOT NULL AND m.sold_units >= m.max_units THEN 'sold_out' ELSE 'running' END`;

/**
 * josh's promotion mechanics, read from josh's replica (columns as josh names them). Writes go
 * through josh's PromotionMechanicService (JoshActions target `promotions`). The shadow figure is
 * commerce's own price shadow: how often commerce, re-pricing josh's order lines, picked the same
 * mechanic josh did — the bar to clear before COMMERCE_OWNS_PROMOTIONS.
 */
@Injectable()
export class JoshPromotions {
  constructor(private readonly replica: JoshReplica, private readonly db: DataSource) {}

  get available() { return this.replica.configured; }

  async list(f: { state?: string; search?: string } = {}) {
    const params: unknown[] = [];
    const w: string[] = [];
    if (f.search?.trim()) w.push(`m.name ILIKE $${params.push(`%${f.search.trim().slice(0, 100)}%`)}`);
    if (f.state) w.push(`${STATE} = $${params.push(f.state.slice(0, 20))}`);
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    return this.replica.query(`SELECT m.id, m.name, m.badge_text, m.badge_text_en, m.is_active, m.start_date, m.end_date, m.campaign_id, c.name AS campaign_name,
        m.max_units, m.sold_units, m.audience, jsonb_array_length(m.audience_company_ids) AS audience_companies, m.value, m.product_set_ids, m.updated_at,
        (SELECT count(*)::int FROM promotion_mechanic_sku_items i WHERE i.promotion_mechanic_id = m.id) AS sku_count, ${STATE} AS state
      FROM promotion_mechanics m LEFT JOIN campaigns c ON c.id = m.campaign_id
      ${where} ORDER BY (${STATE}) = 'running' DESC, m.end_date DESC LIMIT 300`, params);
  }

  async detail(id: string) {
    const [m] = await this.replica.query<Record<string, unknown>>(`SELECT m.*, c.name AS campaign_name, ${STATE} AS state
      FROM promotion_mechanics m LEFT JOIN campaigns c ON c.id = m.campaign_id WHERE m.id = $1`, [id]);
    if (!m) throw new NotFoundException(`promotion ${id} not found in josh`);
    const skus = await this.replica.query(`SELECT i.sku, i.product_inventory_id, th.product_name AS name_th, i.badge_text, i.value, i.quantity_rules
      FROM promotion_mechanic_sku_items i LEFT JOIN product_translation th ON th.product_inventory_id = i.product_inventory_id AND th.language_code = 'th'
      WHERE i.promotion_mechanic_id = $1 ORDER BY i.sort_order, i.sku LIMIT 500`, [id]);
    return { ...m, skus };
  }

  productSets() {
    return this.replica.query(`SELECT s.id, s.name, s.is_active, (SELECT count(*)::int FROM promotion_products p WHERE p.product_set_id = s.id) AS products
      FROM promotion_product_sets s ORDER BY s.is_active DESC, s.name`);
  }

  campaigns() {
    return this.replica.query(`SELECT id, name, start_at, end_at, is_active FROM campaigns ORDER BY start_at DESC NULLS LAST LIMIT 100`);
  }

  /** Price shadow, promotion lines only: lines where josh or commerce picked a mechanic. */
  async shadow(days = 7) {
    const [row] = await this.db.query(`SELECT count(*)::int AS lines,
        count(*) FILTER (WHERE COALESCE(josh_mechanic_id::text, '') = COALESCE(commerce_mechanic_id::text, ''))::int AS same_mechanic,
        count(*) FILTER (WHERE matched)::int AS matched
      FROM price_shadow_checks WHERE ordered_at >= now() - make_interval(days => $1)
        AND (josh_mechanic_id IS NOT NULL OR commerce_mechanic_id IS NOT NULL)`, [days]);
    return { days, ...row, sameMechanicRate: row.lines ? Math.round((row.same_mechanic / row.lines) * 1000) / 10 : null };
  }
}
