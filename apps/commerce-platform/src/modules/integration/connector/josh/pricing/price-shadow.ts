import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { cronConfig } from '../../../../../config/cron.config';
import { resolveApproxOrderUnitPrice } from '../jagota/pack-order-price.helper';
import { JoshReplica } from '../josh-replica';
import { PriceShadowCheck } from './price-shadow-check.entity';
import { resolveSkuPrice, ResolvedSkuPrice } from './pricing.resolver';

const BATCH = 300;

export interface JoshOrderLine {
  id: string; order_number: string | null; sku: string | null; product_inventory_id: string;
  quantity: number; unit_price: number; price_source: string | null; promotion_mechanic_id: string | null;
  company_id: string | null; branch_id: string | null; ordered_at: Date;
  packaging_type: string | null; selling_unit: string | null; selling_unit_price: number | null; ordering_price: number | null;
  pack_size: string | null; units_per_box: string | null; weight_per_unit: string | null;
}

/**
 * The unit price (inc. VAT) josh stores on the order line for a resolved price — josh
 * `currentLinePricing`: a weight-priced approx box is priced per order unit, anything else at the
 * resolved price. Then which of price / source / mechanic differ from what josh stored.
 */
export function compareLine(line: JoshOrderLine, resolved: ResolvedSkuPrice) {
  const approx = resolveApproxOrderUnitPrice({ ...line, resolved_per_kg: resolved.price });
  const unitPrice = Math.round((approx.orderUnitPrice ?? resolved.price) * 100) / 100;
  const diffs: string[] = [];
  if (Math.abs(unitPrice - Number(line.unit_price)) >= 0.005) diffs.push('price');
  // Lines from before josh recorded price_source carry null — nothing to compare.
  if (line.price_source != null && line.price_source !== resolved.source) diffs.push('source');
  if (line.price_source != null && (line.promotion_mechanic_id ?? null) !== (resolved.promotion_mechanic_id ?? null)) diffs.push('mechanic');
  return { unitPrice, diffs };
}

/**
 * Shadow mode for "commerce owns product prices" (plan step 3): every new josh order line is
 * re-priced with josh's own resolveSkuPrice (copied, run on josh's replica) for the same company,
 * branch, quantity and order time, and compared with the price josh charged. Nothing is written
 * to josh. 100% for a long stretch = commerce can price exactly like josh before it owns prices.
 */
@Injectable()
export class PriceShadow {
  private readonly logger = new Logger(PriceShadow.name);
  private running = false;

  constructor(
    private readonly replica: JoshReplica,
    @InjectRepository(PriceShadowCheck) private readonly checks: Repository<PriceShadowCheck>,
  ) {}

  get available() { return this.replica.configured; }

