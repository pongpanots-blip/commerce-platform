// Where a portal account lands after sign-in, and which deep links it may be sent to. Pure (unit-tested).
// The platform treats every portal account alike (PortalJwtGuard checks the token, not the role); portal
// sign-up only creates 'developer' accounts.

/** The signed-in pages (app.tsx routes / NAV). */
export const PORTAL_ROUTES = ['/', '/keys', '/webhooks', '/docs'] as const;

const ROLE_ROUTES: Readonly<Record<string, readonly string[]>> = { developer: PORTAL_ROUTES };
export const ROLE_LANDING: Readonly<Record<string, string>> = { developer: '/' };

/** A role the portal does not know (e.g. a staff account signing in here): Docs, which calls no API. */
export const FALLBACK_LANDING = '/docs';
const FALLBACK_ROUTES: readonly string[] = [FALLBACK_LANDING];

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

export function isRouteAllowed(role: string | null | undefined, path: string): boolean {
  const normalized = normalizeInternalPath(path);
  if (!normalized) return false;
  const routes = (role && Object.prototype.hasOwnProperty.call(ROLE_ROUTES, role) && ROLE_ROUTES[role]) || FALLBACK_ROUTES;
  return routes.includes(pathnameOf(normalized));
}

export function landingFor(role: string | null | undefined): string {
  return (role && Object.prototype.hasOwnProperty.call(ROLE_LANDING, role) && ROLE_LANDING[role]) || FALLBACK_LANDING;
}

/** After sign-in / silent restore: the (normalised) deep link if it is internal and allowed, else the role's home. */
export function resolvePostLoginPath(role: string | null | undefined, redirect: string | null | undefined): string {
  const target = normalizeInternalPath(redirect);
  return target && isRouteAllowed(role, target) ? target : landingFor(role);
}

/** The login URL that brings you back to `here` afterwards. */
export function loginPathFor(here: string): string {
  const pathname = pathnameOf(here);
  if (pathname === '/login') return here;
  if (!isSafeInternalPath(here) || pathname === '/' || pathname === '/register') return '/login';
  return `/login?redirect=${encodeURIComponent(here)}`;
}
