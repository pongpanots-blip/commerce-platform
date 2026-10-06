import type { MarketingTemplateBlock } from './marketing-workflow.api';

export type TextStyle = {
  fontSizePx?: number;
  fontWeight?: 'normal' | 'bold';
  color?: string;
  align?: 'left' | 'center' | 'right';
};

export type ImageStyle = { widthPercent?: number; borderRadiusPx?: number };

export type ButtonStyle = {
  backgroundColor?: string;
  color?: string;
  borderRadiusPx?: number;
  fullWidth?: boolean;
  /** Width as % of the column (20–100). Default 100. Drag-resizable in admin canvas. */
  widthPercent?: number;
};

export type CouponStyle = { align?: 'left' | 'center' | 'right' };

export type DividerStyle = { color?: string; thicknessPx?: number };

/** Matches the Tailwind breakpoints the repo already uses — no value conversion needed.
 *  base: < 768px · md: 768–1023px · lg: >= 1024px */
export type Breakpoint = 'base' | 'md' | 'lg';

export type CreativeElement = {
  id: string;
  /**
   * How many columns this element spans starting from its home column (default 1).
   * Example: in a 3-column row, a button with columnSpan 3 covers the full row;
   * text with columnSpan 1 sitting in column 2 occupies only that cell.
   */
  columnSpan?: number;
  /** Breakpoints at which this element is not rendered at all. Omitted = visible everywhere. */
  hiddenOn?: Breakpoint[];
  /** Partial `style` override applied from the `md` breakpoint upward. */
  styleMd?: Record<string, unknown>;
  /** Partial `style` override applied from the `lg` breakpoint upward. */
  styleLg?: Record<string, unknown>;
} & (
  | {
      type: 'text';
      text: string;
      style?: TextStyle;
    }
  | { type: 'image'; src: string; alt?: string; style?: ImageStyle }
  | {
      type: 'button';
      label: string;
      action: 'go_url' | 'copy_code' | 'close';
      url?: string;
      style?: ButtonStyle;
    }
  | {
      type: 'coupon';
      couponId?: string;
      legacyCode?: string;
      style?: CouponStyle;
    }
  | { type: 'spacer'; heightPx: number }
  | { type: 'divider'; style?: DividerStyle }
  | {
      type: 'video';
      src: string;
      playMode: 'auto' | 'click';
      style?: { aspectRatio?: '16/9' | '4/3' | '1/1'; borderRadiusPx?: number; widthPercent?: number };
    }
  | {
      type: 'html';
      html: string;
      style?: { minHeightPx?: number };
    }
  | {
      type: 'countdown';
      targetDatetime: string;
      format: 'dhms' | 'hms' | 'ms';
      expiredText?: string;
      style?: { align?: 'left' | 'center' | 'right'; color?: string; fontSize?: number };
    }
  | {
      type: 'carousel';
      images: Array<{ src: string; alt?: string; linkUrl?: string }>;
      style?: { borderRadiusPx?: number; aspectRatio?: '16/9' | '4/3' | '1/1'; widthPercent?: number };
      autoPlaySeconds?: number;
    }
  | {
      type: 'product_grid';
      source:
        | { kind: 'skus'; skus: string[] }
        | { kind: 'category'; categoryId: string; limit: number }
        /** SKUs come from the owning page's `promotion_mechanic_id`. */
        | { kind: 'promotion' };
      /** Columns at the `lg` breakpoint. `base` is always 2. */
      columns: 2 | 3 | 4;
      showPrice: boolean;
      showBadge: boolean;
    }
  | {
      type: 'rich_text';
      /** Restricted HTML — sanitized with DOMPurify at render time, same as type 'html'. */
      html: string;
      style?: TextStyle;
    }
  | {
      type: 'accordion';
      items: Array<{ id: string; title: string; body: string }>;
      allowMultiOpen?: boolean;
    }
);

export type CreativeColumn = {
  id: string;
  widthPercent: number;
  /** Width override from the `md` breakpoint upward. Omitted = inherit `widthPercent`. */
  widthPercentMd?: number;
  /** Width override from the `lg` breakpoint upward. Omitted = inherit md, then base. */
  widthPercentLg?: number;
  elements: CreativeElement[];
  /**
   * Optional nested rows inside this column (max one nest level from body:
   * body → column → nested row → leaf column with elements only).
   */
  rows?: CreativeRow[];
};

export type CreativeRow = {
  id: string;
  columns: CreativeColumn[];
  backgroundColor?: string;
  paddingPx?: number;
  /** Collapse to a single column at the `base` breakpoint. Default true when omitted. */
  stackOnMobile?: boolean;
};

