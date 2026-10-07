import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { cronConfig } from '../../../../config/cron.config';
import { joshApiConfigured, postToJosh } from './josh-api';
import { JoshReplica } from './josh-replica';

/** The order statuses josh's bestseller carousel counts (carousel.service.ts). josh answers 409 if its list differs. */
export const JOSH_BESTSELLER_ORDER_STATUSES = ['paid', 'preparing', 'shipped', 'delivered'];
/** josh asks for at most 50; the extra room covers SKUs josh hides (inactive, price 0) before it slices. */
export const BESTSELLER_TOP = 200;

/**
 * Units sold per SKU over every paid order — the SUM josh's bestseller rail runs
 * over all of order_items. No product filter here on purpose: josh applies its
 * own "listable" rule to this short list, so that rule lives in josh only.
 */
export const BESTSELLERS_SQL = `
  SELECT inv.product_inventory_sku AS sku
  FROM order_items oi
  JOIN orders o ON o.orders_id = oi.order_id
  JOIN product_inventory inv ON inv.product_inventory_id = oi.product_inventory_id
  WHERE o.status::text = ANY($1::text[]) AND inv.product_inventory_sku IS NOT NULL
  GROUP BY inv.product_inventory_sku
  ORDER BY SUM(oi.product_quantity) DESC, inv.product_inventory_sku
  LIMIT $2`;

/**
 * The same ranking over commerce's order copies (order.snapshot): each line carries the SKU josh had when it last
 * sent the order, so no product join. Lines whose product josh deleted still count here (the replica drops them).
 */
export const BESTSELLERS_COPIES_SQL = `
  SELECT l.sku
  FROM josh_order_lines l
  JOIN josh_orders o ON o.orders_id = l.orders_id
  WHERE o.status = ANY($1::text[]) AND l.sku IS NOT NULL
  GROUP BY l.sku
  ORDER BY SUM(l.product_quantity) DESC, l.sku
  LIMIT $2`;

type Source = 'replica' | 'shadow' | 'copies';

/** BESTSELLERS_SOURCE: replica (default) · shadow (push the replica's list, log how the copies' list differs) · copies (no replica). */
export const bestsellersSource = (): Source => {
  const v = process.env.BESTSELLERS_SOURCE?.trim().toLowerCase();
  return v === 'shadow' || v === 'copies' ? v : 'replica';
};

/** How far the copies' ranking is from the replica's: SKUs only one side has, and the first rank where they part. */
export function rankingDiff(replica: string[], copies: string[]) {
  const a = new Set(replica), b = new Set(copies);
  const firstDiff = replica.findIndex((sku, i) => copies[i] !== sku);
  return {
    replica: replica.length, copies: copies.length,
    onlyReplica: replica.filter((s) => !b.has(s)).length, onlyCopies: copies.filter((s) => !a.has(s)).length,
    firstDiffRank: firstDiff === -1 && replica.length === copies.length ? null : (firstDiff === -1 ? replica.length : firstDiff) + 1,
  };
}

/**
 * Task 9 (offload), second job: the bestseller ranking for josh's home rail /
 * search, computed on the replica and pushed to POST /api/internal/bestsellers.
 * josh keeps it for an hour; no push (commerce down, job off) → josh runs its
 * own query exactly as before. Stage 5: BESTSELLERS_SOURCE moves it onto commerce's order copies.
 */
@Injectable()
export class BestsellersOffloadJob {
  private readonly logger = new Logger(BestsellersOffloadJob.name);
  private running = false;

  constructor(private readonly replica: JoshReplica, @InjectDataSource() private readonly db: DataSource) {}

  get configured() { return (bestsellersSource() === 'copies' || this.replica.configured) && joshApiConfigured(); }

  private async ranking(from: 'replica' | 'copies'): Promise<string[]> {
    const params = [JOSH_BESTSELLER_ORDER_STATUSES, BESTSELLER_TOP];
    const rows: { sku: unknown }[] = from === 'copies' ? await this.db.query(BESTSELLERS_COPIES_SQL, params) : await this.replica.query(BESTSELLERS_SQL, params);
    return rows.map((r) => String(r.sku));
  }

  async run(): Promise<number> {
    const computedAt = new Date().toISOString();
    const source = bestsellersSource();
    const skus = await this.ranking(source === 'copies' ? 'copies' : 'replica');
    if (source === 'shadow') {
      // A broken copy query must not stop the push josh relies on.
      await this.ranking('copies').then((copies) => this.logger.log(`bestsellers shadow (copies vs replica): ${JSON.stringify(rankingDiff(skus, copies))}`),
        (error) => this.logger.warn(`bestsellers shadow: copies query failed: ${error instanceof Error ? error.message : error}`));
    }
    await postToJosh('/internal/bestsellers', { computedAt, statuses: JOSH_BESTSELLER_ORDER_STATUSES, top: BESTSELLER_TOP, skus }, 30_000);
    return skus.length;
  }

  @Cron(cronConfig.joshBestsellers.expression, { timeZone: cronConfig.joshBestsellers.timeZone, disabled: !cronConfig.joshBestsellers.enabled })
  async scheduled() {
    if (this.running || !this.configured) return;
    this.running = true;
    try {
      this.logger.log(`bestsellers for josh (${bestsellersSource()}): ${await this.run()} SKUs sent`);
    } catch (error) {
      this.logger.warn(`bestsellers offload failed — josh computes its own once the last push expires: ${error instanceof Error ? error.message : error}`);
    } finally { this.running = false; }
  }
}
