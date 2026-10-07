import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { cronConfig } from '../../../../../config/cron.config';
import { ErpFeedService } from './erp-feed.service';
import { ProductMastersService } from '../../../../commerce/product-masters/product-masters.service';
import { ProductImagesService } from '../../../../commerce/product-images/product-images.service';

const BATCH = 100;

/**
 * ERP calls josh received directly while commerce was down (spec §3.3, josh_erp_fallback_calls from
 * erp.fallback.received) go through the normal ERP feed once: qty lands in the ledger with its own CHANGED_AT, so it
 * is applied, or recorded stale when commerce already has something newer; price / MOQ go to the MER queue (stage 4a).
 * Other paths are only marked. Opt-in: CRON_ERP_FALLBACK_REPLAY_ENABLED.
 */
@Injectable()
export class ErpFallbackReplayJob {
  private readonly logger = new Logger(ErpFallbackReplayJob.name);
  private running = false;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly feed: ErpFeedService,
    /** Stage 4d: product upserts josh took directly go to commerce's MER queue. */
    @Optional() private readonly masters?: ProductMastersService,
    /** Stage 4e: image calls josh took directly replace commerce's gallery. */
    @Optional() private readonly images?: ProductImagesService,
  ) {}

  @Cron(cronConfig.erpFallbackReplay.expression, { disabled: !cronConfig.erpFallbackReplay.enabled })
  async tick() {
    if (this.running) return;
    this.running = true;
    try { await this.replay(); } finally { this.running = false; }
  }

  async replay(): Promise<{ replayed: number; skipped: number }> {
    const rows: Array<{ id: string; path: string; body: unknown }> = await this.db.query(
      `SELECT josh_outbox_id AS id, path, body FROM josh_erp_fallback_calls WHERE processed_at IS NULL ORDER BY received_at, josh_outbox_id LIMIT ${BATCH}`);
    let replayed = 0;
    let skipped = 0;
    for (const row of rows) {
      // qty → ledger (stage 3); price / moq → the ERP feed, which stages them in commerce's MER queue once it owns
      // prices (stage 4a). Anything else is josh's and only marked.
      const kind = /\/products\/(qty|price|moq)$/.exec(row.path)?.[1] as 'qty' | 'price' | 'moq' | undefined;
      let note = 'not replayed (josh-owned)';
      if (kind) {
        const items = Array.isArray(row.body) ? row.body : row.body ? [row.body] : [];
        await this.feed.receive(kind, items);
        note = `${kind}: ${items.length} item(s)`;
        replayed++;
      } else if (/\/products\/image$/.test(row.path) && this.images) {
        const applied = await this.db.transaction((m) => this.images!.fromErp(m, row.body));
        note = `product image: ${applied} applied`;
        replayed++;
      } else if (/\/products(\/bulk)?$/.test(row.path) && this.masters) {
        const staged = await this.db.transaction((m) => this.masters!.stageFromErp(m, row.body, new Date()));
        note = `product upsert: ${staged} staged`;
        replayed++;
      } else {
        skipped++;
      }
      await this.db.query(`UPDATE josh_erp_fallback_calls SET processed_at = now(), processed_note = $2 WHERE josh_outbox_id = $1`, [row.id, note]);
    }
    if (rows.length) this.logger.log(`ERP fallback replay: ${replayed} qty call(s) into the ledger, ${skipped} other(s) marked`);
    return { replayed, skipped };
  }
}
