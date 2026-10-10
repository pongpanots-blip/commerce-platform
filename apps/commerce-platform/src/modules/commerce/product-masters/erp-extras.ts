/**
 * ERP product extras (spec "ขอข้อมูลสินค้าเพิ่มจาก ERP", 2026-10-09): six optional fields of the ERP product upsert →
 * product_erp_extras columns. Absent = keep, null = clear ([] for the lists), lists replace whole. A bad value skips
 * that field only (named in `invalid`) — the ERP call never fails over it.
 */
export const EXTRA_COLUMNS = ['aging_days', 'min_price', 'min_selling_unit_price', 'substitutes', 'fda_images'] as const;
export type ExtraColumn = (typeof EXTRA_COLUMNS)[number];

export const DOC_TYPES = ['CERT', 'LABEL', 'OTHER'] as const;
export interface Substitute { sku: string; seq: number }
export interface FdaImage { url: string; doc_type: (typeof DOC_TYPES)[number]; name: string | null; expiry_date: string | null }

const MAX_SUBSTITUTES = 20;
const MAX_FDA_IMAGES = 50;
const BAD = Symbol('bad');
type Parsed<T> = T | typeof BAD;

const count = (v: unknown): Parsed<number | null> =>
  v === null ? null : typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2147483647 ? v : BAD;

const money = (v: unknown): Parsed<number | null> =>
  v === null ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e10 ? Math.round(v * 100) / 100 : BAD;

const code = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim().length <= 64 ? v.trim() : null);

function isoDate(v: unknown): string | null | undefined {
  if (v == null) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v) ? v : undefined;
}

function substitutes(v: unknown, sku: string): Parsed<Substitute[]> {
  if (v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_SUBSTITUTES) return BAD;
  const out: Substitute[] = [];
  for (const raw of v) {
    const s = code((raw as { PRODUCT_CODE?: unknown } | null)?.PRODUCT_CODE);
    const seq = (raw as { SEQ?: unknown } | null)?.SEQ;
    if (!s || s === sku || out.some((o) => o.sku === s) || typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return BAD;
    out.push({ sku: s, seq });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

function fdaImages(v: unknown): Parsed<FdaImage[]> {
  if (v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_FDA_IMAGES) return BAD;
  const out: FdaImage[] = [];
  for (const raw of v) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const url = typeof r.URL === 'string' ? r.URL.trim() : '';
    let https = false;
    try { https = new URL(url).protocol === 'https:'; } catch { /* not a URL */ }
    const docType = DOC_TYPES.find((t) => t === r.DOC_TYPE);
    const name = r.NAME == null ? null : typeof r.NAME === 'string' && r.NAME.length <= 255 ? r.NAME.trim() || null : undefined;
    const expiry = isoDate(r.EXPIRY_DATE);
    if (!https || url.length > 2048 || !docType || name === undefined || expiry === undefined) return BAD;
    out.push({ url, doc_type: docType, name, expiry_date: expiry });
  }
  return out;
}

/** One ERP product upsert item → the extras columns it sets, and the ERP field names it had to skip. */
export function buildExtrasPatch(item: Record<string, unknown>): { patch: Partial<Record<ExtraColumn, unknown>>; invalid: string[] } {
  const sku = typeof item.PRODUCT_CODE === 'string' ? item.PRODUCT_CODE.trim() : '';
  const fields: Array<[string, ExtraColumn, (v: unknown) => Parsed<unknown>]> = [
    ['AGING_DAYS', 'aging_days', count],
    ['MIN_PRICE', 'min_price', money],
    ['MIN_SELLING_UNIT_PRICE', 'min_selling_unit_price', money],
    ['SUBSTITUTES', 'substitutes', (v) => substitutes(v, sku)],
    ['FDA_IMAGES', 'fda_images', fdaImages],
  ];
  const patch: Partial<Record<ExtraColumn, unknown>> = {};
  const invalid: string[] = [];
  for (const [erp, column, parse] of fields) {
    if (!(erp in item) || item[erp] === undefined) continue;
    const value = parse(item[erp]);
    if (value === BAD) invalid.push(erp);
    else patch[column] = value;
  }
  return { patch, invalid };
}
