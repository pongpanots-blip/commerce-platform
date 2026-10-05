import { BadRequestException, Injectable } from '@nestjs/common';
import { JoshReplica } from './josh-replica';

/** A place is "busy" in a window when any hour of today's popular-times curve is above this %. Same as josh. */
export const BUSY_THRESHOLD_PERCENT = 60;
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const BKK_MS = 7 * 3600_000;
/** Today's weekday in Bangkok (josh uses the UTC weekday, which is yesterday before 07:00). */
export const bangkokDayKey = (now = Date.now()) => DAY_KEYS[new Date(now + BKK_MS).getUTCDay()];

export interface RestaurantFilters {
  search?: string; district?: string; category?: string; priceRange?: string;
  minRating?: number; maxRating?: number; minReviewCount?: number; maxReviewCount?: number;
  isEnriched?: boolean; dineIn?: boolean; takeaway?: boolean; delivery?: boolean;
  /** "17-20": busy at some hour in [17, 20) today. */
  busyWindow?: string;
  /** Hide places already linked to a winback (sales) account. */
  excludeHasTmpLead?: boolean;
}

export function parseBusyWindow(raw: string): { startHour: number; endHour: number } | null {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (!m) return null;
  const startHour = Number(m[1]);
  const endHour = Number(m[2]);
  return startHour > 23 || endHour > 24 || startHour >= endHour ? null : { startHour, endHour };
}

const bool = (v: unknown) => (v === true || v === 'true' || v === '1' ? true : v === false || v === 'false' || v === '0' ? false : undefined);
const numOrUndef = (v: unknown, min: number, max: number) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new BadRequestException(`value ${v} must be between ${min} and ${max}`);
  return n;
};
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined);

/** Query-string → filters, validated (the controller and the MCP tool both come through here). */
export function parseRestaurantFilters(q: Record<string, unknown>): RestaurantFilters {
  if (q.busyWindow && !parseBusyWindow(String(q.busyWindow))) {
    throw new BadRequestException(`busyWindow "${q.busyWindow}" must be "<startHour>-<endHour>" within 0-24, start before end`);
  }
  return {
    search: str(q.search), district: str(q.district), category: str(q.category), priceRange: str(q.priceRange),
    minRating: numOrUndef(q.minRating, 0, 5), maxRating: numOrUndef(q.maxRating, 0, 5),
    minReviewCount: numOrUndef(q.minReviewCount, 0, 1e9), maxReviewCount: numOrUndef(q.maxReviewCount, 0, 1e9),
    isEnriched: bool(q.isEnriched), dineIn: bool(q.dineIn), takeaway: bool(q.takeaway), delivery: bool(q.delivery),
    busyWindow: str(q.busyWindow), excludeHasTmpLead: bool(q.excludeHasTmpLead),
  };
}

