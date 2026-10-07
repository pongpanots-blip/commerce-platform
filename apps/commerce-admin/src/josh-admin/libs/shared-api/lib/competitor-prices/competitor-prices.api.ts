// Competitor prices and scraping live in commerce now: same routes and envelope, called directly.
import { commerceClient as apiClient } from '../api-client/commerce-client';

export type CompetitorCatalogProduct = {
  id: string; sku: string; name: string; brand: string | null; country: string | null;
  storage: string | null; packSize: string | null; sellingUnit: string | null;
  sellingUnitPriceIncVat: number; updatedAt: string;
};
export type CompetitorPriceInput = {
  catalogItemId?: string;
  revision?: number;
  sku: string; ourWeightKg: number; sourceUrl: string; competitorName: string; competitorSku: string;
  competitorWeightKg: number; sourceContext: string; vatIncluded: boolean; collectionAllowed: boolean; autoRefresh: boolean;
};
export type CompetitorPriceComparison = Omit<CompetitorPriceInput, 'sku'> & {
  id: string; revision: number; ourProductVersion: string; ourProduct: CompetitorCatalogProduct;
  /** 'member' = read while logged in to our member account on that site; never mixed with public prices. */
  priceBasis: 'public' | 'member';
  sourceName: string; ourPricePerKgIncVat: number | null; ourPackPriceIncVat: number | null;
  competitorPackPriceIncVat: number | null; competitorPricePerKgIncVat: number | null;
  differencePerKgIncVat: number | null; differenceForOurWeightIncVat: number | null; differencePercent: number | null;
  comparisonReady: boolean; comparisonReason: string | null; verified: boolean;
  matchNote: string; verifiedAt: string | null; verifiedBy: string | null;
  canRefresh: boolean; refreshReason: string | null; observedAt: string | null;
  captureMethod: 'manual' | 'automatic' | null; lastError: string | null;
};

async function unwrap<T>(response: Promise<{ data: { data: T; message: string } }>): Promise<T> {
  const { data } = await response;
  if (data.message) throw new Error(data.message);
  return data.data;
}
export const getCompetitorPrices = () => unwrap(apiClient.get<{ data: CompetitorPriceComparison[]; message: string }>('/competitor-prices'));
/** `per_kg`: our SKU sells by the kilo. `same`: pack weights within 5%. A person still confirms every pair. */
export type CompetitorSkuSuggestion = CompetitorCatalogProduct & { similarityPercent: number; weightMatch: 'same' | 'different' | 'unknown' | 'per_kg'; ourWeightKg: number | null };
export type CompetitorSkuSuggestions = { catalogItem: { id: string; name: string; weightKg: number | null }; suggestions: CompetitorSkuSuggestion[] };
export const getCompetitorSkuSuggestions = (catalogItemId: string) => unwrap(apiClient.get<{ data: CompetitorSkuSuggestions; message: string }>(`/competitor-prices/suggestions/${encodeURIComponent(catalogItemId)}`));
/** The same SKU on the other sites: top collected items per site, not yet paired with this SKU. */
export type CompetitorSiteCandidate = { id: string; name: string; url: string; weightKg: number | null; priceIncVat: number | null; image: string | null;
  /** Raw price text when the site's VAT basis isn't confirmed yet (then `priceIncVat`/`pricePerKgIncVat` are null). */
  priceText: string | null; pricePerKgIncVat: number | null;
  /** Positive = their price/kg is higher = we are cheaper. */
  differencePercent: number | null;
  /** e.g. "เราแพงกว่า 11.11%" or "ยังเทียบราคาต่อกก.ไม่ได้" */
  verdict: string;
  similarityPercent: number; weightMatch: CompetitorSkuSuggestion['weightMatch'] };
export type CompetitorSiteCandidates = { sku: string; name: string; offerSummary: string; ourPricePerKgIncVat: number | null;
  sites: { sourceId: string; sourceName: string; candidates: CompetitorSiteCandidate[] }[] };
