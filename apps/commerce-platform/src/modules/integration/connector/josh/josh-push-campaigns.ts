import { Injectable, NotFoundException } from '@nestjs/common';
import { JoshReplica } from './josh-replica';
import { JoshErpLogs } from './josh-erp-logs';

/** josh `push_campaigns` row, all columns, snake_case — the same `data` josh's admin API returns. */
const CAMPAIGN_COLUMNS = `id, name, notification_type, title, body, title_en, body_en, image_url, deep_link, deep_link_web, audience,
  ab_enabled, ab_variant_b, status, scheduled_at, sent_at, stats, created_by, last_error, created_at, updated_at`;
type Campaign = Record<string, any> & { stats?: { queued?: number; sent?: number; clicked?: number } }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** josh notification-delivery.service `rate`. */
const rate = (numerator: number, denominator: number) => (denominator <= 0 ? 0 : Math.round((numerator / denominator) * 10000) / 10000);

/**
 * josh push campaigns (marketing push / in-app blasts), READ side only: list, KPIs, one campaign and
 * how its sends went. Campaigns come from josh's replica (`push_campaigns`), per-user delivery results
 * from josh's Mongo (`josh_logs.notification_deliveries`). Logic copied from josh
 * push-campaign.service (overviewKpis, delivery) and notification-delivery.service (stats, list).
 *
 * Creating, scheduling and SENDING stay in josh: sending writes josh's in-app `notifications`
 * rows and dedupe keys, which commerce cannot do from a replica — running it in both would double-send.
 */
@Injectable()
export class JoshPushCampaigns {
  constructor(private readonly replica: JoshReplica, private readonly logs: JoshErpLogs) {}

  get available() { return this.replica.configured; }

  list(): Promise<Campaign[]> {
    return this.replica.query(`SELECT ${CAMPAIGN_COLUMNS} FROM push_campaigns ORDER BY created_at DESC`);
  }

  async findOne(id: string): Promise<Campaign> {
    const [row] = await this.replica.query<Campaign>(`SELECT ${CAMPAIGN_COLUMNS} FROM push_campaigns WHERE id = $1`, [id]);
    if (!row) throw new NotFoundException('ไม่พบแคมเปญ');
    return row;
  }

  /** josh overviewKpis. Note josh's stats.clicked is never written, so clickRate is 0 there too — real clicks are in deliveryStats. */
  async overview() {
    const rows = await this.replica.query<Campaign>(`SELECT ${CAMPAIGN_COLUMNS} FROM push_campaigns ORDER BY created_at DESC LIMIT 200`);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    let sentToday = 0;
    let scheduled = 0;
    let totalQueued = 0;
    let totalSent = 0;
    let totalClicked = 0;
    for (const row of rows) {
      if (row.status === 'scheduled') scheduled += 1;
      totalQueued += row.stats?.queued ?? 0;
      totalSent += row.stats?.sent ?? 0;
      totalClicked += row.stats?.clicked ?? 0;
      if (row.sent_at && new Date(row.sent_at) >= todayStart) sentToday += row.stats?.sent ?? 0;
    }
    return { campaigns: rows.length, scheduled, sentToday, totalQueued, totalSent, totalClicked,
      clickRate: totalSent > 0 ? Number((totalClicked / totalSent).toFixed(4)) : 0 };
  }

  /** josh `GET /admin/push-campaigns/:id/delivery`: the row, its pipeline stats, Mongo delivery stats and the latest 50 deliveries. */
  async delivery(id: string) {
    const row = await this.findOne(id);
    const from = new Date(row.created_at);
    const to = new Date();
    const [deliveryStats, recentDeliveries] = this.logs.configured
      ? await Promise.all([this.stats(from, to, row.notification_type), this.recent(from, to, row.notification_type)])
      : [null, []];
    return { campaign: row, pipeline: row.stats, deliveryStats, recentDeliveries,
      ...(this.logs.configured ? {} : { note: 'josh\'s log database is not connected (JOSH_MONGO_URL) — delivery results unavailable' }) };
  }

  private async stats(from: Date, to: Date, type: string) {
    const c = await this.logs.logsCollection('notification_deliveries');
    const match = { sent_at: { $gte: from, $lte: to }, type };
    const counters = {
      attempted: { $sum: 1 },
      sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
      skipped: { $sum: { $cond: [{ $eq: ['$status', 'skipped'] }, 1, 0] } },
      failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
      clicked: { $sum: { $cond: [{ $ifNull: ['$clicked_at', false] }, 1, 0] } },
    };
    const opts = { maxTimeMS: 20_000 };
    const [byTypeChannel, byDay, reasons] = await Promise.all([
      c.aggregate([{ $match: match }, { $group: { _id: { type: '$type', channel: '$channel' }, ...counters } }, { $sort: { attempted: -1 } }], opts).toArray(),
      c.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$sent_at' } }, sent: counters.sent, failed: counters.failed, clicked: counters.clicked } },
        { $sort: { _id: 1 } }], opts).toArray(),
      c.aggregate([{ $match: { ...match, status: { $in: ['skipped', 'failed'] } } }, { $group: { _id: '$reason', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }], opts).toArray(),
    ]);
    const rows = byTypeChannel.map((r) => ({ type: r._id.type, channel: r._id.channel, attempted: r.attempted, sent: r.sent, skipped: r.skipped,
      failed: r.failed, clicked: r.clicked, deliveryRate: rate(r.sent, r.attempted), clickRate: rate(r.clicked, r.sent) }));
    const totals = rows.reduce((a, r) => ({ attempted: a.attempted + r.attempted, sent: a.sent + r.sent, skipped: a.skipped + r.skipped, failed: a.failed + r.failed, clicked: a.clicked + r.clicked }),
      { attempted: 0, sent: 0, skipped: 0, failed: 0, clicked: 0 });
    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      totals: { ...totals, deliveryRate: rate(totals.sent, totals.attempted), clickRate: rate(totals.clicked, totals.sent) },
      byTypeChannel: rows,
      byDay: byDay.map((r) => ({ date: r._id, sent: r.sent, failed: r.failed, clicked: r.clicked })),
      topSkipAndFailReasons: reasons.map((r) => ({ reason: r._id ?? 'unknown', count: r.count })),
    };
  }

  private async recent(from: Date, to: Date, type: string) {
    const c = await this.logs.logsCollection('notification_deliveries');
    const rows = await c.find({ type, sent_at: { $gte: from, $lte: to } }, { maxTimeMS: 15_000 }).sort({ _id: -1 }).limit(50).toArray();
    return rows.map((row) => ({
      id: String(row._id), notificationId: row.notification_id, userId: row.user_id, type: row.type, category: row.category, channel: row.channel,
      status: row.status, reason: row.reason ?? null, providerMessageId: row.provider_message_id ?? null, linkTarget: row.link_target ?? null,
      sentAt: new Date(row.sent_at).toISOString(), clickedAt: row.clicked_at ? new Date(row.clicked_at).toISOString() : null, clickPlatform: row.click_platform ?? null,
    }));
  }
}