export type PopupChrome = {
  position?: 'center' | 'top' | 'bottom' | 'bottom-sheet' | 'side-right';
  widthPx?: number;
  heightMode?: 'auto' | 'fixed';
  heightPx?: number;
  borderRadiusPx?: number;
  /**
   * @deprecated Overlay is always the default dim (`bg-black/50`). Ignored at render time.
   * Kept so older saved layouts still parse.
   */
  overlayColor?: string;
  /** Panel fill. Default white when omitted. Set `transparent` for no fill. */
  backgroundColor?: string;
  closeButton?: {
    corner: 'tl' | 'tr' | 'bl' | 'br';
    backgroundColor?: string;
  };
  displayDelaySeconds?: number;
  /** Secondary dismiss button shown below popup content */
  dismissButton?: {
    label: string;
    /** Hours before popup re-appears after this button is clicked. 8760 = ~permanent */
    capHours: number;
  };
  enterAnimation?: 'fade' | 'slide-up' | 'slide-down' | 'zoom' | 'none';
  backgroundImageUrl?: string;
  backgroundImageStyle?: 'cover' | 'contain' | 'repeat';
};

export type InAppChrome = {
  cardMaxWidthPx?: number;
  backgroundColor?: string;
  borderRadiusPx?: number;
};

export type EmailChrome = {
  contentWidthPx?: number;
  backgroundColor?: string;
  contentBackgroundColor?: string;
};

export type PopupTriggerConfig =
  | { kind: 'immediate' }
  | { kind: 'delay'; delaySeconds: number }
  | { kind: 'scroll_depth'; scrollPercent: number }
  | { kind: 'exit_intent' }
  | { kind: 'page_match'; urlPattern: string; matchMode: 'contains' | 'exact' | 'regex' }
  | { kind: 'time_on_page'; secondsOnPage: number };

/** Popup creative free-grid column count (admin editor + shop renderer). */
export const POPUP_GRID_COLS = 8;

/** One element's placement on the popup free grid (`POPUP_GRID_COLS` columns). */
export type GridItem = {
  elementId: string;
  /** Column start, 0-based (0 … POPUP_GRID_COLS-1). */
  col: number;
  /** Columns spanned, 1 … POPUP_GRID_COLS. */
  colSpan: number;
  /** Row start, 0+. One editor row unit = 40px. */
  row: number;
  /** Rows spanned, 1+. */
  rowSpan: number;
};

/**
 * Snap/clamp a grid item to integer lines on `cols` tracks.
 * Layouts authored on the legacy 9-column grid are scaled into `cols`.
 */
export function normalizePopupGridItem(
  it: Pick<GridItem, 'col' | 'colSpan' | 'row' | 'rowSpan'>,
  cols: number = POPUP_GRID_COLS,
  options?: { scaleFromLegacy9?: boolean },
): Omit<GridItem, 'elementId'> {
  const legacyCols = 9;
  const factor = options?.scaleFromLegacy9 ? cols / legacyCols : 1;
  let col = (Number(it.col) || 0) * factor;
  let colSpan = (Number(it.colSpan) || 1) * factor;
  col = Math.max(0, Math.min(cols - 1, Math.round(col)));
  colSpan = Math.max(1, Math.round(colSpan));
  if (col + colSpan > cols) {
    colSpan = Math.max(1, cols - col);
  }
  return {
    col,
    colSpan,
    row: Math.max(0, Math.round(Number(it.row) || 0)),
    rowSpan: Math.max(1, Math.round(Number(it.rowSpan) || 1)),
  };
}

/**
 * Reading order of a free-grid layout: top to bottom, then left to right.
 *
 * This is the single definition of "what order does this grid stack in when it
 * collapses to one column". The storefront's `CreativePageGrid` uses it to set
 * each cell's CSS `order` on mobile, and the admin's `GridStackPreview` and
 * layers outline use it to show the marketer that same order — if the two ever
 * drifted, the preview would quietly lie about the published page.
 *
 * Sorting is done on NORMALISED coordinates (`normalizePopupGridItem`), because
 * raw stored `col`/`row` can be fractional or scaled from the legacy 9-column
 * grid, and rounding two near-equal rows differently is exactly how two callers
 * end up disagreeing about which element comes first.
 */