/** Next unmatched SKU (after `after`) that resembles something on a site. `item: null` + `done: false` → call again with `after = scannedTo`. */
export type CompetitorMatchQueue = { item: CompetitorSiteCandidates | null; scannedTo: string; done: boolean; counts: { total: number; matched: number; unmatched: number } };
export const getCompetitorMatchQueue = (after = '') => unwrap(apiClient.get<{ data: CompetitorMatchQueue; message: string }>('/competitor-prices/match-queue', { params: after ? { after } : {} }));
export const getCompetitorSiteCandidates = (sku: string) => unwrap(apiClient.get<{ data: CompetitorSiteCandidates; message: string }>(`/competitor-prices/sku/${encodeURIComponent(sku)}/candidates`));
/** One click: create the pair from a collected item and record the caller's confirmation. */
/** `no_data` = paired but waiting for confirmation / price; `unmatched` = our SKU has no competitor pair yet. */
export type CompetitorOverviewPosition = 'we_cheaper' | 'we_pricier' | 'same' | 'no_data' | 'unmatched';
/** `page` (50 rows each) for the screen; leave it out for the Excel export (all rows). */
export type CompetitorOverviewFilters = { site?: string; category?: string; position?: CompetitorOverviewPosition | 'matched'; search?: string; page?: number };
/** One row per Josh SKU. `cheapest` = lowest price/kg among comparison-ready pairs only; positive difference = we are cheaper. */
/** How our SKU is sold, decoded: Approx = weight per order unit varies, so weight and order-unit price are ranges. */
export type CompetitorOurOffer = {
  pricingType: 'approx' | 'fixed'; sellingUnit: string; sellingUnitName: string; orderUnit: string; orderUnitName: string; packSize: string | null;
  packWeightKg: { min: number; max: number } | null; pricePerKgIncVat: { min: number; max: number } | null;
  orderUnitPriceIncVat: { min: number; max: number } | null;
  /** Ready-to-show Thai sentence, e.g. "ขายต่อกิโลกรัม สั่งเป็นลัง · 1 ลัง ≈ 5.4–22.5 กก. (น้ำหนักไม่คงที่) · ฿750/กก. · ประมาณ ฿4,050–฿16,875 ต่อลัง". */
  summary: string;
};
export type CompetitorOverviewRow = {
  sku: string; name: string; category: string; sellingUnit: string | null; ourPricePerKgIncVat: number | null;
  ourOffer: CompetitorOurOffer;
  /** The sentence to read first, e.g. "เราแพงกว่า Makro PRO 11.11% · เรา ฿100/กก. vs ฿90/กก.". */
  verdict: string;
  /** Every site this SKU is compared with, cheapest comparable first. */
  comparisons: {
    pairId: string; sourceName: string; competitorName: string; sourceUrl: string; priceBasis: 'public' | 'member';
    pricePerKgIncVat: number | null; observedAt: string | null; comparable: boolean; position: CompetitorOverviewPosition;
    differencePercent: number | null;
    /** e.g. "฿86 ต่อแพ็ค 1 กก. = ฿86/กก." */
    summary: string;
    /** e.g. "เราแพงกว่า 51.16% (+฿44/กก.)" or "ยังเทียบไม่ได้ — <reason>" */
    verdict: string;
  }[];
  cheapest: { pairId: string; sourceName: string; competitorName: string; sourceUrl: string; pricePerKgIncVat: number;
    packPriceIncVat: number | null; weightKg: number; observedAt: string | null;
    /** e.g. "฿90 ต่อแพ็ค 1 กก. = ฿90/กก." */
    summary: string } | null;
  /** Cheapest member (logged-in) price, reported apart from the public `cheapest`/`position`. */
  cheapestMember: { pairId: string; sourceName: string; competitorName: string; sourceUrl: string; pricePerKgIncVat: number;
    observedAt: string | null; differencePercent: number } | null;
  differencePerKgIncVat: number | null; differencePercent: number | null; position: CompetitorOverviewPosition;
  sites: string[]; readyPairs: number; pendingPairs: number; pairs: CompetitorPriceComparison[];
};
/** Every active Josh SKU. `sites` = one column per site (paired or configured). `totals` ignore the position filter. */
export type CompetitorOverview = { rows: CompetitorOverviewRow[]; total: number; page: number; pageSize: number; sites: string[]; categories: string[];
  totals: { skus: number; weCheaper: number; wePricier: number; same: number; noData: number; unmatched: number } };
