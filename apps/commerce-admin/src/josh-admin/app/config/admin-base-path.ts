/** React Router basename — no trailing slash (e.g. `/admin`). */
export function getAdminBasename(): string {
  const base =
    (typeof import.meta !== 'undefined' &&
      (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
    '/admin/';

  const normalized = base.replace(/\/+$/, '');
  return normalized || '/admin';
}

/** Full browser URL for hard redirects (window.location). */
export function toAdminAbsoluteUrl(routePath: string): string {
  const path = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${getAdminBasename()}${path}`;
}

/**
 * shop-web's base path (mirrors `NEXT_PUBLIC_SHOP_BASE_PATH`, e.g. `/shop`) —
 * every deployment serves the storefront behind this prefix via nginx, so
 * links built for it must include it. Defaults to `/shop` so it's correct
 * out of the box; may legitimately be configured empty, so normalise away
 * a trailing slash but never force one back on.
 */
export function getShopBasePath(): string {
  const base =
    (import.meta.env as { VITE_SHOP_BASE_PATH?: string }).VITE_SHOP_BASE_PATH ?? '/shop';

  return base.replace(/\/+$/, '');
}

/**
 * Origin shop-web is served from, when it is NOT the same origin as the admin.
 *
 * In deployed environments nginx puts both behind one host (`/admin` and `/shop`),
 * so this stays empty and links are root-relative. In local dev they are separate
 * dev servers on different ports, so a root-relative `/shop/...` link resolves
 * against the admin's own port and 404s — which is exactly what happened to the
 * first preview link anyone clicked.
 */
export function getShopOrigin(): string {
  const origin = (import.meta.env as { VITE_SHOP_ORIGIN?: string }).VITE_SHOP_ORIGIN;
  if (origin) return origin.replace(/\/+$/, '');

  // Dev fallback: the admin dev server runs on its own port, shop-web on 4401.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    if (port && port !== '4401') return `${protocol}//${hostname}:4401`;
  }
  return '';
}

/**
 * Public path of a shop route, WITHOUT an origin — what a marketer will share and
 * what the URL looks like in production. Use this for display; use `toShopUrl`
 * for anything actually opened from the admin during local dev.
 */
export function toShopPath(routePath: string): string {
  const path = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${getShopBasePath()}${path}`;
}

/** Full shop-web URL for a route path (e.g. `/promotions/<slug>`), base-path aware. */
export function toShopUrl(routePath: string): string {
  const path = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${getShopOrigin()}${getShopBasePath()}${path}`;
}
