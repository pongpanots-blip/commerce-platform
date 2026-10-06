/** Client-side page for the entitlement table (see CouponDetail.tsx) — the API still returns
 * every entitlement in one shot (ponytail: move to server-side paging on
 * `GET /coupon/:id/entitlements` if that payload becomes a problem), so this only slices what's
 * already in memory and keeps `currentPage` in range as the list reloads. */
export function resolveEntitlementsPage(
  currentPage: number,
  previousCount: number,
  nextCount: number,
  pageSize: number,
): number {
  // A reload that shrank the list (e.g. a status toggle removed a row from view) starts back
  // at page 1 rather than landing on a now-arbitrary later page.
  if (nextCount < previousCount) return 1;
  const totalPages = Math.max(1, Math.ceil(nextCount / pageSize));
  return Math.min(Math.max(1, currentPage), totalPages);
}