export function gridStackOrder<T extends Pick<GridItem, 'col' | 'colSpan' | 'row' | 'rowSpan'>>(
  items: T[],
  cols: number = POPUP_GRID_COLS,
): T[] {
  const scaleFromLegacy9 = popupGridNeedsLegacyScale(items, cols);
  const placeOf = new Map<T, Omit<GridItem, 'elementId'>>(
    items.map((it) => [it, normalizePopupGridItem(it, cols, { scaleFromLegacy9 })]),
  );
  return [...items].sort((a, b) => {
    const pa = placeOf.get(a) as Omit<GridItem, 'elementId'>;
    const pb = placeOf.get(b) as Omit<GridItem, 'elementId'>;
    return pa.row - pb.row || pa.col - pb.col;
  });
}

/** True when any item overflows the current grid (typical legacy 9-col data). */
export function popupGridNeedsLegacyScale(
  items: Array<Pick<GridItem, 'col' | 'colSpan'>>,
  cols: number = POPUP_GRID_COLS,
): boolean {
  return items.some((it) => {
    const col = Number(it.col) || 0;
    const colSpan = Number(it.colSpan) || 1;
    return col + colSpan > cols + 0.01 || colSpan > cols || col > cols - 1 + 0.01;
  });
}

/** English (or other-locale) overrides for one element. Empty fields fall back to the base. */
export type CreativeI18nOverlay = {
  text?: string;
  label?: string;
  url?: string;
  alt?: string;
  src?: string;
  html?: string;
  expiredText?: string;
  /** Carousel slides, positional — index N overlays images[N]. */
  images?: Array<{ src?: string; alt?: string; linkUrl?: string }>;
  /** Accordion entries, positional — index N overlays items[N]. `id` is never translated. */
  items?: Array<{ title?: string; body?: string }>;
};

export type CreativeI18nLocale = {
  elements?: Record<string, CreativeI18nOverlay>;
  chrome?: {
    dismissLabel?: string;
    backgroundImageUrl?: string;
    seoTitle?: string;
    seoDescription?: string;
    ogImageUrl?: string;
  };
};

export type ChannelDesign = {
  meta: PopupChrome | InAppChrome | EmailChrome;
  body: {
    rows: CreativeRow[];
    /** Free grid (popup v2, `POPUP_GRID_COLS` columns). When present, renderers prefer it over rows. */
    grid?: { items: GridItem[]; elements: CreativeElement[] };
  };
  i18n?: Record<string, CreativeI18nLocale>;
};

export type PushChannelDesign = {
  title: string;
  body: string;
  imageUrl?: string | null;
  i18n?: Record<
    string,
    {
      title?: string;
      body?: string;
      imageUrl?: string;
      /**
       * Editor metadata (never rendered, ignored by `resolvePushForLocale`): the Thai
       * title/body the overlay was translated against, stamped when the EN field is
       * written. Used to detect when the Thai source has since changed underneath the
       * translation (staleness warning in the admin UI).
       */
      sourceTitle?: string;
      sourceBody?: string;
    }
  >;
};

export type MarketingCreativeChannels = {
  schemaVersion: 1;
  popup?: ChannelDesign;
  inApp?: ChannelDesign;
  email?: ChannelDesign;
  push?: PushChannelDesign;
};

export type CreativeLayoutDesign = ChannelDesign & { schemaVersion: 1 };

/** `meta` for a public promotion landing page. Replaces PopupChrome in PageLayoutDesign. */
export type PageChrome = {
  /** URL segment: /promotions/<slug> — ^[a-z0-9-]{3,80}$ */
  slug: string;
  seoTitle?: string;
  seoDescription?: string;
  ogImageUrl?: string;
  /** Max content width in px. Default 1200. */
  maxWidthPx?: number;
  /** 'fixed' (default) = คุมความกว้างด้วย maxWidthPx · 'full' = กว้างเต็มจอ + padding */
  widthMode?: 'fixed' | 'full';
  /** ระยะขอบซ้าย-ขวาเมื่อ widthMode='full'; default 24 */
  paddingXPx?: number;
  backgroundColor?: string;
  backgroundImageUrl?: string;
};

/** Same body shape as CreativeLayoutDesign — only `meta` differs. */
export type PageLayoutDesign = {
  schemaVersion: 1;
  meta: PageChrome;
  body: {
    rows: CreativeRow[];
    /** Free grid (`POPUP_GRID_COLS` columns). When present, the page renderer prefers it over rows. */
    grid?: { items: GridItem[]; elements: CreativeElement[] };
  };
  i18n?: Record<string, CreativeI18nLocale>;
};

