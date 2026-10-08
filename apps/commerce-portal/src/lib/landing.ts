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

export function isRouteAllowed(role: string | null | undefined, path: string): boolean {
  if (!isSafeInternalPath(path)) return false;
  const routes = (role && ROLE_ROUTES[role]) || FALLBACK_ROUTES;
  return routes.includes(pathnameOf(path));
}

export function landingFor(role: string | null | undefined): string {
  return (role && ROLE_LANDING[role]) || FALLBACK_LANDING;
}

/** After sign-in / silent restore: the deep link if it is internal and allowed, else the role's home. */
export function resolvePostLoginPath(role: string | null | undefined, redirect: string | null | undefined): string {
  return redirect && isRouteAllowed(role, redirect) ? redirect : landingFor(role);
}

/** The login URL that brings you back to `here` afterwards. */
export function loginPathFor(here: string): string {
  const pathname = pathnameOf(here);
  if (pathname === '/login') return here;
  if (!isSafeInternalPath(here) || pathname === '/' || pathname === '/register') return '/login';
  return `/login?redirect=${encodeURIComponent(here)}`;
}
