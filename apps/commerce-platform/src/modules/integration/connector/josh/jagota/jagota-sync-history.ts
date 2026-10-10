import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { cronConfig } from '../../../../../config/cron.config';
import { JoshReplica } from '../josh-replica';
import { JagotaSyncHistory } from './jagota-sync-history.entity';
import { ScheduledCron } from '../../../../../shared-kernel/infrastructure/scheduled-task';

const BATCH = 1000;
/** josh updates a sync row after it is created (ERP webhook doc no., retries) and has no updated_at — re-read this window every run. */
const REFRESH_DAYS = 3;

type JoshSyncRow = {
  id: string; order_id: string; order_number: string | null; shipment_id: string | null; payment_success: boolean; payment_method: string;
  request_json: Record<string, unknown> | null; sync_status: string; jagota_response_json: unknown; transaction_type: string | null;
  doc_book: string | null; doc_no: string | null; order_taking_doc_seq: string | null; error_message: string | null; created_at: Date;
};

export const toHistory = (r: JoshSyncRow): Partial<JagotaSyncHistory> => ({
  id: r.id, orderId: r.order_id, orderNumber: r.order_number, shipmentId: r.shipment_id, paymentSuccess: r.payment_success,
  paymentMethod: r.payment_method, requestJson: r.request_json, syncStatus: r.sync_status, jagotaResponseJson: r.jagota_response_json,
  transactionType: r.transaction_type, docBook: r.doc_book, docNo: r.doc_no, orderTakingDocSeq: r.order_taking_doc_seq,
  errorMessage: r.error_message, createdAt: r.created_at, importedAt: new Date(),
});

/**
 * Orders → Jagota step 3: copy josh's ERP send history (`jagota_order_sync`) into commerce.
 * Each run: rows newer than the newest copied one (backfills the whole history, BATCH at a time),
 * then re-reads the last REFRESH_DAYS days because josh edits rows in place. Reads josh only.
 */
@Injectable()
export class JagotaSyncHistoryImport {
  private readonly logger = new Logger(JagotaSyncHistoryImport.name);
  private running = false;

  constructor(
    private readonly replica: JoshReplica,
    @InjectRepository(JagotaSyncHistory) private readonly history: Repository<JagotaSyncHistory>,
  ) {}

  get available() { return this.replica.configured; }

  @ScheduledCron('jagota-sync-import', cronConfig.jagotaSyncImport.expression, { timeZone: cronConfig.jagotaSyncImport.timeZone, disabled: !cronConfig.jagotaSyncImport.enabled })
  async tick() {
    if (!this.available || this.running) return; // ponytail: in-process guard; one commerce instance runs this cron
    this.running = true;
    try {
      const r = await this.importNew();
      if (r.added || r.refreshed) this.logger.log(`josh jagota_order_sync: +${r.added} new, ${r.refreshed} refreshed`);
    } catch (error) {
      this.logger.warn(`jagota_order_sync import failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.running = false;
    }
  }

  private rows(where: string, params: unknown[]) {
    return this.replica.query<JoshSyncRow>(`SELECT s.id::text AS id, s.order_id::text AS order_id, o.order_number, s.shipment_id::text AS shipment_id,
        s.payment_success, s.payment_method, s.request_json, s.sync_status, s.jagota_response_json, s.transaction_type, s.doc_book, s.doc_no,
        s.order_taking_doc_seq, s.error_message, s.created_at
      FROM jagota_order_sync s LEFT JOIN orders o ON o.orders_id = s.order_id ${where}`, params);
  }

  async importNew(limit = BATCH) {
    const [{ newest }] = await this.history.query(`SELECT max(created_at) AS newest FROM jagota_order_sync_history`);
    // Same created_at can repeat; >= plus upsert keeps the boundary row(s) without skipping any.
    const fresh = await this.rows(newest ? `WHERE s.created_at >= $1 ORDER BY s.created_at LIMIT $2` : `ORDER BY s.created_at LIMIT $1`, newest ? [newest, limit] : [limit]);
    const recent = newest ? await this.rows(`WHERE s.created_at >= now() - make_interval(days => $1)`, [REFRESH_DAYS]) : [];
    const known = new Set(newest && fresh.length ? (await this.history.find({ where: fresh.map((r) => ({ id: r.id })), select: ['id'] })).map((h) => h.id) : []);
    const all = new Map([...recent, ...fresh].map((r) => [r.id, r]));
    for (let i = 0; i < all.size; i += 500) await this.history.upsert([...all.values()].slice(i, i + 500).map(toHistory), ['id']);
    return { added: fresh.filter((r) => !known.has(r.id)).length, refreshed: recent.length };
  }

  async summary(days = 7) {
    const [row] = await this.history.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at >= now() - make_interval(days => $1))::int AS recent,
        min(created_at) AS first_at, max(created_at) AS last_at, max(imported_at) AS last_import_at FROM jagota_order_sync_history`, [days]);
    const byStatus = await this.history.query(`SELECT sync_status, count(*)::int AS n FROM jagota_order_sync_history
      WHERE created_at >= now() - make_interval(days => $1) GROUP BY 1 ORDER BY 2 DESC`, [days]);
    return { days, ...row, byStatus };
  }

  list(opts: { status?: string; q?: string; page?: number; limit?: number } = {}) {
    const { page = 1, limit = 50 } = opts;
    const qb = this.history.createQueryBuilder('h')
      .select(['h.id', 'h.orderId', 'h.orderNumber', 'h.shipmentId', 'h.paymentMethod', 'h.paymentSuccess', 'h.syncStatus', 'h.docBook', 'h.docNo', 'h.errorMessage', 'h.createdAt'])
      .orderBy('h.createdAt', 'DESC').skip((page - 1) * limit).take(limit);
    if (opts.status) qb.andWhere('h.syncStatus = :status', { status: opts.status });
    if (opts.q) qb.andWhere('(h.orderNumber ILIKE :q OR h.docNo ILIKE :q OR h.orderId::text = :exact)', { q: `%${opts.q}%`, exact: opts.q });
    return qb.getManyAndCount().then(([items, total]) => ({ items, total, page, limit }));
  }

  async detail(id: string) {
    const row = await this.history.findOneBy({ id });
    if (!row) throw new NotFoundException('sync history row not found');
    return row;
  }
}
