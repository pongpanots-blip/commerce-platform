// Where a staff member lands after sign-in, and which deep links they may be sent to. Pure (unit-tested).
// The per-role list is navigation.ts ROLE_ACCESS — the same one the sidebar uses — so there is one source.
import { navFor, ROLE_ACCESS } from '../app/navigation';

/**
 * Each role's home: a page in its own sidebar whose first API calls the platform allows for that role
 * (@StaffRoles on the controller, or the josh relay's AREAS list for /j/*).
 */
export const ROLE_LANDING: Readonly<Record<string, string>> = {
  admin: '/', // Dashboard (admin-only)
  merchandising: '/products', // platform catalog — GET /products: merchandising, graphic
  sales_manager: '/reports/sales', // GET /reports/sales: sales_manager, business_analyst
  business_analyst: '/reports/sales', // read-only role, GET only
  cs: '/cs', // CS desk — no API call on load; its tabs use the josh relay /cs-admin/* (cs)
  graphic: '/j/product/bulk-image-upload', // product images — relay /product/images*: marketing, merchandising, graphic
  marketing: '/marketing/growth', // GET /growth/*: marketing, business_analyst
};

/** Any role, including one the app does not know yet: GET /admin/auth/me + POST /admin/auth/password are @AnyStaff. */
export const FALLBACK_LANDING = '/account/password';

/** Internal app path only: one leading slash, no scheme / protocol-relative / backslash tricks. */
export function isSafeInternalPath(path: unknown): path is string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return false;
  if (/[\\\u0000-\u001f\u007f]/.test(path)) return false;
  try {
    return new URL(path, 'http://app.invalid').origin === 'http://app.invalid';
  } catch {
    return false;
  }
}

const pathnameOf = (path: string) => path.split(/[?#]/)[0].replace(/\/+$/, '') || '/';

/** Whether the role may open the page; the longest ROLE_ACCESS entry covering the path decides (detail pages included). */
export function isRouteAllowed(role: string | null | undefined, path: string): boolean {
  if (!role || !isSafeInternalPath(path)) return false;
  const pathname = pathnameOf(path);
  if (pathname === '/login') return false;
  if (role === 'admin') return true;
  if (pathname === '/') return false;
  if (/^\/workspaces\/[^/]+$/.test(pathname)) return navFor(role).some((g) => g.links.some((l) => l.to === pathname));
  const key = Object.keys(ROLE_ACCESS)
    .filter((k) => pathname === k || pathname.startsWith(`${k}/`))
    .sort((a, b) => b.length - a.length)[0];
  return !!key && ROLE_ACCESS[key].includes(role);
}

export function landingFor(role: string | null | undefined): string {
  const landing = role ? ROLE_LANDING[role] : undefined;
  return landing && isRouteAllowed(role, landing) ? landing : FALLBACK_LANDING;
}

/** After sign-in / silent restore: the deep link if it is internal and the role may open it, else the role's home. */
export function resolvePostLoginPath(role: string | null | undefined, redirect: string | null | undefined): string {
  return redirect && isSafeInternalPath(redirect) && isRouteAllowed(role, redirect) ? redirect : landingFor(role);
}

/** The login URL that brings you back to `here` afterwards (nothing to remember for / or /login itself). */
export function loginPathFor(here: string): string {
  if (pathnameOf(here) === '/login') return here;
  if (!isSafeInternalPath(here) || pathnameOf(here) === '/') return '/login';
  return `/login?redirect=${encodeURIComponent(here)}`;
}

/** `?redirect=` of a login URL's search string. */
export const redirectParam = (search: string) => new URLSearchParams(search).get('redirect');
