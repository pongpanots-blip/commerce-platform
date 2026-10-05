// Copied from josh apps/backend/src/app/api-log/api-log-query.service.ts (origin/main d84d692b).
// Only the Mongo access changed: josh injects a mongoose Model; commerce passes `mongooseLike(collection)`
// (josh-api-logs.ts), which offers the same find / aggregate / countDocuments / findById calls.
import { BadRequestException } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import type { MongooseLikeModel } from '../josh-api-logs';
import {
  CONTEXTS_BY_SOURCE,
  isVisibleApiLogDoc,
  normalizeApiLogDoc,
  VISIBLE_API_LOG_CONTEXTS,
  type ApiLogSource,
} from './api-log-normalize.util';
import { ApiLogQueryDto } from './dto/api-log-query.dto';

const HOUR_MS = 3_600_000;
const DEFAULT_WINDOW_MS = 24 * HOUR_MS;
const MAX_WINDOW_MS = 7 * 24 * HOUR_MS;
const DEFAULT_LIMIT = 50;
const TOP_ENDPOINT_MIN_COUNT = 3;
const TOP_ENDPOINT_LIMIT = 20;

// winston-mongodb rows keep the logged fields at `metadata.*` or, depending on
// how they were written, one level deeper at `metadata.metadata.*` — read both.
const field = (name: string) => ({
  $ifNull: [`$metadata.metadata.${name}`, `$metadata.${name}`],
});
const DURATION_EXPR = { $ifNull: [field('duration_ms'), 0] };
const METHOD_EXPR = field('method');
const URL_EXPR = field('url');
const ERROR_EXPR = { $eq: [field('is_success'), false] };

const HIDE_ERP_INBOUND = {
  $nor: [
    { 'metadata.url': /^\/api\/erp/ },
    { 'metadata.metadata.url': /^\/api\/erp/ },
    { message: /ERP inbound/i },
  ],
};

const round1 = (value: number) => Math.round(value * 10) / 10;

