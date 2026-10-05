/**
 * `?returnTo=` query param carried on out-links from the coupon create/edit forms (to segment
 * and promotion-product-set pages) so those pages can send the admin back to the coupon they
 * came from instead of their own list page. See Webjosh/docs/coupon-api.md.
 */
const RETURN_TO_PARAM = 'returnTo';

// Only a coupon create/edit path is ever a valid returnTo target — anything else (an external
// URL, a protocol-relative `//evil.com`, or an unrelated internal path) is an open-redirect
// vector and is rejected. No slash is allowed after `/coupon/`, so this also rejects
// `/coupon/x/../../y`-style traversal.
const COUPON_PATH_RE = /^\/coupon\/[^/]+$/;

/** Reads and validates the `returnTo` param from `searchParams`. Returns null if it's absent
 * or isn't `/coupon/create` or `/coupon/<id>`. */
export function readReturnTo(searchParams: URLSearchParams): string | null {
  const value = searchParams.get(RETURN_TO_PARAM);
  if (!value || !COUPON_PATH_RE.test(value)) return null;
  return value;
}

/** Appends `?returnTo=<returnTo>` to `path`, for an out-link leaving a coupon create/edit page. */
export function appendReturnTo(path: string, returnTo: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}${RETURN_TO_PARAM}=${encodeURIComponent(returnTo)}`;
}

/**
 * `?restoreDraft=1` marker carried ONLY on the navigation that actually sends the admin back to
 * a coupon page (the segment/product-set page's back/cancel button and its after-save
 * redirect, incl. the promotion-product-set list's "← กลับไปที่คูปอง" link) — never stored
 * alongside `returnTo` itself. The coupon page only restores its stashed draft
 * (`coupon-form-draft.helpers.ts`) when this marker is present, so an unrelated visit or a
 * page refresh never resurrects an old draft; the coupon page clears the marker (replace
 * navigation) as soon as it reads it, so refreshing afterwards doesn't re-trigger a restore.
 */
const RESTORE_DRAFT_PARAM = 'restoreDraft';

/** Appends the restore-draft marker to a `returnTo` target right before navigating back to it. */
export function withRestoreDraftMarker(path: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}${RESTORE_DRAFT_PARAM}=1`;
}

/** True when `searchParams` carries the restore-draft marker — the coupon page should read
 * this on mount, and only then attempt to consume its stashed draft. */
export function shouldRestoreDraft(searchParams: URLSearchParams): boolean {
  return searchParams.get(RESTORE_DRAFT_PARAM) === '1';
}
