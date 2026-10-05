/**
 * Mirrors SQL `UPPER(TRIM(...))` semantics used by every query in the winback
 * module: trims leading/trailing whitespace and uppercases, but does NOT
 * collapse internal whitespace runs (SQL `TRIM` doesn't either). This must
 * stay in lockstep with the SQL-side normalization so a code like
 * `"AB  12"` groups/matches identically whether compared in JS or SQL.
 */
export function normalizeCustomerCode(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.trim().toUpperCase();
}

/** Strip to digits for Thai tax / company registration matching. */
export function normalizeRegisterNumber(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw).replace(/\D/g, '');
}

export function computeInactiveDays(lastOrderAt: Date | null, now: Date): number {
  if (!lastOrderAt) return 0;
  const diffMs = now.getTime() - lastOrderAt.getTime();
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export interface MatchResult {
  josh_user_id: string | null;
  josh_company_id: string | null;
  matchCount: number;
}

export type ImportBucket = 'matched' | 'ambiguous' | 'new';

export function classifyImportRow(
  match: MatchResult,
  _matchedByRegisterOnly = false,
): ImportBucket {
  if (match.matchCount > 1) return 'ambiguous';
  // Unique company tax-id / custcode match both count as matched (app registered).
  if (match.matchCount === 1) return 'matched';
  return 'new';
}

export interface ParsedImportRow {
  customer_code: string;
  display_name: string | null;
  phone: string | null;
  register_number: string | null;
  last_order_at: string | null;
  lifetime_spend_hint: number | null;
}

const IMPORT_COLUMNS = [
  'customer_code',
  'display_name',
  'phone',
  'register_number',
  'last_order_at',
  'lifetime_spend_hint',
] as const;

/**
 * Splits a single CSV line into fields, RFC4180-lite:
 * - A field starting with `"` is read as a quoted field: commas inside it are
 *   part of the value, a doubled quote `""` unescapes to a single `"`, and the
 *   surrounding quotes are stripped. Quoted values are NOT trimmed.
 * - Any other field is read up to the next comma and trimmed, matching the
 *   previous (naive) behavior for unquoted values.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  const len = line.length;
  let i = 0;

  while (i <= len) {
    if (line[i] === '"') {
      let value = '';
      i++; // skip opening quote
      while (i < len) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            value += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          value += line[i];
          i++;
        }
      }
      // lenient: absorb any stray trailing characters before the next comma
      while (i < len && line[i] !== ',') {
        value += line[i];
        i++;
      }
      fields.push(value);
    } else {
      const start = i;
      while (i < len && line[i] !== ',') i++;
      fields.push(line.slice(start, i).trim());
    }

    if (i < len && line[i] === ',') {
      i++;
      continue;
    }
    break;
  }

  return fields;
}

export function parseImportCsv(csv: string): {
  rows: ParsedImportRow[];
  errors: { line: number; message: string }[];
} {
  const rows: ParsedImportRow[] = [];
  const errors: { line: number; message: string }[] = [];
  const rawLines = csv.split(/\r?\n/);
  if (rawLines.every((l) => l.trim().length === 0)) return { rows, errors };

  const header = parseCsvLine(rawLines[0]).map((h) => h.toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  for (let i = 1; i < rawLines.length; i++) {
    const line = rawLines[i];
    const lineNumber = i + 1; // original 1-based line number in the input text
    if (line.trim().length === 0) continue; // skip blank rows without shifting later line numbers

    const cells = parseCsvLine(line);
    const get = (name: string): string => {
      const at = idx(name);
      return at >= 0 && at < cells.length ? cells[at] : '';
    };
    const code = get('customer_code');
    if (!code) {
      errors.push({ line: lineNumber, message: 'missing customer_code' });
      continue;
    }
    const spendRaw = get('lifetime_spend_hint');
    const spend = spendRaw ? Number(spendRaw) : null;
    rows.push({
      customer_code: code,
      display_name: get('display_name') || null,
      phone: get('phone') || null,
      register_number: get('register_number') || null,
      last_order_at: get('last_order_at') || null,
      lifetime_spend_hint: spend !== null && !Number.isNaN(spend) ? spend : null,
    });
  }
  return { rows, errors };
}

export { IMPORT_COLUMNS };

/**
 * One `ORDER BY` term: expression, direction, and optional NULL placement.
 *
 * NULLs go in the third slot, not glued onto the expression: TypeORM appends the
 * direction after the expression it is given, so `'a.x DESC NULLS LAST'` would
 * render as `a.x DESC NULLS LAST DESC` and fail.
 */
export type PoolOrder = [
  expr: string,
  dir: 'ASC' | 'DESC',
  nulls?: 'NULLS FIRST' | 'NULLS LAST',
];

/**
 * The pool list's `ORDER BY`, as data so it can be asserted without a database.
 *
 * The default view has to serve two populations at once. Winback's own job is
 * dormant-customer-first, hence `inactive_days DESC`. But leads from the landing
 * contact form arrive with `inactive_days = 0`, which under that sort puts them
 * on the *last* page — and the Pool screen ships no sort control (it never sends
 * `sortKey`), so the backend default is the only order sales ever sees. So an
 * unclaimed intake lead is pinned above everything until someone takes it, and
 * the dormant-first list below it is untouched. Claiming one drops it straight
 * back into normal position.
 *
 * An explicit `sortKey` from the caller means the caller has decided; it gets
 * exactly what it asked for with no pin and no tiebreak.
 *
 * ponytail: the pin is an expression, so it can't use an index — fine at pool
 * size (tens of thousands). If this ever sorts slowly, make it a real column.
 */
/**
 * Columns that are NULL when unknown rather than zero. Sorting them DESC in
 * Postgres puts NULLs first by default, so a manager sorting "most overdue" would
 * open a page of accounts whose overdue-ness we cannot even compute.
 */
const NULLABLE_SORT_KEYS = new Set([
  'delay_ratio',
  'avg_monthly_revenue',
  'median_reorder_interval_days',
  'last_order_at',
]);

export function poolOrderBy(
  sortKey: string | undefined,
  sortOrder: 'ASC' | 'DESC' | undefined,
): PoolOrder[] {
  if (sortKey) {
    const dir = sortOrder ?? 'DESC';
    // Deterministic tail: two accounts with the same delay_ratio must not swap
    // between pages while a manager works down the list.
    const tail: PoolOrder = ['a.create_date', 'DESC'];
    return NULLABLE_SORT_KEYS.has(sortKey)
      ? [[`a.${sortKey}`, dir, 'NULLS LAST'], tail]
      : [[`a.${sortKey}`, dir], tail];
  }
  return [
    ["(a.lifecycle = 'tmp' AND a.assigned_sales_user_id IS NULL)", 'DESC'],
    ['a.inactive_days', sortOrder ?? 'DESC'],
    // Ties every intake row at 0 with no deterministic order otherwise.
    ['a.create_date', 'DESC'],
  ];
}

export interface UserCodeRow {
  id: string;
  company_id: string | null;
  custcode: string | null;
  legacy_custcode: string | null;
  last_app_login_at?: Date | string | null;
}

export interface UserIndex {
  matchByCode(code: string): MatchResult;
  lastAppLoginAt(userId: string): Date | null;
}

/**
 * Index the users table by customer code, in one pass.
 *
 * Winback sync used to resolve each account with its own query. Against the ERP
 * history that is ~9.5K accounts, so the lookup has to be a map. Same matching
 * rule as `MatchingService.matchByCode`: a code held by more than one distinct
 * user is ambiguous and links to neither.
 */
export function buildUserIndex(rows: UserCodeRow[]): UserIndex {
  const byCode = new Map<string, { id: string; company_id: string | null }[]>();
  const loginById = new Map<string, Date | null>();

  for (const row of rows) {
    loginById.set(row.id, row.last_app_login_at ? new Date(row.last_app_login_at) : null);
    for (const raw of [row.custcode, row.legacy_custcode]) {
      const code = normalizeCustomerCode(raw);
      if (!code) continue;
      const bucket = byCode.get(code) ?? [];
      // One user can carry the same code in both columns. Count them once, or a
      // single user looks ambiguous and silently ends up unlinked.
      if (!bucket.some((entry) => entry.id === row.id)) {
        bucket.push({ id: row.id, company_id: row.company_id });
      }
      byCode.set(code, bucket);
    }
  }

  return {
    matchByCode(code: string): MatchResult {
      const matches = byCode.get(normalizeCustomerCode(code)) ?? [];
      return {
        josh_user_id: matches.length === 1 ? matches[0].id : null,
        josh_company_id: matches.length === 1 ? matches[0].company_id : null,
        matchCount: matches.length,
      };
    },
    lastAppLoginAt: (id: string) => loginById.get(id) ?? null,
  };
}
