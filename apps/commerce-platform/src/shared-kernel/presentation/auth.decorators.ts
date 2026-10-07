import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const STAFF_ROLES_KEY = 'auth:staffRoles';

/**
 * Staff roles that can sign in to commerce-admin. `admin` can do everything. `merchandising` (MER) and `cs` use
 * josh's own role codes (stage 6: every employee account lives in commerce); a role reaches only the routes that
 * list it with @StaffRoles.
 */
export type StaffRole = 'admin' | 'marketing' | 'merchandising' | 'cs';
export const STAFF_ROLES: readonly StaffRole[] = ['admin', 'marketing', 'merchandising', 'cs'];

/**
 * Skip the global staff guard. Only for routes with their OWN auth (API key,
 * portal JWT, X-ERP-Key, webhook signature) or that are genuinely public.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Allow these staff roles in addition to `admin` (default: admin only). */
export const StaffRoles = (...roles: StaffRole[]) => SetMetadata(STAFF_ROLES_KEY, roles);

export const ALLOW_PENDING_PASSWORD_KEY = 'auth:allowPendingPassword';
/** Open to a staff member who still has to change a password someone else set (only "who am I" and "change it"). */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);

/** What the global staff guard attaches to an authenticated request. */
export interface StaffRequest {
  staff: { userId: string; email: string; role: StaffRole };
}
