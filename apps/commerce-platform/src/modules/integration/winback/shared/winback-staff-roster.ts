import { acceptsJoshJwt } from './winback.config';

export interface StaffRosterEntry { id: string; name: string; role: string }
export interface RosterQuery { query(sql: string, params?: unknown[]): Promise<StaffRosterEntry[]> }

/** One directory for assignment, collaboration and reporting. No email is returned or used as a name. */
export function staffRosterSql(roles: readonly string[]): string {
  const named = roles.some(role => ['admin', 'platform_admin'].includes(role));
  const commerce = `SELECT id,
    COALESCE(NULLIF(CASE WHEN name LIKE '%@%' THEN '' ELSE trim(name) END, ''), 'Staff ' || left(id::text, 8)) AS name,
    CASE WHEN lower(trim(role)) IN ('sales_manager', 'sale_manager') THEN 'manager' ELSE lower(trim(role)) END AS role, 0 AS source_order
    FROM users WHERE status = 'active' AND lower(trim(role)) IN ('sale', 'sales_manager', 'sale_manager'${named ? ", 'admin'" : ''})`;
  const josh = acceptsJoshJwt() ? ` UNION ALL SELECT id,
    COALESCE(NULLIF(CASE WHEN concat_ws(' ', first_name, last_name) LIKE '%@%' THEN '' ELSE trim(concat_ws(' ', first_name, last_name)) END, ''), 'Staff ' || left(id::text, 8)) AS name, role, 1 AS source_order
    FROM josh_staff WHERE is_active AND user_type = 'internal' AND role IN ('sale', 'sales', 'manager'${named ? ", 'admin', 'platform_admin'" : ''})
    AND NOT EXISTS (SELECT 1 FROM winback_staff_links l WHERE l.josh_user_id = josh_staff.id)` : '';
  // Id reuse during account provisioning can expose both rows before linking; prefer the commerce display entry.
  return `SELECT id, name, role FROM (
    SELECT DISTINCT ON (id) id, name, role FROM (${commerce}${josh}) candidates ORDER BY id, source_order
  ) roster WHERE role = ANY($1::text[]) ORDER BY name, id`;
}

export async function listStaffRoster(db: RosterQuery, roles: readonly string[]): Promise<StaffRosterEntry[]> {
  if (!roles.length) return [];
  // sales_manager is exposed as manager to the app's existing assignment/collab role checks.
  return db.query(staffRosterSql(roles), [[...new Set(roles.map(role => ['sales_manager', 'sale_manager'].includes(role) ? 'manager' : role))]]);
}
