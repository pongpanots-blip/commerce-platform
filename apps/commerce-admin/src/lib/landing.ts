// Where a staff member lands after sign-in, and which deep links they may be sent to. Pure (unit-tested).
// One source each: the per-role page list is navigation.ts ROLE_ACCESS (the sidebar uses it too), the role
// homes are role-home.ts ROLE_HOME.
import { ROLE_ACCESS, workspaceTarget } from '../app/navigation';
import { normalizeRole, ROLE_HOME } from './role-home';

export { ROLE_HOME as ROLE_LANDING } from './role-home';

/** Any role, including one the app does not know yet: GET /admin/auth/me + POST /admin/auth/password are @AnyStaff. */
export const FALLBACK_LANDING = '/account/password';

const BASE = 'http://app.invalid';

/**
 * The internal path the router would really open, or null: one leading slash, no scheme / protocol-relative /
 * backslash / control characters, `.` and `..` resolved, and no percent-encoded dot, slash or backslash (at any
 * decoding depth) that could turn into a different path later — those are ambiguous, so refused.
 */
export function normalizeInternalPath(path: unknown): string | null {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(path)) return null;
  let pathname = path.split(/[?#]/)[0];
  for (let depth = 0; depth < 4; depth++) {
    if (/%(2e|2f|5c)/i.test(pathname)) return null;
    let decoded: string;
    try { decoded = decodeURIComponent(pathname); } catch { return null; }
    if (decoded === pathname) break;
    if (/[\\\u0000-\u001f\u007f]/.test(decoded)) return null;
    pathname = decoded;
  }
  let url: URL;
  try { url = new URL(path, BASE); } catch { return null; }
  if (url.origin !== BASE || url.pathname.startsWith('//')) return null;
  return url.pathname + url.search + url.hash;
}

export const isSafeInternalPath = (path: unknown): path is string => normalizeInternalPath(path) !== null;

const pathnameOf = (path: string) => path.split(/[?#]/)[0].replace(/\/+$/, '') || '/';

/** Whether the role may open the page; the longest ROLE_ACCESS entry covering the path decides (detail pages included). */
export function isRouteAllowed(roleRaw: string | null | undefined, path: string): boolean {
  const role = normalizeRole(roleRaw);
  const normalized = normalizeInternalPath(path);
  if (!role || !normalized) return false;
  const pathname = pathnameOf(normalized);
  if (pathname === '/login') return false;
  if (role === 'admin') return true;
  if (pathname === '/') return false;
  // old workspace overview pages redirect to the replacing section: allowed when the role has a page there
  const workspace = /^\/workspaces\/([^/]+)$/.exec(pathname);
  if (workspace) return workspaceTarget(role, workspace[1]) !== null;
  const key = Object.keys(ROLE_ACCESS)
    .filter((k) => pathname === k || pathname.startsWith(`${k}/`))
    .sort((a, b) => b.length - a.length)[0];
  return !!key && ROLE_ACCESS[key].includes(role);
}

export function landingFor(roleRaw: string | null | undefined): string {
  const role = normalizeRole(roleRaw);
  const landing = Object.prototype.hasOwnProperty.call(ROLE_HOME, role) ? ROLE_HOME[role] : undefined;
  return landing && isRouteAllowed(role, landing) ? landing : FALLBACK_LANDING;
}

/** After sign-in / silent restore: the (normalised) deep link if the role may open it, else the role's home. */
export function resolvePostLoginPath(role: string | null | undefined, redirect: string | null | undefined): string {
  const target = normalizeInternalPath(redirect);
  return target && isRouteAllowed(role, target) ? target : landingFor(role);
}

/** The login URL that brings you back to `here` afterwards (nothing to remember for / or /login itself). */
export function loginPathFor(here: string): string {
  if (pathnameOf(here) === '/login') return here;
  if (!isSafeInternalPath(here) || pathnameOf(here) === '/') return '/login';
  return `/login?redirect=${encodeURIComponent(here)}`;
}

/** `?redirect=` of a login URL's search string. */
export const redirectParam = (search: string) => new URLSearchParams(search).get('redirect');
