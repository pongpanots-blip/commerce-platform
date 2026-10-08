import { normalizeStaffRole } from '../../../shared-kernel/presentation/auth.decorators';

/**
 * Every Josh code here must be `user_type = 'internal'` in `app_roles`. `super_admin`
 * is NOT: it is the customer-side "Company Super Admin" (first person of a
 * customer company), so listing it here leaked customer accounts into
 * `GET /winback/sales-users`, team stats and analytics rep lists.
 * `winback-roles.spec.ts` pins the customer codes out. Commerce's sales_manager is a separate staff login.
 */

// Commerce sales_manager takes effect for app JWTs after the stacked commerce-auth change.
/** Roles that see team scope + aging (Zoho-style manager sharing). */
export const WINBACK_MANAGER_ROLES = new Set(['platform_admin', 'admin', 'manager', 'sales_manager']);

/**
 * The sales team proper — who can own a lead and who appears in rep lists
 * (`GET /sales-users`, targets, team stats). `admin` / `platform_admin` manage
 * the pool but are not reps, so they are deliberately not listed here.
 */
export const WINBACK_ASSIGNABLE_ROLES = ['sale', 'sales', 'manager'] as const;

/**
 * Whose names the app resolves (collaboration requester / recipient / resolver, coordination owner, audit
 * log actors): the sales team plus `admin` / `platform_admin` / commerce `sales_manager`, who act as managers. Not a rep list.
 */
export const WINBACK_NAMED_ROLES = [...WINBACK_ASSIGNABLE_ROLES, 'admin', 'platform_admin', 'sales_manager'] as const;

export function isWinbackManager(role: string | null | undefined): boolean {
  return !!role && WINBACK_MANAGER_ROLES.has(normalizeStaffRole(role));
}
