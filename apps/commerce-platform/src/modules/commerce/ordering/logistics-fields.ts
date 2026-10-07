import { BadRequestException } from '@nestjs/common';

/**
 * Stage 4f: the per-SKU logistics fields commerce owns, with josh's product_inventory column names. Staff write them
 * (the ERP never does; Jagota's sync also writes `unit_ratio`, which josh puts back once commerce owns it).
 * `delivery_dates` is josh's weekday list ([{ day: 'MONDAY' }, …]); null = every day (josh's default).
 */
export const LOGISTICS_KEYS = ['unit_ratio', 'sub_packing_unit', 'product_unit', 'expected_restock_at', 'delivery_dates'] as const;
export type LogisticsKey = (typeof LOGISTICS_KEYS)[number];

export const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;

/** josh's weekday list (or a comma list / array of names) → canonical rows in week order; every day / none → null. */
export function normDeliveryDates(raw: unknown): Array<{ day: string }> | null {
  if (raw == null || raw === '') return null;
  const items = typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw : null;
  if (!items) throw new BadRequestException('delivery_dates: ต้องเป็นรายการวัน (MONDAY, TUESDAY …)');
  const days = new Set<string>();
  for (const item of items) {
    const name = String(typeof item === 'object' && item ? (item as { day?: unknown }).day ?? '' : item ?? '').trim().toUpperCase();
    if (!name) continue;
    if (!(WEEKDAYS as readonly string[]).includes(name)) throw new BadRequestException(`delivery_dates: ไม่รู้จักวัน "${name}"`);
    days.add(name);
  }
  if (days.size === 0 || days.size === WEEKDAYS.length) return null;
  return WEEKDAYS.filter((d) => days.has(d)).map((day) => ({ day }));
}

/** josh parseExpectedRestockAt: empty → null, else any date `new Date` reads; stored as ISO. */
export function normRestockAt(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw new BadRequestException('expected_restock_at: ต้องเป็นวันที่');
  return d.toISOString();
}

/** One logistics key's value as commerce stores it (400 on a bad value). Strings: varchar(50), empty → null. */
export function normLogistics(key: LogisticsKey, raw: unknown): unknown {
  if (key === 'delivery_dates') return normDeliveryDates(raw);
  if (key === 'expected_restock_at') return normRestockAt(raw);
  if (raw != null && typeof raw !== 'string' && typeof raw !== 'number') throw new BadRequestException(`${key}: ต้องเป็นข้อความ`);
  const s = raw == null ? '' : String(raw).trim();
  if (s.length > 50) throw new BadRequestException(`${key}: ยาวเกิน 50 ตัวอักษร`);
  return s || null;
}

/** The product form's logistics keys (validated) and the rest of the form. */
export function splitLogistics(body: Record<string, unknown>): { logistics: Record<string, unknown>; rest: Record<string, unknown> } {
  const logistics: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if ((LOGISTICS_KEYS as readonly string[]).includes(k)) logistics[k] = normLogistics(k as LogisticsKey, v);
    else rest[k] = v;
  }
  return { logistics, rest };
}

/** A josh row's logistics columns → the `fields` commerce stores (import and parity). */
export function logisticsFromJosh(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(LOGISTICS_KEYS.map((k) => [k, normLogistics(k, row[k])]));
}

/** josh's products (drafts too: staff set these before a product goes live) with the five columns. */
export const JOSH_LOGISTICS_SQL = `SELECT product_inventory_sku AS sku, ${LOGISTICS_KEYS.join(', ')} FROM product_inventory`;