const overviewParams = (filters: CompetitorOverviewFilters) => Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
export const getCompetitorOverview = (filters: CompetitorOverviewFilters = {}) => unwrap(apiClient.get<{ data: CompetitorOverview; message: string }>('/competitor-prices/overview', { params: overviewParams(filters) }));
/** Same rows and filters as the overview, as .xlsx (sheet 1 per SKU, sheet 2 every pair). */
export const downloadCompetitorOverviewXlsx = async (filters: CompetitorOverviewFilters = {}): Promise<Blob> =>
  (await apiClient.get('/competitor-prices/overview/export', { params: overviewParams(filters), responseType: 'blob' })).data as Blob;
/** One click: same product + web price includes VAT → verified, VAT set, collected price taken. */
export const confirmCompetitorPrice = (id: string, revision: number, ourProductVersion: string) => unwrap<CompetitorPriceComparison>(apiClient.post(`/competitor-prices/${id}/confirm`, { revision, ourProductVersion }));
export const matchCompetitorCatalogItem = (catalogItemId: string, sku: string) => unwrap<CompetitorPriceComparison>(apiClient.post('/competitor-prices/match', { catalogItemId, sku }));
export const getCompetitorCatalogProduct = (sku: string) => unwrap(apiClient.get<{ data: CompetitorCatalogProduct; message: string }>(`/competitor-prices/catalog/${encodeURIComponent(sku)}`));
export const saveCompetitorPrice = (input: CompetitorPriceInput, id?: string) => unwrap<CompetitorPriceComparison>(id
  ? apiClient.put(`/competitor-prices/${id}`, input) : apiClient.post('/competitor-prices', input));
export const verifyCompetitorPrice = (id: string, matchNote: string, revision: number, ourProductVersion: string) => unwrap<CompetitorPriceComparison>(apiClient.post(`/competitor-prices/${id}/verify`, { matchNote, revision, ourProductVersion }));
export const captureCompetitorPrice = (id: string, priceIncVat: number, observedAt: string, revision: number) => unwrap<CompetitorPriceComparison>(apiClient.post(`/competitor-prices/${id}/price`, { priceIncVat, observedAt, revision }));
export const refreshCompetitorPrice = (id: string) => unwrap<CompetitorPriceComparison>(apiClient.post(`/competitor-prices/${id}/refresh`));
export const deleteCompetitorPrice = (id: string) => unwrap<{ id: string }>(apiClient.delete(`/competitor-prices/${id}`));

