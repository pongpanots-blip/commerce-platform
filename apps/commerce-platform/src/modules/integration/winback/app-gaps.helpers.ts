// Pure rules behind the app gap endpoints — no Nest/TypeORM, so each one is unit-testable.
import { WinbackAccount } from './entities/winback-account.entity';
import { WorklistItem } from './worklist.helpers';
import {
  WinbackHealth,
  WinbackOpportunitySegment,
  WinbackOpportunityTab,
  WinbackQuoteStatus,
  WinbackSignalStatus,
  WinbackStage,
} from './winback.enums';
import { provinceForDistrict, provinceQueryCode } from './winback-geography';
import { resolveSellUnit } from '../../../shared-kernel/helpers/pack-order-price.helper';

const MS_PER_DAY = 86_400_000;
const BANGKOK_OFFSET_MS = 7 * 3_600_000;

/** Today as `YYYY-MM-DD` in Bangkok (the app's calendar day). */
export function bangkokToday(now: Date = new Date()): string {
  return new Date(now.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` of an ISO date/time, read in Bangkok. */
export function bangkokDay(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return bangkokToday(new Date(iso));
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// --- Opportunities (Market Explorer places with no lead yet) ---

/** The `restaurant_place` columns an opportunity is built from (josh and commerce's copy have them all). */
export interface OpportunityPlaceRow {
  id: string;
  name_th: string | null;
  name_en: string | null;
  district: string | null;
  raw_category: string | null;
  rating: number | string | null;
  review_count: number | string | null;
  price_range: string | null;
  enriched_at: Date | string | null;
  /** Set when a winback lead already points at the place (`winback_account.restaurant_place_id`). */
  winback_account_id?: string | null;
}

export interface Opportunity {
  id: string;
  name: string;
  province_code: string | null;
  province_name: string | null;
  district: string | null;
  restaurant_segment: string | null;
  spend_min: number | null;
  spend_max: number | null;
  premium_fit_score: number | null;
  revenue_potential_score: number | null;
  delivery_efficiency_score: number | null;
  sales_priority_score: number | null;
  road_distance_km: number | null;
  estimated_delivery_cost: number | null;
  delivery_cost_ratio: number | null;
  enrichment_status: 'enriched' | 'enriching';
  converted_to_winback: boolean;
  winback_account_id: string | null;
  premium_signals: string[];
  premium_fit_reasons: string[];
  delivery_reasons: string[];
  priority_reason: string | null;
}

/**
 * Spend per head from Google's price text: `฿200–400` → 200/400, `฿1,000+` → 1000/null. Tier-only text
 * (`฿฿`) has no numbers and is not guessed → null (the place lands in "needs enrich").
 */
export function parseSpendRange(priceRange: string | null | undefined): { min: number | null; max: number | null } {
  if (!priceRange) return { min: null, max: null };
  const numbers = (priceRange.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n > 0);
  if (!numbers.length) return { min: null, max: null };
  const min = Math.min(...numbers);
  const max = numbers.length > 1 ? Math.max(...numbers) : null;
  return { min: Math.round(min), max: max === null ? null : Math.round(max) };
}

const SEGMENT_RULES: Array<[RegExp, WinbackOpportunitySegment]> = [
  [/fine\s*dining|omakase|kaiseki|tasting menu/i, WinbackOpportunitySegment.FINE_DINING],
  [/hotel|resort/i, WinbackOpportunitySegment.HOTEL],
  [/steak|grill house|wagyu/i, WinbackOpportunitySegment.STEAKHOUSE],
  [/french|bistro|brasserie/i, WinbackOpportunitySegment.FRENCH],
  [/italian|pizza|trattoria|pasta/i, WinbackOpportunitySegment.ITALIAN],
  [/japanese|sushi|yakiniku|izakaya|ญี่ปุ่น/i, WinbackOpportunitySegment.JAPANESE_PREMIUM],
  [/bakery|cafe|café|coffee|patisserie|เบเกอรี่|คาเฟ่/i, WinbackOpportunitySegment.BAKERY_CAFE],
];

/** Segment from the place's own category text; null when no rule matches (never guessed). */
export function segmentForCategory(category: string | null | undefined): WinbackOpportunitySegment | null {
  if (!category) return null;
  for (const [rule, segment] of SEGMENT_RULES) if (rule.test(category)) return segment;
  return null;
}

/**
 * 0–100 from what Market Explorer measured: rating (60) and review volume (40, saturating at 500).
 * Null until the place is enriched — an unrated place is "unknown", not "low".
 */
export function salesPriorityScore(rating: number | null, reviewCount: number | null, enriched: boolean): number | null {
  if (!enriched || rating === null) return null;
  const ratingPart = Math.max(0, Math.min(rating, 5)) / 5 * 60;
  const reviewPart = Math.min(Math.max(reviewCount ?? 0, 0), 500) / 500 * 40;
  return Math.round(ratingPart + reviewPart);
}

export function placeToOpportunity(row: OpportunityPlaceRow): Opportunity {
  const province = provinceForDistrict(row.district);
  const spend = parseSpendRange(row.price_range);
  const rating = num(row.rating);
  const reviews = num(row.review_count);
  const enriched = !!row.enriched_at;
  const signals: string[] = [];
  if (rating !== null) signals.push(`Google ${rating.toFixed(1)}${reviews !== null ? ` (${reviews} รีวิว)` : ''}`);
  if (row.price_range) signals.push(`ราคา ${row.price_range}`);
  if (row.raw_category) signals.push(row.raw_category);
  return {
    id: row.id,
    name: row.name_th || row.name_en || '-',
    province_code: province ? provinceQueryCode(province.code) : null,
    province_name: province?.name_th ?? null,
    district: row.district,
    restaurant_segment: segmentForCategory(row.raw_category),
    spend_min: spend.min,
    spend_max: spend.max,
    // No source for these yet (premium-fit model, revenue model, routing) — null, never invented.
    premium_fit_score: null,
    revenue_potential_score: null,
    delivery_efficiency_score: null,
    sales_priority_score: salesPriorityScore(rating, reviews, enriched),
    road_distance_km: null,
    estimated_delivery_cost: null,
    delivery_cost_ratio: null,
    enrichment_status: enriched ? 'enriched' : 'enriching',
    converted_to_winback: !!row.winback_account_id,
    winback_account_id: row.winback_account_id ?? null,
    premium_signals: signals,
    premium_fit_reasons: [],
    delivery_reasons: [],
    priority_reason: null,
  };
}

export interface OpportunityFilter {
  province_codes?: string[];
  search?: string;
  min_spend?: number;
  min_premium_fit?: number;
  segments?: string[];
  max_road_km?: number;
  max_delivery_ratio?: number;
  tab?: string;
  page?: number;
  limit?: number;
}

/** Road distance at or under this is "near warehouse" (the app's tab rule). */
export const NEAR_WAREHOUSE_KM = 40;

export function needsEnrich(o: Opportunity): boolean {
  return o.enrichment_status === 'enriching' || o.spend_min === null;
}

export function opportunityTab(o: Opportunity): WinbackOpportunityTab[] {
  if (needsEnrich(o)) return [WinbackOpportunityTab.NEEDS_ENRICH];
  const tabs = [WinbackOpportunityTab.RECOMMENDED];
  if (o.road_distance_km !== null && o.road_distance_km <= NEAR_WAREHOUSE_KM) tabs.push(WinbackOpportunityTab.NEAR_WAREHOUSE);
  return tabs;
}

/** A threshold is skipped when the row has no value for it (unknown ≠ failing), like the app's preview. */
export function matchesOpportunityFilter(o: Opportunity, f: OpportunityFilter): boolean {
  if (o.converted_to_winback) return false;
  if (f.province_codes?.length) {
    const wanted = new Set(f.province_codes.map((c) => (/^\d+$/.test(c) ? `TH-${c}` : c.toUpperCase())));
    if (!o.province_code || !wanted.has(o.province_code)) return false;
  }
  if (f.search?.trim()) {
    const q = f.search.trim().toLowerCase();
    const hay = [o.name, o.province_name, o.district, o.restaurant_segment, ...o.premium_signals]
      .filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (f.segments?.length && (!o.restaurant_segment || !f.segments.includes(o.restaurant_segment))) return false;
  if (f.min_spend != null && o.spend_min !== null && o.spend_min < f.min_spend) return false;
  if (f.min_premium_fit != null && o.premium_fit_score !== null && o.premium_fit_score < f.min_premium_fit) return false;
  if (f.max_road_km != null && o.road_distance_km !== null && o.road_distance_km > f.max_road_km) return false;
  if (f.max_delivery_ratio != null && o.delivery_cost_ratio !== null && o.delivery_cost_ratio > f.max_delivery_ratio) return false;
  return true;
}

export function pageOpportunities(all: Opportunity[], f: OpportunityFilter) {
  const filtered = all.filter((o) => matchesOpportunityFilter(o, f));
  const counts = { recommended: 0, near_warehouse: 0, needs_enrich: 0 };
  for (const o of filtered) for (const t of opportunityTab(o)) counts[t] += 1;
  const tab = (f.tab ?? WinbackOpportunityTab.RECOMMENDED) as WinbackOpportunityTab;
  const inTab = filtered
    .filter((o) => opportunityTab(o).includes(tab))
    .sort((a, b) => (b.sales_priority_score ?? -1) - (a.sales_priority_score ?? -1) || a.name.localeCompare(b.name));
  const page = Math.max(1, f.page ?? 1);
  const limit = Math.max(1, f.limit ?? 20);
  return {
    items: inTab.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total: inTab.length },
    counts,
  };
}

// --- Revenue signals ---

/** What the rep did with a signal (`winback_app_record` kind `signal_action`, one per account). */
export interface SignalAction {
  status: WinbackSignalStatus;
  outcome?: string | null;
  note?: string | null;
  snoozed_until?: string | null;
  reason?: string | null;
  acted_at: string;
}

/**
 * An action stops applying once the customer orders after it: that is a new situation, and the signal (if
 * the baseline still flags the account) comes back open.
 */
export function signalActionApplies(action: SignalAction | null | undefined, lastOrderAt: Date | string | null): action is SignalAction {
  if (!action) return false;
  if (!lastOrderAt) return true;
  return new Date(lastOrderAt).getTime() <= new Date(action.acted_at).getTime();
}

export interface RevenueSignal extends Omit<WorklistItem, 'last_order_at'> {
  last_order_at: Date | string | null;
  status: WinbackSignalStatus;
  outcome: string | null;
  note: string | null;
  snoozed_until: string | null;
  reason: string | null;
}

export function toRevenueSignal(item: WorklistItem, action: SignalAction | null): RevenueSignal {
  return {
    ...item,
    status: action?.status ?? WinbackSignalStatus.OPEN,
    outcome: action?.outcome ?? null,
    note: action?.note ?? null,
    snoozed_until: action?.snoozed_until ?? null,
    reason: action?.reason ?? null,
  };
}

/** `status=open` hides rows snoozed into the future; other statuses match exactly. */
export function signalVisible(signal: RevenueSignal, status: string | undefined, today: string): boolean {
  if (!status) return true;
  if (signal.status !== status) return false;
  if (status === WinbackSignalStatus.OPEN && signal.snoozed_until && signal.snoozed_until > today) return false;
  return true;
}

export type CustomerState = 'active' | 'at_risk' | 'dormant' | 'reactivated' | 'lost';

export function customerState(account: Pick<WinbackAccount, 'health' | 'stage'>): CustomerState {
  if (account.stage === WinbackStage.LOST || account.stage === WinbackStage.REJECTED) return 'lost';
  switch (account.health) {
    case WinbackHealth.DORMANT: return 'dormant';
    case WinbackHealth.WATCH: return 'at_risk';
    case WinbackHealth.REACTIVATING: return 'reactivated';
    default: return 'active';
  }
}

/**
 * Lead detail "revenue context", from the account's own reorder baseline. `{}` when the account has no order
 * history (the app hides the section). `top_products` stays empty: the order copies carry no line items.
 */
export function revenueContext(
  account: WinbackAccount,
  recommendedAction: string | null,
  now: Date = new Date(),
): Record<string, unknown> {
  if (!account.last_order_at) return {};
  const state = customerState(account);
  const monthly = num(account.avg_monthly_revenue);
  return {
    customer_state: state,
    last_order_at: account.last_order_at,
    days_since_last_order: Math.max(0, Math.floor((now.getTime() - new Date(account.last_order_at).getTime()) / MS_PER_DAY)),
    median_reorder_interval_days: num(account.median_reorder_interval_days),
    delay_ratio: num(account.delay_ratio),
    historical_monthly_revenue: monthly,
    revenue_at_risk: state === 'active' ? null : monthly,
    top_products: [] as string[],
    recommended_action: recommendedAction,
  };
}

// --- Quotes (record-only) ---

/** `expired` is read off `valid_until`; accepted / declined never expire. */
export function quoteStatusAt(status: string, validUntil: string, today: string): string {
  if (status === WinbackQuoteStatus.ACCEPTED || status === WinbackQuoteStatus.DECLINED) return status;
  return validUntil < today ? WinbackQuoteStatus.EXPIRED : status;
}

/**
 * draft → in_review (anyone with access); in_review → follow_up | draft (manager: approve / return);
 * follow_up → accepted | declined. Anything else needs a new revision (PUT).
 */
export function quoteMoveError(from: string, to: string, isManager: boolean): string | null {
  const allowed: Record<string, string[]> = {
    [WinbackQuoteStatus.DRAFT]: [WinbackQuoteStatus.IN_REVIEW],
    [WinbackQuoteStatus.IN_REVIEW]: [WinbackQuoteStatus.FOLLOW_UP, WinbackQuoteStatus.DRAFT],
    [WinbackQuoteStatus.FOLLOW_UP]: [WinbackQuoteStatus.ACCEPTED, WinbackQuoteStatus.DECLINED],
  };
  if (!(allowed[from] ?? []).includes(to)) return `ย้ายใบเสนอราคาจาก ${from} ไป ${to} ไม่ได้`;
  if (from === WinbackQuoteStatus.IN_REVIEW && !isManager) return 'เฉพาะ manager ที่อนุมัติหรือตีกลับใบเสนอราคาได้';
  return null;
}

// --- Appointment plan ---

/** End must be after the start and at most 24 h later. Null when fine, else the reason. */
export function appointmentEndError(scheduledAt: Date | null, endAt: string | null | undefined): string | null {
  if (!endAt) return null;
  if (!scheduledAt) return 'นัดหมายนี้ยังไม่มีเวลาเริ่ม (scheduled_at) — ตั้ง end_at ไม่ได้';
  const ms = new Date(endAt).getTime() - new Date(scheduledAt).getTime();
  if (ms <= 0) return 'end_at ต้องหลังเวลาเริ่มนัด';
  if (ms > MS_PER_DAY) return 'นัดหมายยาวเกิน 24 ชั่วโมงไม่ได้';
  return null;
}

// --- Product catalog ---

/** One catalog row as each side's catalog query returns it (josh product tables / commerce's josh catalog copy). */
export interface CatalogRow {
  id: string;
  sku: string;
  name_th: string | null;
  name_en: string | null;
  brand_name: string | null;
  category_name: string | null;
  selling_unit: string | null;
  order_taking_unit: string | null;
  sub_packing_unit: string | null;
  pack_size: string | null;
  units_per_box: string | null;
  weight_per_unit: string | null;
  /** josh's selling_price (the catalog copy's wire name `ordering_price`): the red price per sell unit. */
  selling_price: number | string | null;
  image_url: string | null;
}

/** The one unit a product is sold in today: its sell unit (`resolveSellUnit`) at `selling_price`. */
export const CATALOG_SELLING_UNIT_ID = 'selling';

export interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  name_en: string | null;
  brand_name: string | null;
  category_name: string | null;
  image_url: string | null;
  units: Array<{ id: string; label: string; unit_price: number | null }>;
}

export function toCatalogProduct(row: CatalogRow): CatalogProduct {
  const sell = resolveSellUnit(row);
  return {
    id: row.id,
    sku: row.sku,
    name: row.name_th || row.name_en || row.sku,
    name_en: row.name_en,
    brand_name: row.brand_name,
    category_name: row.category_name,
    image_url: row.image_url,
    units: [{ id: CATALOG_SELLING_UNIT_ID, label: sell.qty === 1 ? sell.unit || 'หน่วย' : `${sell.qty} ${sell.unit}`, unit_price: num(row.selling_price) }],
  };
}
