/**
 * Shared homes for commerce staff (also the post-login landing in landing.ts). Every role lands on /home,
 * its "What do you want to do today?" page (app/pages/RoleHome.tsx): shortcuts to the role's main tasks
 * (navigation.ts ROLE_SHORTCUTS). /home makes no API call, so it never 403s for any role.
 */
export const ROLE_HOME: Readonly<Record<string, string>> = {
  admin: '/home', // shortcuts include the Dashboard (/)
  merchandising: '/home',
  business_analyst: '/home',
  cs: '/home',
  graphic: '/home',
  marketing: '/home',
  sale: '/home',
  sales_manager: '/home',
};

export function normalizeRole(role: string | null | undefined): string {
  const value = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return value === 'sale_manager' ? 'sales_manager' : value;
}

export function homeForRole(role: string | null | undefined): string {
  const canonical = normalizeRole(role);
  return Object.prototype.hasOwnProperty.call(ROLE_HOME, canonical) ? ROLE_HOME[canonical] : '/account/password';
}
