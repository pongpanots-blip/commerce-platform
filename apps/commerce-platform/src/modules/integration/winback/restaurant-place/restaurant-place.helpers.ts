// Pure logic for the Market Explorer restaurant endpoints — no Nest imports,
// so every rule here is unit-testable without wiring a module.
import { JoshRestaurantPlace as RestaurantPlace } from '../josh-replica-tables';
import { WinbackAccount } from '../entities/winback-account.entity';
import {
  RestaurantPlaceListItemDto,
  RestaurantPlaceListSummaryDto,
} from './dto/restaurant-place-list-response.dto';
import { RestaurantPlaceDetailDto } from './dto/restaurant-place-detail-response.dto';
import { RestaurantPlaceFiltersDto } from './dto/restaurant-place-filters.dto';

/**
 * A place "matches a busy window" when at least one hour of today's
 * popular-times curve exceeds this occupancy percentage.
 */
export const BUSY_THRESHOLD_PERCENT = 60;

/** How many categories/districts the list summary strip shows. */
const SUMMARY_TOP_LIMIT = 5;

const DAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type DayKey = (typeof DAY_KEYS)[number];

export interface BusyWindow {
  /** Inclusive start hour (0-23). */
  startHour: number;
  /** Exclusive end hour (1-24). */
  endHour: number;
}

/**
 * Parses a `"17-20"`-style window. Returns null for anything malformed —
 * empty, non-numeric, out of range, or a window that doesn't move forward.
 */
export function parseBusyWindow(raw: string): BusyWindow | null {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (!match) return null;
  const startHour = Number(match[1]);
  const endHour = Number(match[2]);
  if (startHour > 23 || endHour > 24 || startHour >= endHour) return null;
  return { startHour, endHour };
}

/** Lowercase weekday key for a date, matching popular_times' day keys. */
export function dayKeyForDate(date: Date): DayKey {
  return DAY_KEYS[date.getUTCDay()];
}

/**
 * True when today's curve exceeds {@link BUSY_THRESHOLD_PERCENT} at any hour
 * inside `[startHour, endHour)`. Unenriched or malformed curves never match —
 * "unknown" must not pass a busyness filter.
 */
export function matchesBusyWindow(
  popularTimes: Record<string, unknown> | null,
  window: BusyWindow,
  today: DayKey,
): boolean {
  const curve = popularTimes?.[today];
  if (!Array.isArray(curve)) return false;
  for (let hour = window.startHour; hour < window.endHour; hour++) {
    const value = curve[hour];
    if (typeof value === 'number' && value > BUSY_THRESHOLD_PERCENT) return true;
  }
  return false;
}

/** Postgres returns numeric columns as strings; coerce, keep null as null. */
export function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Rough seating capacity from public review volume — display-only heuristic. */
export function estimateTables(reviewCount: number | null | undefined): number | null {
  if (reviewCount == null || reviewCount <= 0) return null;
  return Math.max(5, Math.min(200, Math.round(Math.sqrt(reviewCount) * 2)));
}

/** Today's popular-times buckets 08:00–23:00 (16 slots). */
export function popularTimesTodayBuckets(
  popularTimes: Record<string, unknown> | null,
  today: DayKey,
): number[] | null {
  const curve = popularTimes?.[today];
  if (!Array.isArray(curve) || curve.length < 24) return null;
  return (curve as number[]).slice(8, 24);
}

export type WinbackPlaceLink = Pick<
  WinbackAccount,
  'id' | 'restaurant_place_id' | 'customer_code'
>;

function topCounts(values: (string | null)[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, SUMMARY_TOP_LIMIT);
}

/** Summary strip over the whole filtered set (not just the current page). */
export function buildListSummary(rows: RestaurantPlace[]): RestaurantPlaceListSummaryDto {
  return {
    totalCount: rows.length,
    topCategories: topCounts(rows.map((r) => r.raw_category)),
    topDistricts: topCounts(rows.map((r) => r.district)),
  };
}

export function toListItem(
  row: RestaurantPlace,
  opts?: {
    today?: DayKey;
    winbackLink?: WinbackPlaceLink | null;
  },
): RestaurantPlaceListItemDto {
  const today = opts?.today ?? dayKeyForDate(new Date());
  const link = opts?.winbackLink ?? null;
  return {
    id: row.id,
    name: row.name_th ?? row.name_en ?? '',
    nameTh: row.name_th,
    nameEn: row.name_en,
    district: row.district,
    category: row.raw_category,
    lat: toNumberOrNull(row.lat) ?? 0,
    lng: toNumberOrNull(row.lng) ?? 0,
    rating: toNumberOrNull(row.rating),
    reviewCount: row.review_count,
    priceRange: row.price_range,
    isEnriched: row.enriched_at !== null,
    popularTimesToday: popularTimesTodayBuckets(row.popular_times, today),
    estimatedTables: estimateTables(row.review_count),
    winbackAccountId: link?.id ?? null,
    winbackCustomerCode: link?.customer_code ?? null,
  };
}

export function toDetail(
  row: RestaurantPlace,
  opts?: { today?: DayKey; winbackLink?: WinbackPlaceLink | null },
): RestaurantPlaceDetailDto {
  return {
    ...toListItem(row, opts),
    nameTh: row.name_th,
    nameEn: row.name_en,
    source: row.source,
    popularTimes: row.popular_times,
    openingHours: row.opening_hours,
    serviceOptions: {
      dineIn: row.dine_in,
      takeaway: row.takeaway,
      delivery: row.delivery,
    },
    enrichedAt: row.enriched_at ? row.enriched_at.toISOString() : null,
  };
}

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Peak hour (08:00–23:00) for today's curve, or empty when unavailable. */
export function peakHourToday(
  popularTimes: Record<string, unknown> | null,
  today: DayKey,
): string {
  const curve = popularTimes?.[today];
  if (!Array.isArray(curve) || curve.length < 24) return '';
  const peakIndex = curve.reduce(
    (best, value, index) =>
      typeof value === 'number' && value > (curve[best] as number) ? index : best,
    0,
  );
  return `${String(peakIndex).padStart(2, '0')}:00`;
}

/** CSV export for the current filtered restaurant set (UTF-8, no BOM). */
export function buildRestaurantPlacesCsv(
  rows: RestaurantPlace[],
  today: DayKey = dayKeyForDate(new Date()),
  linkByPlaceId: Map<string, WinbackPlaceLink> = new Map(),
): string {
  const headers = [
    'id',
    'name_th',
    'name_en',
    'district',
    'category',
    'rating',
    'review_count',
    'price_range',
    'lat',
    'lng',
    'peak_hour_today',
    'dine_in',
    'takeaway',
    'delivery',
    'is_enriched',
    'google_place_id',
    'fsq_id',
    'source',
    'winback_account_id',
    'winback_customer_code',
  ];

  const lines = [
    headers.join(','),
    ...rows.map((row) => {
      const link = linkByPlaceId.get(row.id);
      return [
        row.id,
        row.name_th,
        row.name_en,
        row.district,
        row.raw_category,
        toNumberOrNull(row.rating),
        row.review_count,
        row.price_range,
        toNumberOrNull(row.lat),
        toNumberOrNull(row.lng),
        peakHourToday(row.popular_times, today),
        row.dine_in,
        row.takeaway,
        row.delivery,
        row.enriched_at !== null,
        row.google_place_id,
        row.fsq_id,
        row.source,
        link?.id ?? '',
        link?.customer_code ?? '',
      ]
        .map((value) => escapeCsvCell(value))
        .join(',');
    }),
  ];

  return lines.join('\n');
}
