import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const STAFF_ROLES_KEY = 'auth:staffRoles';
export const ANY_STAFF_KEY = 'auth:anyStaff';
export const ALLOW_READ_ONLY_WRITE_KEY = 'auth:allowReadOnlyWrite';

/**
 * Staff roles that can sign in to commerce-admin. `admin` can do everything. A role reaches only the routes that
 * list it with @StaffRoles (admin is always included).
 *
 * Josh staff (staff.access) is a different list — see JOSH_STAFF_ROLES. These commerce-only roles have no josh
 * account: `sales_manager` (the josh person is `manager`), `business_analyst`, `graphic`. `sale` stays a josh role.
 */
export type StaffRole = 'admin' | 'marketing' | 'merchandising' | 'cs' | 'sales_manager' | 'business_analyst' | 'graphic';
export const STAFF_ROLES: readonly StaffRole[] = ['admin', 'marketing', 'merchandising', 'cs', 'sales_manager', 'business_analyst', 'graphic'];

/** GET/HEAD only, plus a route marked @AllowReadOnlyWrite (own password). Enforced in StaffAuthGuard. */
export const READ_ONLY_STAFF_ROLES: readonly StaffRole[] = ['business_analyst'];

/**
 * Skip the global staff guard. Only for routes with their OWN auth (API key,
 * portal JWT, X-ERP-Key, webhook signature) or that are genuinely public.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Allow these staff roles in addition to `admin` (default: admin only). */
export const StaffRoles = (...roles: StaffRole[]) => SetMetadata(STAFF_ROLES_KEY, roles);

/** Every commerce-admin role, including ones added later. For "who am I" and "change my password" only. */
export const AnyStaff = () => SetMetadata(ANY_STAFF_KEY, true);

export const ALLOW_PENDING_PASSWORD_KEY = 'auth:allowPendingPassword';
/** Open to a staff member who still has to change a password someone else set (only "who am I" and "change it"). */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);

/** The one write a read-only role may make: their own password. */
export const AllowReadOnlyWrite = () => SetMetadata(ALLOW_READ_ONLY_WRITE_KEY, true);

/** What the global staff guard attaches to an authenticated request. */
export interface StaffRequest {
  staff: { userId: string; email: string; role: StaffRole };
}
