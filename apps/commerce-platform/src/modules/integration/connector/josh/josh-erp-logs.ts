import { BadRequestException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Collection, Document, MongoClient, ObjectId } from 'mongodb';

const HOUR = 3600_000;
const MAX_WINDOW_MS = 7 * 24 * HOUR;
/** Only josh's ERP rows: the collection also holds every HTTP / winston log line, which have no top-level `endpoint`. */
const ERP_ONLY = { endpoint: { $exists: true, $type: 'string' }, method: { $exists: true } };
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface ErpLogFilters { endpoint?: string; status?: 'ok' | 'fail' | 'all'; from?: string; to?: string; q?: string }

/** `from`/`to` → a window of at most 7 days; default the last 24h. Same rules as josh `ErpLogQueryService`. */
export function erpLogWindow(from?: string, to?: string, now = Date.now()) {
  const end = to ? Date.parse(to) : now;
  const start = from ? Date.parse(from) : end - 24 * HOUR;
  if (Number.isNaN(end) || Number.isNaN(start)) throw new BadRequestException('from/to must be ISO dates');
  if (start > end) throw new BadRequestException('from must be before to');
  if (end - start > MAX_WINDOW_MS) throw new BadRequestException('at most 7 days per query');
  return { from: new Date(start), to: new Date(end) };
}

export function erpLogQuery(f: ErpLogFilters, now = Date.now()): Document {
  const w = erpLogWindow(f.from, f.to, now);
  const query: Document = { ...ERP_ONLY, createdAt: { $gte: w.from, $lte: w.to } };
  if (f.endpoint) query.endpoint = f.endpoint;
  if (f.status === 'ok') query.isSuccess = true;
  if (f.status === 'fail') query.isSuccess = false;
  if (f.q?.trim()) {
    const re = new RegExp(escapeRegex(f.q.trim().slice(0, 100)), 'i');
    query.$or = [{ summary: re }, { searchText: re }];
  }
  return query;
}

/**
 * josh's ERP inbound log (josh `erp-log`), read straight from josh's Mongo `josh_logs.api_logs`
 * with a READ-ONLY user (JOSH_MONGO_URL). josh keeps writing it; commerce never writes or
 * creates indexes there (josh owns the 14-day TTL). Payloads hold prices and customer codes
 * unredacted, so every route over this is admin-only.
 */
@Injectable()
export class JoshErpLogs implements OnModuleDestroy {
  private readonly logger = new Logger(JoshErpLogs.name);
  private client?: MongoClient;

  get configured() { return !!process.env.JOSH_MONGO_URL?.trim(); }

  /** A collection in josh's log DB (josh_logs) — read-only user; also used for josh's notification_deliveries. */
  async logsCollection(name: string): Promise<Collection> {
    if (!this.client) {
      // Standalone mongo (no replica set) → primary. Small pool, fail fast when josh's Mongo is down.
      this.client = new MongoClient(process.env.JOSH_MONGO_URL!.trim(), {
        maxPoolSize: 2, serverSelectionTimeoutMS: 3000, socketTimeoutMS: 20_000, readPreference: 'primary', appName: 'commerce-josh-erp-logs',
      });
    }
    // db name from the URL path, else josh's default
    return this.client.db(process.env.JOSH_MONGO_DB?.trim() || undefined).collection(name);
  }

  private collection() { return this.logsCollection('api_logs'); }

  async list(f: ErpLogFilters, page = 1, limit = 50) {
    const c = await this.collection();
    const query = erpLogQuery(f);
    const [docs, total] = await Promise.all([
      c.find(query, { projection: { endpoint: 1, method: 1, statusCode: 1, isSuccess: 1, durationMs: 1, summary: 1, createdAt: 1 }, maxTimeMS: 15_000 })
        .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      c.countDocuments(query, { maxTimeMS: 15_000 }),
    ]);
    return {
      items: docs.map(({ _id, ...d }) => ({ id: String(_id), ...d, createdAt: (d.createdAt as Date)?.toISOString?.() ?? d.createdAt })),
      total, page, limit,
    };
  }

  /** One ERP log row with its payloads. josh returns any api_logs row by id; this only returns ERP rows. */
  async get(id: string) {
    if (!ObjectId.isValid(id)) return null;
    const c = await this.collection();
    const doc = await c.findOne({ _id: new ObjectId(id), ...ERP_ONLY }, { projection: { __v: 0 }, maxTimeMS: 15_000 });
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return { id: String(_id), ...rest, createdAt: (rest.createdAt as Date)?.toISOString?.() ?? rest.createdAt };
  }

  /** Per endpoint: how many ERP calls josh received in [from, to) and how many failed, plus the latest failures. */
  async summary(from: Date, to: Date) {
    const c = await this.collection();
    const match = { ...ERP_ONLY, createdAt: { $gte: from, $lt: to } };
    const [byEndpoint, recentFailures] = await Promise.all([
      c.aggregate([
        { $match: match },
        { $group: { _id: '$endpoint', total: { $sum: 1 }, failed: { $sum: { $cond: ['$isSuccess', 0, 1] } }, avgMs: { $avg: '$durationMs' } } },
        { $sort: { failed: -1, total: -1 } }, { $limit: 30 },
      ], { maxTimeMS: 20_000 }).toArray(),
      c.find({ ...match, isSuccess: false }, { projection: { endpoint: 1, statusCode: 1, summary: 1, errorMessage: 1, createdAt: 1 }, maxTimeMS: 15_000 })
        .sort({ createdAt: -1 }).limit(10).toArray(),
    ]);
    return {
      byEndpoint: byEndpoint.map((r) => ({ endpoint: r._id, total: r.total, failed: r.failed, avg_ms: Math.round(r.avgMs ?? 0) })),
      recentFailures: recentFailures.map(({ _id, ...r }) => ({ id: String(_id), ...r, errorMessage: typeof r.errorMessage === 'string' ? r.errorMessage.slice(0, 300) : r.errorMessage })),
      retention: 'josh keeps these 14 days (API_LOG_RETENTION_DAYS)',
    };
  }

  async onModuleDestroy() {
    await this.client?.close().catch((e) => this.logger.warn(`close: ${e}`));
  }
}