/**
 * Narrower than `isCreativeLayoutDesign`: also requires `meta.slug` (string) and
 * `meta.locale` ('th' | 'en'), so a popup layout does not pass as a page layout.
 */
export function isPageLayoutDesign(value: unknown): value is PageLayoutDesign {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  if ((value as { schemaVersion?: unknown }).schemaVersion !== 1) {
    return false;
  }
  const body = (value as { body?: unknown }).body;
  if (!body || typeof body !== 'object' || !Array.isArray((body as { rows?: unknown }).rows)) {
    return false;
  }
  const meta = (value as { meta?: unknown }).meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return false;
  }
  const { slug } = meta as { slug?: unknown };
  return typeof slug === 'string' && slug.length > 0;
}

/**
 * Flattens an element's breakpoint overrides into a plain element for `bp`.
 * Merge order is base <- styleMd <- styleLg; `lg` inherits `md` when `styleLg` is absent.
 * Returns a new object; the input is never mutated. `styleMd`/`styleLg` are stripped
 * from the result so renderers only ever read `style`.
 */
export function resolveResponsive<T extends CreativeElement>(element: T, bp: Breakpoint): T {
  const source = element as unknown as {
    style?: Record<string, unknown>;
    styleMd?: Record<string, unknown>;
    styleLg?: Record<string, unknown>;
  };

  const overrides: Array<Record<string, unknown> | undefined> =
    bp === 'base' ? [] : bp === 'md' ? [source.styleMd] : [source.styleMd, source.styleLg];

  const merged: Record<string, unknown> = { ...(source.style ?? {}) };
  for (const override of overrides) {
    if (override) {
      Object.assign(merged, override);
    }
  }

  const out = { ...(element as unknown as Record<string, unknown>) };
  delete out['styleMd'];
  delete out['styleLg'];
  if (source.style !== undefined || Object.keys(merged).length > 0) {
    out['style'] = merged;
  }
  return out as unknown as T;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

function blockToElement(block: MarketingTemplateBlock): CreativeElement {
  switch (block.type) {
    case 'text':
      return { id: block.id, type: 'text', text: block.text };
    case 'image':
      return { id: block.id, type: 'image', src: block.url };
    case 'coupon':
      return {
        id: block.id,
        type: 'coupon',
        legacyCode: block.code,
      };
    case 'button':
      return {
        id: block.id,
        type: 'button',
        label: block.label,
        action: block.action,
        ...(block.url !== undefined ? { url: block.url } : {}),
      };
    default: {
      const _exhaustive: never = block;
      return _exhaustive;
    }
  }
}

/** Requires `Array.isArray(body.rows)` — a schemaVersion:1 shell with no rows array is not a design. */
export function isCreativeLayoutDesign(value: unknown): value is CreativeLayoutDesign {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  if ((value as { schemaVersion?: unknown }).schemaVersion !== 1) {
    return false;
  }
  const body = (value as { body?: unknown }).body;
  if (!body || typeof body !== 'object') {
    return false;
  }
  return Array.isArray((body as { rows?: unknown }).rows);
}

export function migrateBlocksToChannelDesign(
  blocks: MarketingTemplateBlock[],
  meta: PopupChrome | InAppChrome | EmailChrome = {},
): ChannelDesign {
  const elements = blocks.map(blockToElement);
  return {
    meta,
    body: {
      rows: [
        {
          id: nextId('row'),
          columns: [
            {
              id: nextId('col'),
              widthPercent: 100,
              elements,
            },
          ],
        },
      ],
    },
  };
}

function projectElementToBlock(element: CreativeElement, blocks: MarketingTemplateBlock[]): void {
  switch (element.type) {
    case 'text':
      blocks.push({ id: element.id, type: 'text', text: element.text });
      break;
    case 'image':
      blocks.push({ id: element.id, type: 'image', url: element.src });
      break;
    case 'coupon':
      if (element.legacyCode) {
        blocks.push({ id: element.id, type: 'coupon', code: element.legacyCode });
      } else if (element.couponId) {
        blocks.push({ id: element.id, type: 'coupon', code: element.couponId });
      }
      break;
    case 'button':
      blocks.push({
        id: element.id,
        type: 'button',
        label: element.label,
        action: element.action,
        ...(element.url !== undefined ? { url: element.url } : {}),
      });
      break;
    case 'spacer':
    case 'divider':
      break;
    case 'video':
    case 'html':
    case 'countdown':
    case 'carousel':
    // Page-builder-only element types have no template-block equivalent (blocks
    // back popup/notify templates, not promotion pages) — nothing to project.
    case 'product_grid':
    case 'rich_text':
    case 'accordion':
      break;
    default: {
      const _exhaustive: never = element;
      void _exhaustive;
    }
  }
}

export function projectChannelDesignToBlocks(design: ChannelDesign): MarketingTemplateBlock[] {
  const blocks: MarketingTemplateBlock[] = [];

  const grid = design.body.grid;
  if (grid && grid.elements.length > 0) {
    const itemByElementId = new Map(grid.items.map((item) => [item.elementId, item]));
    const ordered = grid.elements
      .map((element, index) => ({ element, item: itemByElementId.get(element.id), index }))
      .sort((a, b) => {
        if (!a.item && !b.item) return a.index - b.index;
        if (!a.item) return 1;
        if (!b.item) return -1;
        if (a.item.row !== b.item.row) return a.item.row - b.item.row;
        if (a.item.col !== b.item.col) return a.item.col - b.item.col;
        return a.index - b.index;
      });
    for (const { element } of ordered) {
      projectElementToBlock(element, blocks);
    }
    return blocks;
  }

  const walkRows = (rows: CreativeRow[]) => {
    for (const row of rows) {
      for (const column of row.columns) {
        for (const element of column.elements) {
          projectElementToBlock(element, blocks);
        }
        if (column.rows?.length) {
          walkRows(column.rows);
        }
      }
    }
  };

  walkRows(design.body.rows ?? []);
  return blocks;
}

function overlayString(base: string | undefined, override: string | undefined): string | undefined {
  return typeof override === 'string' && override.trim() ? override : base;
}

function isNonEmptyString(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** True only if this overlay contributes at least one non-empty-after-trim string value. */
function isMeaningfulElementOverlay(overlay: CreativeI18nOverlay): boolean {
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
      (slide) =>
        Boolean(slide) &&
        (isNonEmptyString(slide.src) || isNonEmptyString(slide.alt) || isNonEmptyString(slide.linkUrl)),
    ),
  );
}