/** `/api/orders/3f2a…-…/items?x=1` → `/api/orders/:id/items` */
export function normalizeApiRoute(path: string): string {
  return path
    .split('?')[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
    .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

const LIST_PROJECTION = {
  context: 1,
  message: 1,
  metadata: 1,
  createdAt: 1,
  timestamp: 1,
} as const;

export type TimingStep = { label: string; ms: number };

export type ApiLogListItem = {
  id: string;
  method: string;
  url: string;
  statusCode: number;
  isSuccess: boolean;
  durationMs: number;
  message: string;
  createdAt: string;
  source: ApiLogSource;
  requestId: string | null;
  userId: string | null;
};

export type ApiLogDetail = ApiLogListItem & {
  errorMessage?: string;
  response?: unknown;
  payload?: unknown;
  query?: unknown;
  ip?: string;
  steps: TimingStep[];
};

export type ApiLogStats = {
  from: string;
  to: string;
  bucketMs: number;
  buckets: Array<{
    start: string;
    count: number;
    errors: number;
    avgMs: number;
    maxMs: number;
  }>;
  topEndpoints: Array<{
    method: string;
    route: string;
    count: number;
    errors: number;
    avgMs: number;
    maxMs: number;
  }>;
};

/**
 * ทางอ่านของ general API log (หน้า admin)
 *
 * อ่านจาก `api_logs` (capped 10 MB) — history สั้นมากเมื่อเทียบกับ erp_inbound_logs
 * กรองเฉพาะ context HttpLoggingInterceptor และตัด /api/erp/* ออก
 */
export class ApiLogQueryService {
  constructor(private readonly model?: MongooseLikeModel) {}

  async list(query: ApiLogQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIMIT;

    if (!this.model) {
      return { items: [], total: 0, page, limit };
    }

    // If requestId is given, return all rows with that requestId (ignore time window)
    if (query.requestId) {
      return this.listByRequestId(query);
    }

    const { from, to } = this.resolveWindow(query);
    const filter = this.buildFilter(query, from, to);
    // Visibility is part of `filter`, so skip/limit pages are always full.
    const [total, docs] = await Promise.all([
      this.model.countDocuments(filter),
      this.model
        .aggregate([
          { $match: filter },
          { $addFields: { _durationMs: DURATION_EXPR } },
          {
            $sort:
              query.sort === 'slowest'
                ? { _durationMs: -1, createdAt: -1 }
                : { createdAt: -1, timestamp: -1 },
          },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          { $project: LIST_PROJECTION },
        ])
        .allowDiskUse(true)
        .exec(),
    ]);

    return {
      items: docs.map((doc: Record<string, unknown>) => this.toListItem(doc)),
      total,
      page,
      limit,
    };
  }

  private async listByRequestId(query: ApiLogQueryDto) {
    if (!this.model || !query.requestId) {
      return { items: [], total: 0, page: 1, limit: DEFAULT_LIMIT };
    }

    // requestId is new and always written through the same Winston logger,
    // so it only ever lives at the nested path — one indexed lookup.
    const filter = { 'metadata.metadata.requestId': query.requestId };

    const docs: any[] = await this.model
      .find(filter, LIST_PROJECTION)
      .sort({ createdAt: -1 })
      .lean();

    const items = docs
      .filter((doc) => isVisibleApiLogDoc(doc))
      .map((doc) => this.toListItem(doc));

    return { items, total: items.length, page: 1, limit: 1000 };
  }

  async stats(query: ApiLogQueryDto): Promise<ApiLogStats> {
    if (!this.model) {
      const now = new Date();
      return {
        from: now.toISOString(),
        to: now.toISOString(),
        bucketMs: 0,
        buckets: [],
        topEndpoints: [],
      };
    }

    const { from, to } = this.resolveWindow(query);
    const filter = this.buildFilter(query, from, to);
    const windowMs = to.getTime() - from.getTime();
    const bucketMs = Math.max(1000, Math.ceil(windowMs / 60)); // ~60 buckets

    const bucketDocs = await this.model
      .aggregate([
        { $match: filter },
        {
          $group: {
            _id: {
              $toDate: {
                $multiply: [
                  { $floor: { $divide: [{ $toLong: '$createdAt' }, bucketMs] } },
                  bucketMs,
                ],
              },
            },
            count: { $sum: 1 },
            errors: { $sum: { $cond: [ERROR_EXPR, 1, 0] } },
            avgMs: { $avg: DURATION_EXPR },
            maxMs: { $max: DURATION_EXPR },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .exec();
    const buckets = bucketDocs.map((doc) => ({
      start: new Date(doc._id).toISOString(),
      count: doc.count,
      errors: doc.errors,
      avgMs: round1(doc.avgMs ?? 0),
      maxMs: doc.maxMs ?? 0,
    }));

    // Group by method + path in Mongo, then fold ids into `:id` here —
    // $replaceAll only takes plain strings, not regexes.
    const pathDocs = await this.model
      .aggregate([
        { $match: filter },
        {
          $group: {
            _id: {
              method: METHOD_EXPR,
              path: {
                $arrayElemAt: [{ $split: [{ $ifNull: [URL_EXPR, ''] }, '?'] }, 0],
              },
            },
            count: { $sum: 1 },
            errors: { $sum: { $cond: [ERROR_EXPR, 1, 0] } },
            totalMs: { $sum: DURATION_EXPR },
            maxMs: { $max: DURATION_EXPR },
          },
        },
      ])
      .exec();
    const byRoute = new Map<
      string,
      { method: string; route: string; count: number; errors: number; totalMs: number; maxMs: number }
    >();
    for (const doc of pathDocs) {
      const method = String(doc._id.method ?? '');
      const route = normalizeApiRoute(String(doc._id.path ?? ''));
      if (!route) continue;
      const key = `${method} ${route}`;
      const acc = byRoute.get(key) ?? { method, route, count: 0, errors: 0, totalMs: 0, maxMs: 0 };
      acc.count += doc.count;
      acc.errors += doc.errors;
      acc.totalMs += doc.totalMs ?? 0;
      acc.maxMs = Math.max(acc.maxMs, doc.maxMs ?? 0);
      byRoute.set(key, acc);
    }
    const topEndpoints = [...byRoute.values()]
      .filter((row) => row.count >= TOP_ENDPOINT_MIN_COUNT)
      .map(({ totalMs, ...row }) => ({ ...row, avgMs: round1(totalMs / row.count) }))
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, TOP_ENDPOINT_LIMIT);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      bucketMs,
      buckets,
      topEndpoints,
    };
  }

  async findOne(id: string) {
    if (!this.model) {
      return null;
    }

    if (!ObjectId.isValid(id)) {
      return null;
    }

    const doc: any = await this.model.findById(id).lean();
    if (!doc || !isVisibleApiLogDoc(doc)) {
      return null;
    }

    return this.toDetail(doc);
  }

  private resolveWindow(query: ApiLogQueryDto) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - DEFAULT_WINDOW_MS);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException(
        'ช่วงเวลาไม่ถูกต้อง: from/to ต้องเป็นวันที่ที่ parse ได้',
      );
    }

    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('ช่วงเวลาไม่ถูกต้อง: from ต้องมาก่อน to');
    }

    if (to.getTime() - from.getTime() > MAX_WINDOW_MS) {
      throw new BadRequestException(
        'ช่วงเวลากว้างเกิน 7 วัน กรุณาแคบช่วงลงแล้วค้นใหม่',
      );
    }

    return { from, to };
  }

  private buildFilter(
    query: ApiLogQueryDto,
    from: Date,
    to: Date,
  ): Record<string, unknown> {
    const contexts = [...VISIBLE_API_LOG_CONTEXTS];
    const andClauses: Record<string, unknown>[] = [
      {
        $or: [
          { context: { $in: contexts } },
          { 'metadata.context': { $in: contexts } },
        ],
      },
      {
        $or: [
          { createdAt: { $gte: from, $lte: to } },
          { timestamp: { $gte: from, $lte: to } },
        ],
      },
    ];

    // Same rule as isVisibleApiLogDoc: ERP inbound rows live in
    // erp_inbound_logs — keep them out of this view, in Mongo so pages stay full.
    andClauses.push(HIDE_ERP_INBOUND);

    const statusFilter = this.buildStatusFilter(query.status);
    if (statusFilter) {
      andClauses.push(statusFilter);
    }

    if (query.source && query.source !== 'all') {
      const sourceContexts = CONTEXTS_BY_SOURCE[query.source];
      andClauses.push({
        $or: [
          { context: { $in: sourceContexts } },
          { 'metadata.context': { $in: sourceContexts } },
        ],
      });
    }

    if (query.method && query.method !== 'all') {
      const methodPattern = new RegExp(`^${query.method}$`, 'i');
      andClauses.push({
        $or: [
          { 'metadata.method': methodPattern },
          { 'metadata.metadata.method': methodPattern },
          { message: new RegExp(`\\[${query.method}\\]`, 'i') },
        ],
      });
    }

    if (query.q) {
      const pattern = new RegExp(escapeRegex(query.q), 'i');
      andClauses.push({
        $or: [
          { message: pattern },
          { 'metadata.url': pattern },
          { 'metadata.metadata.url': pattern },
        ],
      });
    }

    if (query.minDurationMs) {
      andClauses.push({
        $or: [
          { 'metadata.duration_ms': { $gte: query.minDurationMs } },
          { 'metadata.metadata.duration_ms': { $gte: query.minDurationMs } },
        ],
      });
    }

    if (query.userId) {
      andClauses.push({ 'metadata.metadata.userId': query.userId });
    }

    return { $and: andClauses };
  }

  private buildStatusFilter(
    status: ApiLogQueryDto['status'],
  ): Record<string, unknown> | null {
    if (!status || status === 'all') {
      return null;
    }

    const ranges: Record<string, [number, number]> = {
      '2xx': [200, 300],
      '4xx': [400, 500],
      '5xx': [500, 600],
    };
    const [min, max] = ranges[status];

    return {
      $or: [
        { 'metadata.statusCode': { $gte: min, $lt: max } },
        { 'metadata.metadata.statusCode': { $gte: min, $lt: max } },
      ],
    };
  }

  private toListItem(doc: Record<string, unknown>): ApiLogListItem {
    const normalized = normalizeApiLogDoc(doc);
    const meta = (normalized.metadata || {}) as Record<string, unknown>;

    return {
      id: String(doc._id),
      method: normalized.method,
      url: normalized.url,
      statusCode: normalized.statusCode,
      isSuccess: normalized.isSuccess,
      durationMs: normalized.durationMs,
      message: normalized.message,
      createdAt: normalized.createdAt.toISOString(),
      source: normalized.source,
      requestId: (typeof meta.requestId === 'string' ? meta.requestId : null) || null,
      userId: (typeof meta.userId === 'string' ? meta.userId : null) || null,
    };
  }

  private toDetail(doc: Record<string, unknown>): ApiLogDetail {
    const normalized = normalizeApiLogDoc(doc);
    const meta = normalized.metadata || {};

    return {
      ...this.toListItem(doc),
      errorMessage: normalized.errorMessage,
      response: normalized.response,
      payload: normalized.payload,
      query: normalized.query,
      ip: normalized.ip,
      steps: Array.isArray(meta.steps) ? meta.steps : [],
    };
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
