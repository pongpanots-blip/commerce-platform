import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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
 * Task 9 (offload), second job: the bestseller ranking for josh's home rail /
 * search, computed on the replica and pushed to POST /api/internal/bestsellers.
 * josh keeps it for an hour; no push (commerce down, job off) → josh runs its
 * own query exactly as before.
 */
@Injectable()
export class BestsellersOffloadJob {
  private readonly logger = new Logger(BestsellersOffloadJob.name);
  private running = false;

  constructor(private readonly replica: JoshReplica) {}

  get configured() { return this.replica.configured && joshApiConfigured(); }

  async run(): Promise<number> {
    const computedAt = new Date().toISOString();
    const rows = await this.replica.query(BESTSELLERS_SQL, [JOSH_BESTSELLER_ORDER_STATUSES, BESTSELLER_TOP]);
    const skus = rows.map((r) => String(r.sku));
    await postToJosh('/internal/bestsellers', { computedAt, statuses: JOSH_BESTSELLER_ORDER_STATUSES, top: BESTSELLER_TOP, skus }, 30_000);
    return skus.length;
  }

  @Cron(cronConfig.joshBestsellers.expression, { timeZone: cronConfig.joshBestsellers.timeZone, disabled: !cronConfig.joshBestsellers.enabled })
  async scheduled() {
    if (this.running || !this.configured) return;
    this.running = true;
    try {
      this.logger.log(`bestsellers for josh: ${await this.run()} SKUs sent`);
    } catch (error) {
      this.logger.warn(`bestsellers offload failed — josh computes its own once the last push expires: ${error instanceof Error ? error.message : error}`);
    } finally { this.running = false; }
  }
}