/** Element types whose schema carries a translatable field of some kind. */
export function elementHasTranslatableContent(type: CreativeElement['type']): boolean {
  return (
    type === 'text' ||
    type === 'image' ||
    type === 'button' ||
    type === 'html' ||
    type === 'countdown' ||
    type === 'carousel' ||
    type === 'rich_text' ||
    type === 'accordion'
  );
}

type OverlaySlideLike = { src?: string; alt?: string; linkUrl?: string };

/**
 * Prune empty carousel slide fields; drop the whole array when every slide ends up
 * empty. Shared by the popup editor's overlay-field patcher and by
 * `reindexOverlayImagesPositional` below, so "cleared" always collapses back to
 * "never translated" and a reorder/delete/add never leaves a stale `''` entry.
 */
export function pruneOverlaySlides(images: OverlaySlideLike[] | undefined): OverlaySlideLike[] | undefined {
  if (!images) return images;
  const pruned = images.map((slide) => {
    const next: OverlaySlideLike = {};
    if (isNonEmptyString(slide?.src)) next.src = slide.src;
    if (isNonEmptyString(slide?.alt)) next.alt = slide.alt;
    if (isNonEmptyString(slide?.linkUrl)) next.linkUrl = slide.linkUrl;
    return next;
  });
  const hasAny = pruned.some((slide) => Object.keys(slide).length > 0);
  return hasAny ? pruned : undefined;
}

/**
 * Apply a positional structural transform (reorder/add/delete) to a carousel
 * element's overlay `images` array, the same way it is applied to the base
 * `images` array, so `overlay.images[N]` keeps overlaying `images[N]` afterwards.
 *
 * Overlay arrays are only dense up to the highest *edited* index, so they are
 * routinely shorter than the base — `Array.prototype.splice` clamps an
 * out-of-range `start` to the array length, which silently misattributes
 * translations to the wrong slide (or persists a hole that serializes to `null`)
 * if applied to a short overlay directly. Padding to `baseLength` (the base
 * element's `images.length` BEFORE the transform) with `{}` before transforming
 * fixes both: every index the transform touches already exists, so nothing
 * clamps and nothing is ever `undefined`. Pruned afterwards through
 * `pruneOverlaySlides` so the stored overlay never grows unboundedly.
 */
export function reindexOverlayImagesPositional(
  images: OverlaySlideLike[] | undefined,
  baseLength: number,
  transform: (images: OverlaySlideLike[]) => OverlaySlideLike[],
): OverlaySlideLike[] | undefined {
  if (!images) return images;
  const padded = Array.from({ length: Math.max(baseLength, images.length) }, (_, i) => ({
    ...(images[i] ?? {}),
  }));
  return pruneOverlaySlides(transform(padded));
}

