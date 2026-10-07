import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { cronConfig } from '../../../../../config/cron.config';
import { ErpFeedService } from './erp-feed.service';

const BATCH = 100;

/**
 * ERP calls josh received directly while commerce was down (spec §3.3, josh_erp_fallback_calls from
 * erp.fallback.received) go through the normal ERP feed once: qty lands in the ledger with its own CHANGED_AT, so it
 * is applied, or recorded stale when commerce already has something newer. Other paths are only marked (price / MOQ
 * are josh's until stage 4). Opt-in: CRON_ERP_FALLBACK_REPLAY_ENABLED.
 */
@Injectable()
export class ErpFallbackReplayJob {
  private readonly logger = new Logger(ErpFallbackReplayJob.name);
  private running = false;

  constructor(@InjectDataSource() private readonly db: DataSource, private readonly feed: ErpFeedService) {}

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
      let note = 'not stock';
      if (/\/products\/qty$/.test(row.path)) {
        const items = Array.isArray(row.body) ? row.body : row.body ? [row.body] : [];
        await this.feed.receive('qty', items);
        note = `qty: ${items.length} item(s)`;
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
