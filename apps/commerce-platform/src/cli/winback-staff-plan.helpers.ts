/** Pure migration planning. Reports expose ids and masked addresses, never stored payloads or credentials. */
import { normalizeStaffRole } from '../shared-kernel/presentation/auth.decorators';

/** Commerce accounts the winback guard lets in. Only these may become a rep's canonical id. */
export const WINBACK_LOGIN_ROLES: readonly string[] = ['sale', 'sales_manager', 'admin'];
export const isWinbackLoginAccount = (row: StaffRow) =>
  (row.status ?? 'active') === 'active' && WINBACK_LOGIN_ROLES.includes(normalizeStaffRole(row.role));
export interface StaffRow { id: string; email: string; role: string; status?: string; is_active?: boolean; user_type?: string }
export interface StaffLink { josh_user_id: string; commerce_user_id: string }
export type StoredRow = { id: string; kind?: string; payload?: Record<string, unknown>; record_key?: string | null; [field: string]: unknown };
export const STAFF_COLUMNS = {
  company_sales_reps: ['assigned_sales_user_id'],
  winback_account: ['assigned_sales_user_id', 'created_by_sales_user_id'],
  winback_activity: ['sales_user_id'],
  winback_sales_target: ['sales_user_id', 'created_by'],
  winback_app_record: ['sales_user_id', 'created_by'],
  winback_stage_history: ['changed_by'],
  winback_meeting_ack: ['discussed_by'],
} as const;
export type StaffTable = keyof typeof STAFF_COLUMNS;
export type StaffSnapshot = Partial<Record<StaffTable, StoredRow[]>>;

export const normalizedEmail = (email: string) => email.trim().toLowerCase();
export function maskEmail(email: string): string {
  const value = normalizedEmail(email);
  const parts = value.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return '***';
  const domain = parts[1].split('.');
  return `${parts[0].slice(0, Math.min(2, Math.max(0, parts[0].length - 1)))}***@${domain[0].length > 1 ? domain[0][0] : ''}***${domain.length > 1 ? '.' + domain.at(-1) : ''}`;
}

// Explicit paths by record kind. '*' traverses only a known array; names, notes, record ids and free text stay intact.
export const PAYLOAD_ID_PATHS: Record<string, string[][]> = {
  team: [['sales_user_ids', '*']],
  joint_visit: [['organizer_id'], ['participant_id']],
  quote: [['events', '*', 'actor_id']],
  quote_dispatch: [['actor_id']],
  daily_report: [['reviewed_by']],
  opportunity_meta: [['owner_sales_user_id']],
  opportunity_collab: [
    ...['requester_id', 'recipient_id', 'resolved_by_id', 'from_owner_id'].map(field => ['requests', '*', field]),
    ...['author_id', 'recipient_id'].map(field => ['messages', '*', field]),
  ],
  opp_collab_log: [['actor_id'], ['target_user_id'], ['changes', 'owner', 'from'], ['changes', 'owner', 'to']],
};
const canonicalId = (value: string) => value.trim().toLowerCase();
const mappedId = (value: unknown, links: ReadonlyMap<string, string>): unknown =>
  typeof value === 'string' ? links.get(canonicalId(value)) ?? value : value;

function transformPath(value: unknown, path: readonly string[], links: ReadonlyMap<string, string>): unknown {
  if (!path.length) return mappedId(value, links);
  const [field, ...rest] = path;
  if (field === '*') return Array.isArray(value) ? value.map(item => transformPath(item, rest, links)) : value;
  if (!value || typeof value !== 'object' || Array.isArray(value) || !(field in value)) return value;
  const obj = value as Record<string, unknown>;
  return { ...obj, [field]: transformPath(obj[field], rest, links) };
}

export function rewriteStaffRow(table: StaffTable, row: StoredRow, links: ReadonlyMap<string, string>): StoredRow {
  let next = { ...row };
  for (const field of STAFF_COLUMNS[table]) next[field] = mappedId(row[field], links);
  if (table !== 'winback_app_record') return next;
  for (const path of PAYLOAD_ID_PATHS[row.kind ?? ''] ?? []) {
    next = { ...next, payload: transformPath(next.payload, path, links) as Record<string, unknown> };
  }
  // Natural keys contain a staff id too. Changing columns alone would orphan drafts, saved places and daily reports.
  if (typeof row.record_key === 'string') {
    if (row.kind === 'discovery_query') next.record_key = mappedId(row.record_key, links) as string;
    if (['activity_draft', 'saved_place', 'daily_report'].includes(row.kind ?? '')) {
      const split = row.record_key.indexOf('|');
      if (split >= 0) next.record_key = String(mappedId(row.record_key.slice(0, split), links)) + row.record_key.slice(split);
    }
  }
  return next;
}