/** Map `fn` over every element in a design, in both the rows tree and the free grid. */
function mapAllElements(
  design: ChannelDesign,
  fn: (element: CreativeElement) => CreativeElement,
): ChannelDesign {
  const mapRows = (rows: CreativeRow[]): CreativeRow[] =>
    rows.map((row) => ({
      ...row,
      columns: row.columns.map((column) => ({
        ...column,
        elements: column.elements.map(fn),
        rows: column.rows?.length ? mapRows(column.rows) : column.rows,
      })),
    }));
  return {
    ...design,
    body: {
      ...design.body,
      rows: design.body.rows ? mapRows(design.body.rows) : design.body.rows,
      grid: design.body.grid
        ? { ...design.body.grid, elements: design.body.grid.elements.map(fn) }
        : design.body.grid,
    },
  };
}

/** Find an element by id anywhere in a design (rows tree or free grid). */
function findElementById(design: ChannelDesign, elementId: string): CreativeElement | undefined {
  const searchRows = (rows: CreativeRow[]): CreativeElement | undefined => {
    for (const row of rows) {
      for (const column of row.columns) {
        const found = column.elements.find((el) => el.id === elementId);
        if (found) return found;
        if (column.rows?.length) {
          const nested = searchRows(column.rows);
          if (nested) return nested;
        }
      }
    }
    return undefined;
  };
  return (
    (design.body.rows ? searchRows(design.body.rows) : undefined) ??
    design.body.grid?.elements.find((el) => el.id === elementId)
  );
}

/**
 * Structural carousel edit (reorder/add/delete a slide): applies `transform` to the
 * base element's `images` AND, via `reindexOverlayImagesPositional`, to that
 * element's overlay `images` in EVERY locale, in one pass — so a base reshuffle
 * never leaves a locale's overlay pointing at the wrong slide. Works across both
 * design shapes (nested rows and the free grid), which is why `useChannelBodyEditor`
 * and `useGridEditor` (apps/web-admin/.../creative-editor/use-channel-body-editor.ts
 * and use-grid-editor.ts) both delegate to this instead of keeping their own copies.
 */
export function applyCarouselImagesTransform(
  design: ChannelDesign,
  elementId: string,
  transform: (images: OverlaySlideLike[]) => OverlaySlideLike[],
): ChannelDesign {
  const baseElement = findElementById(design, elementId);
  const baseLength =
    baseElement && baseElement.type === 'carousel' ? (baseElement.images ?? []).length : 0;

  const withBase = mapAllElements(design, (el) =>
    el.id === elementId && el.type === 'carousel'
      ? ({ ...el, images: transform(el.images ?? []) } as CreativeElement)
      : el,
  );

  if (!withBase.i18n) return withBase;
  const i18n = Object.fromEntries(
    Object.entries(withBase.i18n).map(([code, entry]) => {
      const overlay = entry.elements?.[elementId];
      if (!overlay?.images) return [code, entry];
      const pruned = reindexOverlayImagesPositional(overlay.images, baseLength, transform);
      const nextOverlay: CreativeI18nOverlay = { ...overlay };
      if (pruned) nextOverlay.images = pruned;
      else delete nextOverlay.images;
      const nextElements = { ...entry.elements };
      if (Object.keys(nextOverlay).length === 0) delete nextElements[elementId];
      else nextElements[elementId] = nextOverlay;
      return [code, { ...entry, elements: nextElements }];
    }),
  );
  return { ...withBase, i18n };
}