/** WHERE clause + params, appended after `params` (the list query passes `[today]` for its columns). */
export function restaurantWhere(f: RestaurantFilters, today: string, params: unknown[] = []): { where: string; params: unknown[] } {
  const add = (v: unknown) => `$${params.push(v)}`;
  const w: string[] = [];
  if (f.search) { const p = add(`%${f.search}%`); w.push(`(p.name_th ILIKE ${p} OR p.name_en ILIKE ${p})`); }
  if (f.district) w.push(`p.district = ${add(f.district)}`);
  if (f.category) w.push(`p.raw_category ILIKE ${add(`%${f.category}%`)}`);
  if (f.minRating !== undefined) w.push(`p.rating >= ${add(f.minRating)}`);
  if (f.maxRating !== undefined) w.push(`p.rating <= ${add(f.maxRating)}`);
  if (f.minReviewCount !== undefined) w.push(`p.review_count >= ${add(f.minReviewCount)}`);
  if (f.maxReviewCount !== undefined) w.push(`p.review_count <= ${add(f.maxReviewCount)}`);
  if (f.priceRange) w.push(`p.price_range = ${add(f.priceRange)}`);
  if (f.isEnriched === true) w.push('p.enriched_at IS NOT NULL');
  if (f.isEnriched === false) w.push('p.enriched_at IS NULL');
  if (f.dineIn) w.push('p.dine_in = TRUE');
  if (f.takeaway) w.push('p.takeaway = TRUE');
  if (f.delivery) w.push('p.delivery = TRUE');
  if (f.excludeHasTmpLead) w.push('NOT EXISTS (SELECT 1 FROM winback_account wa WHERE wa.restaurant_place_id = p.id)');
  const win = f.busyWindow ? parseBusyWindow(f.busyWindow) : null;
  if (win) {
    const day = add(today);
    // Unenriched or malformed curves never match — "unknown" must not pass a busyness filter.
    w.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.popular_times -> ${day}) = 'array' THEN p.popular_times -> ${day} ELSE '[]'::jsonb END) WITH ORDINALITY e(v, i)
                    WHERE i - 1 >= ${add(win.startHour)} AND i - 1 < ${add(win.endHour)} AND jsonb_typeof(e.v) = 'number' AND e.v::text::numeric > ${BUSY_THRESHOLD_PERCENT})`);
  }
  return { where: w.length ? `WHERE ${w.join(' AND ')}` : '', params };
}

const COLUMNS = `p.id, COALESCE(p.name_th, p.name_en, '') AS name, p.name_th, p.name_en, p.district, p.raw_category AS category,
  p.lat::float AS lat, p.lng::float AS lng, p.rating::float AS rating, p.review_count, p.price_range,
  p.enriched_at IS NOT NULL AS is_enriched, p.dine_in, p.takeaway, p.delivery,
  CASE WHEN jsonb_typeof(p.popular_times -> $1) = 'array' AND jsonb_array_length(p.popular_times -> $1) >= 24
       THEN (SELECT json_agg(e.v ORDER BY i) FROM jsonb_array_elements(p.popular_times -> $1) WITH ORDINALITY e(v, i) WHERE i BETWEEN 9 AND 24) END AS popular_times_today,
  wa.id AS winback_account_id, wa.customer_code AS winback_customer_code`;
const WINBACK_JOIN = 'LEFT JOIN LATERAL (SELECT id, customer_code FROM winback_account WHERE restaurant_place_id = p.id LIMIT 1) wa ON TRUE';
const ORDER = 'ORDER BY p.name_th ASC NULLS LAST, p.name_en ASC, p.id';

export const MAX_EXPORT_ROWS = 50_000;
const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Market Explorer (josh `restaurant-place`, read-only) moved to commerce: restaurant
 * master data for marketing/sales prospecting, read from josh's READ REPLICA. The
 * enrichment that fills `restaurant_place` still runs in josh until that moves too.
 */
@Injectable()
export class RestaurantPlaces {
  constructor(private readonly replica: JoshReplica) {}

  get available() { return this.replica.configured; }

  async list(f: RestaurantFilters, page = 1, limit = 20, now = Date.now()) {
    const today = bangkokDayKey(now);
    const { where, params } = restaurantWhere(f, today, [today]);
    const summaryWhere = restaurantWhere(f, today);
    const n = params.length;
    const [rows, [summary]] = await Promise.all([
      this.replica.query(`SELECT ${COLUMNS} FROM restaurant_place p ${WINBACK_JOIN} ${where} ${ORDER} LIMIT $${n + 1} OFFSET $${n + 2}`,
        [...params, limit, (page - 1) * limit]),
      this.replica.query(
        `WITH f AS (SELECT p.district, p.raw_category FROM restaurant_place p ${summaryWhere.where})
         SELECT (SELECT count(*) FROM f)::int AS total_count,
                COALESCE((SELECT json_agg(t) FROM (SELECT raw_category AS name, count(*)::int AS count FROM f WHERE raw_category IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5) t), '[]') AS top_categories,
                COALESCE((SELECT json_agg(t) FROM (SELECT district AS name, count(*)::int AS count FROM f WHERE district IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5) t), '[]') AS top_districts`,
        summaryWhere.params),
    ]);
    return { items: rows, summary, page, limit };
  }

  async detail(id: string, now = Date.now()) {
    const [row] = await this.replica.query(
      `SELECT ${COLUMNS}, p.source, p.popular_times, p.opening_hours, p.enriched_at, p.google_place_id, p.fsq_id
         FROM restaurant_place p ${WINBACK_JOIN} WHERE p.id = $2`, [bangkokDayKey(now), id]);
    return row ?? null;
  }

  async csv(f: RestaurantFilters, now = Date.now()) {
    const today = bangkokDayKey(now);
    const { where, params } = restaurantWhere(f, today, [today]);
    const rows = await this.replica.query(
      `SELECT ${COLUMNS}, p.google_place_id, p.fsq_id, p.source FROM restaurant_place p ${WINBACK_JOIN} ${where} ${ORDER} LIMIT ${MAX_EXPORT_ROWS}`, params);
    const head = ['id', 'name_th', 'name_en', 'district', 'category', 'rating', 'review_count', 'price_range', 'lat', 'lng', 'peak_hour_today',
      'dine_in', 'takeaway', 'delivery', 'is_enriched', 'google_place_id', 'fsq_id', 'source', 'winback_account_id', 'winback_customer_code'];
    const peak = (curve: number[] | null) => {
      if (!curve?.length) return '';
      const i = curve.reduce((best, v, k) => (v > curve[best] ? k : best), 0);
      return `${String(i + 8).padStart(2, '0')}:00`;
    };
    const lines = rows.map((r: Record<string, unknown>) => [r.id, r.name_th, r.name_en, r.district, r.category, r.rating, r.review_count, r.price_range,
      r.lat, r.lng, peak(r.popular_times_today as number[] | null), r.dine_in, r.takeaway, r.delivery, r.is_enriched, r.google_place_id, r.fsq_id, r.source,
      r.winback_account_id, r.winback_customer_code].map(csvCell).join(','));
    return [head.join(','), ...lines].join('\n');
  }
}