export interface RowRewrite { table: StaffTable; id: string; changes: Record<string, unknown> }
export function planStaffRewrites(snapshot: StaffSnapshot, links: readonly StaffLink[]): RowRewrite[] {
  const map = new Map(links.filter(link => link.josh_user_id !== link.commerce_user_id)
    .map(link => [canonicalId(link.josh_user_id), canonicalId(link.commerce_user_id)]));
  // Chained mappings would rewrite an already canonical id on a second run. Fail closed before any write.
  for (const commerceId of map.values()) if (map.has(commerceId)) throw new Error('Overlapping staff ids require manual resolution');
  const updates: RowRewrite[] = [];
  for (const table of Object.keys(STAFF_COLUMNS) as StaffTable[]) {
    for (const row of snapshot[table] ?? []) {
      const next = rewriteStaffRow(table, row, map);
      const fields = [...STAFF_COLUMNS[table], ...(table === 'winback_app_record' ? ['payload', 'record_key'] : [])];
      const changes: Record<string, unknown> = {};
      for (const field of fields) if (JSON.stringify(next[field]) !== JSON.stringify(row[field])) changes[field] = next[field];
      if (Object.keys(changes).length) updates.push({ table, id: row.id, changes });
    }
  }
  // Refuse natural-key/target collisions rather than silently delete or merge user records.
  for (const table of ['winback_app_record', 'winback_sales_target'] as const) {
    const changed = new Map(updates.filter(update => update.table === table).map(update => [update.id, update.changes]));
    const keys = new Set<string>();
    for (const original of snapshot[table] ?? []) {
      const row = { ...original, ...changed.get(original.id) };
      if (table === 'winback_app_record' && row.record_key == null) continue;
      const key = table === 'winback_app_record' ? `${row.kind}:${row.record_key}` : `${row.sales_user_id}:${row.period_month}`;
      if (keys.has(key)) throw new Error(`Canonical staff ids collide in ${table}; resolve duplicate records before applying`);
      keys.add(key);
    }
  }
  return updates;
}

export function activeJoshReps(rows: readonly StaffRow[]): StaffRow[] {
  return rows.filter(row => row.is_active === true && row.user_type === 'internal' && ['sale', 'sales', 'manager'].includes(row.role));
}

export function classifyStaff(josh: readonly StaffRow[], commerce: readonly StaffRow[]) {
  const group = (rows: readonly StaffRow[]) => {
    const groups = new Map<string, StaffRow[]>();
    for (const row of rows) { const email = normalizedEmail(row.email ?? ''); groups.set(email, [...(groups.get(email) ?? []), row]); }
    return groups;
  };
  // A portal developer, a disabled account or a non-sales staff login with the same email is never linked: the rep could
  // not sign in to winback with it, and the backfill would move their rows onto it. Reported as `ineligible` instead.
  const joshGroups = group(josh), commerceGroups = group(commerce.filter(isWinbackLoginAccount));
  const otherGroups = group(commerce.filter(row => !isWinbackLoginAccount(row)));
  const matched: StaffLink[] = [], unmatched: string[] = [], ineligible: string[] = [], ambiguous: Array<{ joshIds: string[]; commerceIds: string[] }> = [];
  for (const [email, rows] of joshGroups) {
    const candidates = email ? commerceGroups.get(email) ?? [] : [];
    const others = email ? otherGroups.get(email) ?? [] : [];
    if (rows.length > 1 || candidates.length > 1) ambiguous.push({ joshIds: rows.map(row => row.id), commerceIds: candidates.map(row => row.id) });
    else if (candidates.length === 1) matched.push({ josh_user_id: rows[0].id, commerce_user_id: candidates[0].id });
    else if (others.length) ineligible.push(rows[0].id);
    else unmatched.push(rows[0].id);
  }
  return { matched, unmatched, ambiguous, ineligible };
}

/** Admins are linked only when they appear in a stored identity field (owner or audit actor). */
export function backfillCandidates(josh: readonly StaffRow[], snapshot: StaffSnapshot): StaffRow[] {
  return josh.filter(row => {
    if (row.is_active !== true || row.user_type !== 'internal') return false;
    if (['sale', 'sales', 'manager'].includes(row.role)) return true;
    if (!['admin', 'platform_admin'].includes(row.role)) return false;
    const map = new Map([[canonicalId(row.id), '00000000-0000-4000-8000-000000000000']]);
    return (Object.keys(STAFF_COLUMNS) as StaffTable[]).some(table =>
      (snapshot[table] ?? []).some(stored => JSON.stringify(rewriteStaffRow(table, stored, map)) !== JSON.stringify(stored)));
  });
}

export function planStaffAccounts(josh: readonly StaffRow[], commerce: readonly StaffRow[]) {
  const reps = activeJoshReps(josh);
  const classified = classifyStaff(reps, commerce);
  const unmatched = new Set(classified.unmatched);
  const ids = new Set(commerce.map(row => canonicalId(row.id)));
  return {
    accounts: reps.filter(row => unmatched.has(row.id)).map(row => ({
      joshId: row.id, email: maskEmail(row.email), role: row.role === 'manager' ? 'sales_manager' : 'sale',
      proposedId: ids.has(canonicalId(row.id)) ? null : row.id,
      idDecision: ids.has(canonicalId(row.id)) ? 'id taken → new uuid + backfill rewrite' : 'id reused',
    })),
    ambiguous: classified.ambiguous,
    /** Josh reps whose email already belongs to a non-sales / disabled commerce account: decide by hand, nothing proposed. */
    ineligible: classified.ineligible,
  };
}
