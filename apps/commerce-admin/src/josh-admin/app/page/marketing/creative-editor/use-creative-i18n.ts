import { elementHasTranslatableContent, pruneOverlaySlides } from '@josh/shared-api';
import type { ChannelDesign, CreativeElement, CreativeI18nLocale, CreativeI18nOverlay } from './creative-editor.types';

type ChromeOverlay = NonNullable<CreativeI18nLocale['chrome']>;

function isNonEmptyString(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isMeaningfulOverlay(overlay: CreativeI18nOverlay | undefined): boolean {
  if (!overlay) return false;
  if (
    isNonEmptyString(overlay.text) ||
    isNonEmptyString(overlay.label) ||
    isNonEmptyString(overlay.url) ||
    isNonEmptyString(overlay.alt) ||
    isNonEmptyString(overlay.src) ||
    isNonEmptyString(overlay.html) ||
    isNonEmptyString(overlay.expiredText)
  ) {
    return true;
  }
  if (
    overlay.items?.some(
      (item) => Boolean(item) && (isNonEmptyString(item.title) || isNonEmptyString(item.body)),
    )
  ) {
    return true;
  }
  return Boolean(
    overlay.images?.some(
      (slide) => Boolean(slide) && (isNonEmptyString(slide.src) || isNonEmptyString(slide.alt) || isNonEmptyString(slide.linkUrl)),
    ),
  );
}

/**
 * Read/write helpers for a locale overlay on a design.
 * When `editorLocale` is the base language ('th'), `isBase` is true and callers
 * should patch the element itself rather than the overlay.
 */
export function useCreativeI18n(
  design: ChannelDesign,
  onChange: (design: ChannelDesign) => void,
  editorLocale: string,
) {
  const isBase = editorLocale === 'th';

  const overlayFor = (elementId: string): CreativeI18nOverlay =>
    design.i18n?.[editorLocale]?.elements?.[elementId] ?? {};

  const chromeOverlayFor = (): ChromeOverlay => design.i18n?.[editorLocale]?.chrome ?? {};

  /** Whether this element currently has an overlay entry with at least one field. */
  const hasOverlay = (elementId: string): boolean => {
    const entry = design.i18n?.[editorLocale]?.elements?.[elementId];
    return Boolean(entry && Object.keys(entry).length > 0);
  };

  /**
   * True when this element still needs translation: its type carries translatable
   * content AND it has no meaningful (non-empty) overlay yet. Elements with no
   * translatable fields (divider/spacer/coupon/...) never need the dot; an overlay
   * of e.g. `{ images: [{ src: '' }] }` doesn't count as translated.
   */
  const needsTranslation = (elementId: string, elementType: CreativeElement['type']): boolean => {
    if (isBase) return false;
    if (!elementHasTranslatableContent(elementType)) return false;
    const entry = design.i18n?.[editorLocale]?.elements?.[elementId];
    return !isMeaningfulOverlay(entry);
  };

  const writeElements = (elements: Record<string, CreativeI18nOverlay>) => {
    const localeEntry = { ...(design.i18n?.[editorLocale] ?? {}), elements };
    onChange({ ...design, i18n: { ...(design.i18n ?? {}), [editorLocale]: localeEntry } });
  };

  /** Patch overlay fields. An empty-string value deletes the key so it falls back to Thai. */
  const patchOverlay = (elementId: string, patch: Partial<CreativeI18nOverlay>) => {
    if (isBase) return;
    const elements = { ...(design.i18n?.[editorLocale]?.elements ?? {}) };
    const next: CreativeI18nOverlay = { ...(elements[elementId] ?? {}), ...patch };
    for (const [key, value] of Object.entries(patch)) {
      if (typeof value === 'string' && !value.trim()) {
        delete (next as Record<string, unknown>)[key];
      }
    }
    // Carousel overlays are edited as a dense array of slide objects — prune empty
    // fields/slides so "cleared" collapses back to "never translated" instead of
    // leaving stale `''` entries that keep the untranslated dot lit forever.
    if ('images' in patch) {
      const prunedImages = pruneOverlaySlides(next.images);
      if (prunedImages) next.images = prunedImages;
      else delete next.images;
    }
    // Accordion overlays are positional too — prune empty titles/bodies so a
    // cleared translation collapses back to "never translated".
    if ('items' in patch) {
      const prunedItems = next.items
        ?.map((item) => ({
          ...(isNonEmptyString(item?.title) ? { title: item.title } : {}),
          ...(isNonEmptyString(item?.body) ? { body: item.body } : {}),
        }))
        .filter(Boolean);
      if (prunedItems?.some((item) => Object.keys(item).length > 0)) next.items = prunedItems;
      else delete next.items;
    }
    if (Object.keys(next).length === 0) delete elements[elementId];
    else elements[elementId] = next;
    writeElements(elements);
  };

  /** Patch chrome overlay fields (dismiss label / background image). Same empty-string-deletes rule. */
  const patchChromeOverlay = (patch: Partial<ChromeOverlay>) => {
    if (isBase) return;
    const localeEntry = design.i18n?.[editorLocale] ?? {};
    const nextChrome: ChromeOverlay = { ...(localeEntry.chrome ?? {}), ...patch };
    for (const [key, value] of Object.entries(patch)) {
      if (typeof value === 'string' && !value.trim()) {
        delete (nextChrome as Record<string, unknown>)[key];
      }
    }
    const nextEntry: CreativeI18nLocale = {
      ...localeEntry,
      chrome: Object.keys(nextChrome).length > 0 ? nextChrome : undefined,
    };
    onChange({ ...design, i18n: { ...(design.i18n ?? {}), [editorLocale]: nextEntry } });
  };

  /** Remove an element's overlay across every locale — call when the element is deleted. */
  const dropOverlay = (design_: ChannelDesign, elementId: string): ChannelDesign => {
    if (!design_.i18n) return design_;
    const i18n = Object.fromEntries(
      Object.entries(design_.i18n).map(([code, entry]) => {
        if (!entry.elements?.[elementId]) return [code, entry];
        const elements = { ...entry.elements };
        delete elements[elementId];
        return [code, { ...entry, elements }];
      }),
    );
    return { ...design_, i18n };
  };

  /** Copy an element's overlay onto a clone — call when the element is duplicated. */
  const copyOverlay = (design_: ChannelDesign, fromId: string, toId: string): ChannelDesign => {
    if (!design_.i18n) return design_;
    const i18n = Object.fromEntries(
      Object.entries(design_.i18n).map(([code, entry]) => {
        const source = entry.elements?.[fromId];
        if (!source) return [code, entry];
        return [
          code,
          {
            ...entry,
            elements: {
              ...entry.elements,
              [toId]: { ...source, images: source.images ? source.images.map((slide) => ({ ...slide })) : source.images },
            },
          },
        ];
      }),
    );
    return { ...design_, i18n };
  };

  return {
    isBase,
    overlayFor,
    chromeOverlayFor,
    hasOverlay,
    needsTranslation,
    patchOverlay,
    patchChromeOverlay,
    dropOverlay,
    copyOverlay,
  };
}
