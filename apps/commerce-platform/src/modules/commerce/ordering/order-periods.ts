/**
 * Stage 4f: the ERP's supplier order rounds (`PUT /erp/order-periods`), mapped the way josh's
 * SupplierOrderPeriodService.upsertFromErp maps them. One push = every open round of each SUP_CODE in it; a stored round
 * of that supplier missing from the push is closed ('C').
 */
export type OrderPeriodRow = {
  sup_code: string;
  erp_order_period: string;
  /** YYYY-MM-DD */
  date_from: string;
  date_to: string;
  /** ISO instant or null */
  close_at: string | null;
  status: string;
};

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** DATE_FROM / DATE_TO are calendar dates: take the digits, never route a naive date through the process timezone. */
export function toDateOnly(value: unknown): string | null {
  if (value == null || value === '') return null;
  const trimmed = String(value).trim();
  const dateOnly = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (dateOnly) return dateOnly[1];
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** EST_CLOSE_DATE is Bangkok wall-clock time without a zone; an explicit offset / Z is trusted as is. */
export function toBangkokTimestamp(value: unknown): string | null {
  if (value == null || value === '') return null;
  const trimmed = String(value).trim();
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const naive = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(trimmed);
  if (naive) {
    const [, y, mo, da, h, mi, s] = naive.map(Number);
    return new Date(Date.UTC(y, mo - 1, da, h, mi, s) - BANGKOK_OFFSET_MS).toISOString();
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The ERP push → rows (incomplete ones skipped, like josh; a key repeated in one push: the last one wins). */
export function mapErpOrderPeriods(body: unknown): OrderPeriodRow[] {
  if (!Array.isArray(body)) return [];
  const byKey = new Map<string, OrderPeriodRow>();
  for (const raw of body) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const sup = r.SUP_CODE == null ? '' : String(r.SUP_CODE).trim();
    const period = r.ORDER_PERIOD == null ? '' : String(r.ORDER_PERIOD).trim();
    const from = toDateOnly(r.DATE_FROM);
    const to = toDateOnly(r.DATE_TO);
    if (!sup || !period || !from || !to) continue;
    const status = r.STATUS == null ? '' : String(r.STATUS).trim();
    byKey.set(`${sup}\u0000${period}`, {
      sup_code: sup.slice(0, 50), erp_order_period: period.slice(0, 50), date_from: from, date_to: to,
      close_at: toBangkokTimestamp(r.EST_CLOSE_DATE), status: (status || 'N').slice(0, 5),
    });
  }
  return [...byKey.values()];
}

/** josh's rows in the same shape (import and parity). */
export const JOSH_ORDER_PERIODS_SQL = `SELECT sup_code, erp_order_period, to_char(date_from, 'YYYY-MM-DD') AS date_from,
    to_char(date_to, 'YYYY-MM-DD') AS date_to, close_at, status
  FROM supplier_order_period ORDER BY sup_code, erp_order_period`;