export type ScrapingField = { key: string; label: string; selector: string; attribute?: string };
export type ScrapingConfig = {
  startUrls: string[]; pathPrefixes: string[]; mode: 'html' | 'browser'; itemSelector: string;
  fields: ScrapingField[]; currency: string; vatIncluded: boolean; priceContext: string;
  selectedFields?: string[];
  autoCards?: boolean;
  pagination?: 'none' | 'browser';
  /** Run only at night (server window, default 00:00–06:00 Bangkok); long runs pause and resume next night. */
  nightOnly?: boolean;
  /** Pages the site reported at discovery, for 'X of ~Y' progress. */
  expectedPages?: number;
  collectionAllowed: boolean; intervalHours: number; maxPages: number; delayMs: number;
};
export type ScrapingSourceInput = { name: string; origin: string; config: ScrapingConfig; enabled: boolean; revision?: number };
/** Our own member account on a site. Password is write-only; prices read while logged in are member prices. */
export type ScrapingLogin = { url: string; username: string; password?: string };
export type ScrapingSource = ScrapingSourceInput & { id: string; revision: number; configVersion: string;
  login: { url: string; username: string; hasPassword: boolean } | null;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'limited'; lastError: string | null; lastRunAt: string | null;
  /** Running sources only: `reading` now, `waiting_for_night` (night-only, outside 00:00–06:00), or `queued` (starts within seconds). */
  /** reading · waiting_for_night · queued (starts within seconds) · retrying (dropped, retrying itself) · gave_up (dropped 3×, use runScrapingSourceNow) */
  activity: 'reading' | 'catching_up' | 'waiting_for_night' | 'queued' | 'retrying' | 'gave_up' | null;
  /** catchUp: while resuming, the page reached on the way back to `pages` (the site needs "next" clicked page by page). */
  progress: { pages: number; pending: number; successful: number; failed: number; items: number; catchUp: number | null };
};
export type ScrapedCatalogItem = { id: string; sourceId: string; source: ScrapingSource; url: string; pageUrl: string;
  name: string; sku: string; fields: Record<string, string>; priceIncVat: number | null; weightKg: number | null;
  currency: string; observedAt: string; configCurrent: boolean;
};
export type ScrapingPreview = { url: string; observedAt: string; found: number; links: number; sitemap: boolean; message: string;
  items: { url: string; name: string; sku: string; fields: Record<string, string>; price: number | null; currency: string }[];
};
/** Result of reading two listing pages in a browser: `works` = page 2 had new items, so runs page through by themselves. */
export type ScrapingPaging = { pages: { page: number; found: number; fresh: number }[]; totalPages: number | null; works: boolean };
export type ScrapingDiscovery = { ready: boolean; proposal: ScrapingSourceInput | null; preview: ScrapingPreview | null; paging?: ScrapingPaging | null;
  fields: { key: string; label: string; examples: string[]; required: boolean; recommended: boolean }[];
  scannedPages: { url: string; title: string; mode: 'html' | 'browser'; found: number; error: string | null }[]; warnings: string[];
};
/** Master switch for all background collection (trial period). Off = no scheduled starts; running sessions stop after their current page. */
export type ScrapingAutomation = { enabled: boolean; updatedAt: string | null; updatedBy: string | null };
export const getScrapingAutomation = () => unwrap<ScrapingAutomation>(apiClient.get('/competitor-scraping/automation'));
export const setScrapingAutomation = (enabled: boolean) => unwrap<ScrapingAutomation>(apiClient.put('/competitor-scraping/automation', { enabled }));
export const discoverScrapingWebsite = (website: string, collectionAllowed: boolean, login?: ScrapingLogin) => unwrap<ScrapingDiscovery>(apiClient.post('/competitor-scraping/discover', { website, collectionAllowed, ...(login ? { login } : {}) }, { timeout: 150000 }));
/** Omit `password` to keep the stored one. Resets the run: a login changes which prices are read. */
export const saveScrapingLogin = (sourceId: string, login: ScrapingLogin) => unwrap<ScrapingSource>(apiClient.put(`/competitor-scraping/sources/${sourceId}/login`, login));
export const clearScrapingLogin = (sourceId: string) => unwrap<ScrapingSource>(apiClient.delete(`/competitor-scraping/sources/${sourceId}/login`));
export const getScrapingSources = () => unwrap<ScrapingSource[]>(apiClient.get('/competitor-scraping/sources'));
export const saveScrapingSource = (input: ScrapingSourceInput, id?: string) => unwrap<ScrapingSource>(id
  ? apiClient.put(`/competitor-scraping/sources/${id}`, input) : apiClient.post('/competitor-scraping/sources', input));
export const previewScrapingSource = (input: ScrapingSourceInput & { sampleUrl: string }) => unwrap<ScrapingPreview>(apiClient.post('/competitor-scraping/preview', input));
/** `firstLook`: paged sites read their first 20 pages now in the background (night-only sites continue at night). */
export const startScrapingSource = (source: ScrapingSource, restart: boolean, firstLook = false) => unwrap<ScrapingSource>(apiClient.post(`/competitor-scraping/sources/${source.id}/start`, { revision: source.revision, restart, ...(firstLook ? { firstLook } : {}) }));
/** Old link-crawl source → read every listing page each night (checks page 2 first). */
/** Answers at once: the site switches to whole-listing paging; a first look runs in the background (poll the source for its item count). */
export const enableScrapingPaging = (source: ScrapingSource) => unwrap<ScrapingSource>(apiClient.post(`/competitor-scraping/sources/${source.id}/paging`, { revision: source.revision, restart: true }));
/** A night-only site waiting for tonight continues now in the background (hours on a big site). */
export const runScrapingSourceNow = (source: ScrapingSource) => unwrap<ScrapingSource>(apiClient.post(`/competitor-scraping/sources/${source.id}/run-now`, { revision: source.revision, restart: false }));
export const stopScrapingSource = (source: ScrapingSource) => unwrap<ScrapingSource>(apiClient.post(`/competitor-scraping/sources/${source.id}/stop`, { revision: source.revision, restart: false }));
export const getScrapedItems = (sourceId: string, search: string, page: number) => unwrap<{ items: ScrapedCatalogItem[]; total: number; page: number; pageSize: number }>(apiClient.get('/competitor-scraping/items', { params: { sourceId: sourceId || undefined, search, page } }));
export const getScrapedItem = (id: string) => unwrap<ScrapedCatalogItem>(apiClient.get(`/competitor-scraping/items/${id}`));