  @Cron(cronConfig.priceShadow.expression, { timeZone: cronConfig.priceShadow.timeZone, disabled: !cronConfig.priceShadow.enabled })
  async tick() {
    if (!this.available || this.running) return; // ponytail: in-process guard; one commerce instance runs this cron
    this.running = true;
    try {
      const n = await this.checkNew();
      if (n) this.logger.log(`re-priced ${n} josh order lines`);
    } catch (error) {
      this.logger.warn(`price shadow failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.running = false;
    }
  }

  private lines(where: string, params: unknown[]) {
    return this.replica.query<JoshOrderLine>(`SELECT oi.id::text AS id, o.order_number, pi.product_inventory_sku AS sku, oi.product_inventory_id,
        oi.product_quantity AS quantity, oi.product_price::float AS unit_price, oi.price_source, oi.promotion_mechanic_id,
        o.company_id, o.branch_id, o.create_date AS ordered_at,
        pi.packaging_type, pi.selling_unit, pi.selling_unit_price::float AS selling_unit_price, pi.ordering_price::float AS ordering_price,
        pi.pack_size, pi.units_per_box, pi.weight_per_unit
      FROM order_items oi JOIN orders o ON o.orders_id = oi.order_id
      LEFT JOIN product_inventory pi ON pi.product_inventory_id = oi.product_inventory_id
      ${where}`, params);
  }

  /** Every josh order line not checked yet (after the newest checked; first run: last 24h). */
  async checkNew(limit = BATCH): Promise<number> {
    const [{ since }] = await this.checks.query(`SELECT COALESCE(max(ordered_at), now() - interval '24 hours') AS since FROM price_shadow_checks`);
    const rows = await this.lines(`WHERE o.create_date >= $1 ORDER BY o.create_date LIMIT $2`, [since, limit]);
    if (!rows.length) return 0;
    const done = new Set((await this.checks.find({ where: rows.map((r) => ({ joshOrderItemId: r.id })), select: ['joshOrderItemId'] })).map((c) => c.joshOrderItemId));
    let n = 0;
    for (const row of rows.filter((r) => !done.has(r.id))) { await this.checkOne(row); n++; }
    return n;
  }

  async recheck(joshOrderItemId: string) {
    const [row] = await this.lines(`WHERE oi.id::text = $1`, [joshOrderItemId]);
    if (!row) throw new NotFoundException(`josh order line ${joshOrderItemId} not found`);
    await this.checks.delete({ joshOrderItemId });
    return this.checkOne(row);
  }

  private async checkOne(line: JoshOrderLine): Promise<PriceShadowCheck> {
    const base = { joshOrderItemId: line.id, orderNumber: line.order_number, sku: line.sku, quantity: line.quantity, orderedAt: line.ordered_at,
      joshUnitPrice: String(line.unit_price), joshSource: line.price_source, joshMechanicId: line.promotion_mechanic_id };
    try {
      const resolved = await this.replica.run((ds) => resolveSkuPrice(ds, {
        productInventoryId: line.product_inventory_id, companyId: line.company_id, branchId: line.branch_id,
        quantity: line.quantity, at: new Date(line.ordered_at),
      }));
      const { unitPrice, diffs } = compareLine(line, resolved);
      const note = diffs.length ? await this.changedAfter(line) : null;
      return await this.checks.save(this.checks.create({ ...base, commerceUnitPrice: String(unitPrice), commerceSource: resolved.source,
        commerceMechanicId: resolved.promotion_mechanic_id, matched: diffs.length === 0, diffs, note }));
    } catch (error) {
      return this.checks.save(this.checks.create({ ...base, matched: false, diffs: [],
        note: `commerce คิดราคาไม่ได้: ${error instanceof Error ? error.message : error}` }));
    }
  }

  /** Price data for this line edited after the order — a difference that is not a pricing bug. */
  private async changedAfter(line: JoshOrderLine): Promise<string | null> {
    const [r] = await this.replica.query<Record<string, boolean>>(`SELECT
        EXISTS (SELECT 1 FROM product_inventory WHERE product_inventory_id = $1 AND updated_at > $2) AS product,
        EXISTS (SELECT 1 FROM private_price WHERE product_inventory_id = $1 AND company_id = $3 AND updated_at > $2) AS customer_price,
        EXISTS (SELECT 1 FROM branch_contract_price WHERE product_inventory_id = $1 AND branch_id = $4 AND updated_at > $2) AS contract_price,
        EXISTS (SELECT 1 FROM product_branch_specials WHERE product_inventory_id = $1 AND branch_id = $4 AND updated_at > $2) AS branch_special,
        EXISTS (SELECT 1 FROM promotion_quantity_rules WHERE product_inventory_id = $1 AND updated_at > $2) AS qty_rules,
        EXISTS (SELECT 1 FROM promotion_mechanic_sku_items i JOIN promotion_mechanics m ON m.id = i.promotion_mechanic_id
                 WHERE i.product_inventory_id = $1 AND (i.updated_at > $2 OR m.updated_at > $2)) AS mechanic`,
      [line.product_inventory_id, line.ordered_at, line.company_id, line.branch_id]);
    const changed = Object.entries(r ?? {}).filter(([, v]) => v).map(([k]) => k);
    return changed.length ? `ข้อมูลราคาแก้หลังสั่ง: ${changed.join(', ')}` : null;
  }

  async summary(days = 7) {
    const [row] = await this.checks.query(`SELECT count(*)::int AS checked, count(*) FILTER (WHERE matched)::int AS matched,
        count(*) FILTER (WHERE NOT matched AND commerce_source IS NOT NULL)::int AS mismatched,
        count(*) FILTER (WHERE commerce_source IS NULL)::int AS could_not_price,
        count(*) FILTER (WHERE NOT matched AND note LIKE 'ข้อมูลราคาแก้หลังสั่ง%')::int AS changed_after,
        min(ordered_at) AS first_at, max(ordered_at) AS last_at
      FROM price_shadow_checks WHERE ordered_at >= now() - make_interval(days => $1)`, [days]);
    const bySource = await this.checks.query(`SELECT josh_source, commerce_source, count(*)::int AS n FROM price_shadow_checks
      WHERE ordered_at >= now() - make_interval(days => $1) AND NOT matched AND commerce_source IS NOT NULL GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`, [days]);
    return { days, ...row, matchRate: row.checked ? Math.round((row.matched / row.checked) * 1000) / 10 : null, mismatchBySource: bySource };
  }

  list(filter: 'all' | 'mismatched' | 'matched' = 'mismatched', page = 1, limit = 50) {
    const where = filter === 'mismatched' ? { matched: false } : filter === 'matched' ? { matched: true } : {};
    return this.checks.findAndCount({ where, order: { orderedAt: 'DESC' }, skip: (page - 1) * limit, take: limit })
      .then(([items, total]) => ({ items, total, page, limit }));
  }
}