function applyOverlay(element: CreativeElement, overlay: CreativeI18nOverlay): CreativeElement {
  const next = { ...element } as Record<string, unknown>;
  const type = element.type;
  if (type === 'text') next.text = overlayString((element as { text?: string }).text, overlay.text);
  if (type === 'button') {
    next.label = overlayString((element as { label?: string }).label, overlay.label);
    next.url = overlayString((element as { url?: string }).url, overlay.url);
  }
  if (type === 'image') {
    next.alt = overlayString((element as { alt?: string }).alt, overlay.alt);
    next.src = overlayString((element as { src?: string }).src, overlay.src);
  }
  if (type === 'html' || type === 'rich_text') {
    next.html = overlayString((element as { html?: string }).html, overlay.html);
  }
  if (type === 'accordion') {
    const items = (element as { items?: Array<{ id: string; title: string; body: string }> }).items ?? [];
    next.items = items.map((item, index) => {
      const tr = overlay.items?.[index];
      if (!tr) return item;
      return {
        ...item,
        title: overlayString(item.title, tr.title) as string,
        body: overlayString(item.body, tr.body) as string,
      };
    });
  }
  if (type === 'countdown') {
    next.expiredText = overlayString((element as { expiredText?: string }).expiredText, overlay.expiredText);
  }
  if (type === 'carousel') {
    const images = (element as { images?: Array<{ src?: string; alt?: string; linkUrl?: string }> }).images ?? [];
    next.images = images.map((image, index) => {
      const slide = overlay.images?.[index];
      if (!slide) return image;
      return {
        ...image,
        src: overlayString(image.src, slide.src) as string,
        alt: overlayString(image.alt, slide.alt),
        linkUrl: overlayString(image.linkUrl, slide.linkUrl),
      };
    });
  }
  return next as CreativeElement;
}

/**
 * Merge a locale's overlay into a design. Returns the SAME reference when there is
 * nothing to overlay, so callers can short-circuit on identity.
 */
export function resolveDesignForLocale(
  design: ChannelDesign,
  locale: string | null | undefined,
): ChannelDesign {
  if (!locale) return design;
  const entry = design.i18n?.[locale];
  if (!entry) return design;
  const elementOverlays = entry.elements ?? {};
  const hasElements = Object.values(elementOverlays).some(isMeaningfulElementOverlay);
  // Page chrome (`PageLayoutDesign.meta`) carries SEO fields too. Popup/in-app/
  // email chrome never sets them, so those designs still short-circuit below.
  const hasChrome = Boolean(
    entry.chrome &&
      (isNonEmptyString(entry.chrome.dismissLabel) ||
        isNonEmptyString(entry.chrome.backgroundImageUrl) ||
        isNonEmptyString(entry.chrome.seoTitle) ||
        isNonEmptyString(entry.chrome.seoDescription) ||
        isNonEmptyString(entry.chrome.ogImageUrl)),
  );
  if (!hasElements && !hasChrome) return design;

  const mapElement = (element: CreativeElement): CreativeElement => {
    const overlay = elementOverlays[element.id];
    return overlay ? applyOverlay(element, overlay) : element;
  };

  const mapRows = (rows: CreativeRow[]): CreativeRow[] =>
    rows.map((row) => ({
      ...row,
      columns: row.columns.map((column) => ({
        ...column,
        elements: column.elements.map(mapElement),
        rows: column.rows?.length ? mapRows(column.rows) : column.rows,
      })),
    }));

  const meta = hasChrome
    ? {
        ...design.meta,
        ...(entry.chrome?.dismissLabel && 'dismissButton' in design.meta && design.meta.dismissButton
          ? { dismissButton: { ...design.meta.dismissButton, label: entry.chrome.dismissLabel } }
          : {}),
        ...(entry.chrome?.backgroundImageUrl
          ? { backgroundImageUrl: entry.chrome.backgroundImageUrl }
          : {}),
        // Only non-empty overlay values win: a blank EN value is treated as
        // "not translated" and falls back to the base (Thai) text.
        ...(entry.chrome?.seoTitle ? { seoTitle: entry.chrome.seoTitle } : {}),
        ...(entry.chrome?.seoDescription
          ? { seoDescription: entry.chrome.seoDescription }
          : {}),
        ...(entry.chrome?.ogImageUrl ? { ogImageUrl: entry.chrome.ogImageUrl } : {}),
      }
    : design.meta;

  return {
    ...design,
    meta: meta as ChannelDesign['meta'],
    body: {
      ...design.body,
      rows: mapRows(design.body.rows ?? []),
      grid: design.body.grid
        ? { ...design.body.grid, elements: design.body.grid.elements.map(mapElement) }
        : design.body.grid,
    },
  };
}

/** Same contract as resolveDesignForLocale, for the flat push design. */
export function resolvePushForLocale(
  push: PushChannelDesign,
  locale: string | null | undefined,
): PushChannelDesign {
  if (!locale) return push;
  const entry = push.i18n?.[locale];
  if (
    !entry ||
    (!isNonEmptyString(entry.title) && !isNonEmptyString(entry.body) && !isNonEmptyString(entry.imageUrl))
  ) {
    return push;
  }
  return {
    ...push,
    title: overlayString(push.title, entry.title) as string,
    body: overlayString(push.body, entry.body) as string,
    imageUrl: overlayString(push.imageUrl ?? undefined, entry.imageUrl) ?? push.imageUrl ?? null,
  };
}