/** Review grid (step 2): our SKUs by category, 20 per batch, one cell per competitor site. */
export type CompetitorPackSize = { unit: 'kg' | 'l' | 'piece'; min: number; max: number; packCount: number; text: string; unitLabel: string };
export type CompetitorCompareTone = 'cheaper' | 'pricier' | 'close' | 'unknown';
export type CompetitorReviewCell =
  | { site: string; state: 'none'; checked: false }
  | { site: string; state: 'paired' | 'proposed'; checked: boolean; pairId: string | null; itemId: string | null; title: string; url: string;
      image: string | null; size: CompetitorPackSize | null;
      /** e.g. "แพ็ก 2 กก. = ฿192" */ packLine: string;
      /** e.g. "ถ้าซื้อ 1 กก. เท่าเรา: เขา ฿96 · เรา ฿99" */ equivLine: string;
      /** e.g. "พอๆ กัน (ต่าง ฿3)", "เราแพงกว่า ฿19 (16.1%)", "ใส่ขนาดก่อนเทียบ" */ verdict: string;
      tone: CompetitorCompareTone; differencePercent: number | null;
      /** Proposals only: name + size score; ≥ 80 arrives pre-ticked. */ confidencePercent: number | null;
      /** Other packs of the same product paired on this site (the cell shows the cheapest per unit). */ moreSizes: number };
export type CompetitorReviewRow = { sku: string; name: string; image: string | null; offerSummary: string; approx: boolean; ourUnit: 'kg' | 'l' | 'piece';
  ourUnitLabel: string; ourPricePerUnit: number | null; cells: CompetitorReviewCell[] };
export type CompetitorReviewGrid = { categories: { name: string; total: number; reviewed: number }[]; category: string; show: 'todo' | 'done';
  page: number; pageSize: number; total: number; counts: { total: number; reviewed: number }; sites: string[]; rows: CompetitorReviewRow[] };
export type CompetitorTypedSize = { unit: 'kg' | 'g' | 'l' | 'ml' | 'piece'; min: number; max?: number; packCount?: number };
export const getCompetitorReviewGrid = (query: { category?: string; show?: 'todo' | 'done'; page?: number } = {}) =>
  // First call after a nightly run rebuilds the match index over every collected item (~100k): allow 60 s.
  unwrap(apiClient.get<{ data: CompetitorReviewGrid; message: string }>('/competitor-prices/review', { params: Object.fromEntries(Object.entries(query).filter(([, v]) => v)), timeout: 60000 }));
/** Saves one cell at once and returns the SKU's fresh row. off = "not this one" (never proposed again). */
export const setCompetitorReviewCell = (input: { sku: string; on: boolean; itemId?: string; pairId?: string; size?: CompetitorTypedSize }) =>
  unwrap<CompetitorReviewRow>(apiClient.post('/competitor-prices/review/cell', input));
/** Finish a batch: pairs the proposals still ticked and marks the SKUs reviewed. */
export const finishCompetitorReview = (input: { skus: string[]; accept: { sku: string; itemId: string }[] }) =>
  unwrap<{ saved: number; reviewed: number; failed: { sku: string; itemId: string; message: string }[] }>(apiClient.post('/competitor-prices/review/finish', input));
export type CompetitorReviewSearchResult = { itemId: string; title: string; url: string; image: string | null; size: CompetitorPackSize | null;
  packLine: string; equivLine: string; verdict: string; tone: CompetitorCompareTone; differencePercent: number | null };
/** "ค้นหาเอง": searches what we already collected from that site, never the live site. */
export const searchCompetitorReview = (site: string, q: string, sku: string) =>
  unwrap(apiClient.get<{ data: CompetitorReviewSearchResult[]; message: string }>('/competitor-prices/review/search', { params: { site, q, sku } }));
