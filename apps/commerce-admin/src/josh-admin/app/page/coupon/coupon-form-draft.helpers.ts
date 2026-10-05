import { createContext, useContext } from 'react';

const DRAFT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour — ignore anything older, see task note

/** A chosen-but-not-yet-uploaded coupon image, serialisable into sessionStorage — see
 * `fileToDataUrl`/`dataUrlToFile` below and CreateCoupon.tsx's `pendingImage` state. */
export type CouponPendingImage = { name: string; type: string; dataUrl: string };

function draftKey(pathname: string): string {
  return `coupon-form-draft:${pathname}`;
}

/** Stashes `data` for `pathname` (the coupon create/edit page the admin is leaving) into
 * sessionStorage, so it can be restored if they come back via a `returnTo` link. Wrapped in
 * try/catch — sessionStorage can throw (private mode, quota); losing the draft is no worse
 * than not having this feature. If the first attempt throws and `fallbackData` is given (e.g.
 * the same draft with a big pending-image data URL stripped out), retries once with that
 * smaller payload instead of dropping the whole draft — a coupon with an image attached is the
 * most likely case to hit sessionStorage's quota. */
export function stashCouponFormDraft<T>(pathname: string, data: T, fallbackData?: T): void {
  try {
    sessionStorage.setItem(draftKey(pathname), JSON.stringify({ data, savedAt: Date.now() }));
  } catch {
    if (fallbackData === undefined) return;
    try {
      sessionStorage.setItem(
        draftKey(pathname),
        JSON.stringify({ data: fallbackData, savedAt: Date.now() }),
      );
    } catch {
      // ponytail: best-effort only, see comment above.
    }
  }
}

/** Reads `file` as a data URL (FileReader, async) — used to keep a chosen-but-not-yet-uploaded
 * coupon image alive across a stash/restore round-trip. Has to happen at file-selection time,
 * not inside `stashCouponFormDraft`'s caller: that runs synchronously from a link's `onClick`
 * (see CouponDraftStashContext below) and can't await a FileReader there. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

/** Inverse of `fileToDataUrl` — rebuilds a `File` synchronously from a stashed data URL, so it
 * can run inside a lazy `useState(() => …)` initialiser (CreateCoupon.tsx) rather than an async
 * effect. atob → raw bytes → File; throws on a malformed data URL, which callers treat as "no
 * image to restore" rather than crashing the page. */
export function dataUrlToFile(dataUrl: string, name: string, type: string): File {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type });
}

function readDraft<T>(pathname: string): T | null {
  try {
    const raw = sessionStorage.getItem(draftKey(pathname));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: T; savedAt: number };
    if (Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Reads back and deletes (restore-once) the draft stashed for `pathname`, or null if there is
 * none or it's older than DRAFT_MAX_AGE_MS. Callers should only invoke this when the
 * `restoreDraft` marker (see return-to.ts) says the admin actually arrived via the returnTo
 * flow — a draft can be sitting in sessionStorage from an earlier visit otherwise. Only safe to
 * call once per mount (e.g. from a post-load effect that's already guarded against StrictMode's
 * double-invoke — see CouponDetail.tsx) since it deletes on read; for a synchronous restore
 * during the component's own first render (`useState(() => …)` initialisers), use
 * `peekCouponFormDraft` + `discardCouponFormDraft` instead — see CreateCoupon.tsx. */
export function consumeCouponFormDraft<T>(pathname: string): T | null {
  const data = readDraft<T>(pathname);
  try {
    sessionStorage.removeItem(draftKey(pathname));
  } catch {
    // ponytail: best-effort only.
  }
  return data;
}

/** Non-destructive read of the draft stashed for `pathname` — safe to call multiple times (e.g.
 * from every `useState(() => …)` lazy initialiser in a component, or across React StrictMode's
 * dev double-invoke of the whole render function) since, unlike `consumeCouponFormDraft`, it
 * never deletes anything. Pair with `discardCouponFormDraft` in a `useEffect` to actually clear
 * the entry once — see CreateCoupon.tsx, which needs the restored value to exist on the very
 * first render (a post-mount effect restore left a window where a child's own mount effect
 * could fire against the still-empty initial state and, via a stale closure, write it back
 * over a draft restored microtasks later). */
export function peekCouponFormDraft<T>(pathname: string): T | null {
  return readDraft<T>(pathname);
}

/** Deletes the draft stashed for `pathname` — idempotent (a second call is a harmless no-op),
 * so it's safe to call from an effect that may run twice under StrictMode. */
export function discardCouponFormDraft(pathname: string): void {
  try {
    sessionStorage.removeItem(draftKey(pathname));
  } catch {
    // ponytail: best-effort only.
  }
}

/**
 * Provided by CreateCoupon/CouponDetail around their whole page tree — a zero-arg callback
 * that stashes the current form snapshot under the page's own pathname (see
 * `stashCouponFormDraft`). Consumed by the three out-links that leave the coupon form (the
 * segment-create link in `CouponAudienceFields.tsx`, the segment-edit link in
 * `CouponDetail.tsx` itself, and the product-set-list link in `PromotionProductSetPicker.tsx`)
 * from their own `onClick` — never from a global click listener, so an unrelated click (e.g.
 * the sidebar nav, which sits outside this provider entirely) never stashes anything.
 */
export const CouponDraftStashContext = createContext<(() => void) | null>(null);

/** Reads the stash callback from context; a no-op outside a provider (e.g. in a test that
 * renders the leaf component standalone) rather than throwing. */
export function useStashCouponDraftOnClick(): () => void {
  const stash = useContext(CouponDraftStashContext);
  return stash ?? (() => {});
}