export function ensureTemplateChannels(input: {
  templateType: 'notify' | 'popup';
  blocks: MarketingTemplateBlock[] | null | undefined;
  title: string;
  body: string;
  imageUrl: string | null;
  channels: MarketingCreativeChannels | null | undefined;
}): MarketingCreativeChannels {
  if (input.channels?.schemaVersion === 1) {
    return {
      ...input.channels,
      push: input.channels.push ?? {
        title: input.title,
        body: input.body,
        imageUrl: input.imageUrl,
      },
    };
  }
  const design = migrateBlocksToChannelDesign(input.blocks ?? []);
  const push = { title: input.title, body: input.body, imageUrl: input.imageUrl };
  if (input.templateType === 'popup') {
    return { schemaVersion: 1, popup: design, push };
  }
  return { schemaVersion: 1, inApp: design, push };
}

/** Declarative form descriptor consumed by `ElementInspector` in web-admin. */
/**
 * Collapsible sections of the element inspector, in render order:
 * เนื้อหา · รูปแบบ · ระยะห่าง · การแสดงผลต่อจอ.
 */
export type InspectorFieldGroup = 'content' | 'style' | 'spacing' | 'display';

export type FieldDescriptor = {
  key: string;
  label: string;
  control:
    | 'text'
    | 'textarea'
    | 'number'
    | 'select'
    | 'toggle'
    | 'color'
    | 'sku-picker'
    | 'category-picker'
    | 'list';
  options?: Array<{ value: string; label: string }>;
  /** Render this field only when another field currently equals the given value. */
  visibleWhen?: { key: string; equals: unknown };
  /**
   * Which collapsible inspector section this field belongs to. Presentation
   * only — it changes nothing about how the value is read or written.
   * Defaults to `'content'` (เนื้อหา, the section open by default).
   */
  group?: InspectorFieldGroup;
};

/**
 * Only the three page-builder element types are descriptor-driven.
 * The 10 pre-existing types keep their hand-written switch-case inspectors.
 */
export const ELEMENT_FIELD_SCHEMA: Record<
  'product_grid' | 'rich_text' | 'accordion',
  FieldDescriptor[]
> = {
  product_grid: [
    {
      key: 'source.kind',
      label: 'แหล่งสินค้า',
      control: 'select',
      options: [
        { value: 'skus', label: 'เลือก SKU เอง' },
        { value: 'category', label: 'ตามหมวดหมู่' },
        { value: 'promotion', label: 'ตามโปรโมชันของหน้านี้' },
      ],
    },
    {
      key: 'source.skus',
      label: 'รายการ SKU',
      control: 'sku-picker',
      visibleWhen: { key: 'source.kind', equals: 'skus' },
    },
    {
      key: 'source.categoryId',
      label: 'หมวดหมู่',
      control: 'category-picker',
      visibleWhen: { key: 'source.kind', equals: 'category' },
    },
    {
      key: 'source.limit',
      label: 'จำนวนสูงสุด',
      control: 'number',
      visibleWhen: { key: 'source.kind', equals: 'category' },
    },
    {
      key: 'columns',
      label: 'จำนวนคอลัมน์ (จอใหญ่)',
      control: 'select',
      options: [
        { value: '2', label: '2 คอลัมน์' },
        { value: '3', label: '3 คอลัมน์' },
        { value: '4', label: '4 คอลัมน์' },
      ],
    },
    { key: 'showPrice', label: 'แสดงราคา', control: 'toggle' },
    { key: 'showBadge', label: 'แสดงป้ายโปรโมชัน', control: 'toggle' },
  ],
  rich_text: [
    { key: 'html', label: 'เนื้อหา', control: 'textarea' },
    {
      key: 'style.align',
      label: 'จัดวาง',
      control: 'select',
      group: 'style',
      options: [
        { value: 'left', label: 'ชิดซ้าย' },
        { value: 'center', label: 'กึ่งกลาง' },
        { value: 'right', label: 'ชิดขวา' },
      ],
    },
    { key: 'style.fontSizePx', label: 'ขนาดตัวอักษร (px)', control: 'number', group: 'style' },
    { key: 'style.color', label: 'สีตัวอักษร', control: 'color', group: 'style' },
  ],
  accordion: [
    { key: 'items', label: 'รายการหัวข้อ', control: 'list' },
    { key: 'allowMultiOpen', label: 'เปิดพร้อมกันได้หลายหัวข้อ', control: 'toggle' },
  ],
};
