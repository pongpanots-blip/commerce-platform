import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const STAFF_ROLES_KEY = 'auth:staffRoles';

/** Staff roles that can sign in to commerce-admin. `admin` can do everything. */
export type StaffRole = 'admin' | 'marketing';
export const STAFF_ROLES: readonly StaffRole[] = ['admin', 'marketing'];

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
