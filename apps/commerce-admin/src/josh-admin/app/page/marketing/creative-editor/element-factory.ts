// @ts-nocheck — copied unchanged from josh web-admin, which has the same type errors in this file (josh type debt, not a commerce change).
import {
  POPUP_GRID_COLS,
  normalizePopupGridItem,
  popupGridNeedsLegacyScale,
} from '@josh/shared-api';
import type {
  ChannelDesign,
  CreativeColumn,
  CreativeElement,
  CreativeRow,
  EmailChrome,
  GridItem,
  PageChrome,
  PageLayoutDesign,
} from './creative-editor.types';

/** Default popup chrome — white panel, wide enough for banner/image creatives. */
export const DEFAULT_POPUP_CHROME = {
  widthPx: 720,
  borderRadiusPx: 16,
  backgroundColor: '#ffffff',
} as const;

/** New default popup skeleton — one row, one full-width column. */
export function newPopupDesign(): ChannelDesign {
  return {
    meta: {},
    body: { rows: [newRow()] },
  };
}

/** Default email chrome — matches ChannelCanvas email preview defaults. */
export const DEFAULT_EMAIL_CHROME: EmailChrome = {
  contentWidthPx: 600,
  backgroundColor: '#f4f4f4',
  contentBackgroundColor: '#ffffff',
};

/** Empty email canvas skeleton for "+ Template Email" create flow. */
export function newEmailDesign(): ChannelDesign {
  return {
    meta: { ...DEFAULT_EMAIL_CHROME },
    body: { rows: [newRow()] },
  };
}

/** Default page chrome — 1200px content column on white, matching the shop container width. */
export const DEFAULT_PAGE_CHROME: Omit<PageChrome, 'slug'> = {
  maxWidthPx: 1200,
  backgroundColor: '#ffffff',
};

/**
 * New promotion-page skeleton — an empty free grid.
 *
 * Pages author on the same 8-column collision grid as popups (`body.grid`):
 * a marketer drags an element anywhere and resizes it by its edges, with no
 * row/column structure to set up first. `rows` stays as an empty array because
 * it is the legacy fallback the storefront still renders for pages created
 * before the switch — and because `isPageLayoutDesign` requires the key.
 *
 * There is no `locale` argument: `PageChrome` has no locale field. One page
 * record serves both languages — Thai is the base design and English lives in
 * `design.i18n.en` as a sparse overlay (see `useCreativeI18n`).
 */
export function newPageDesign(slug: string): PageLayoutDesign {
  return {
    schemaVersion: 1,
    meta: { ...DEFAULT_PAGE_CHROME, slug },
    body: { rows: [], grid: { items: [], elements: [] } },
  };
}

export function newRow(): CreativeRow {
  return { id: crypto.randomUUID(), columns: [newColumn(100)] };
}

export function newColumn(widthPercent: number): CreativeColumn {
  return { id: crypto.randomUUID(), widthPercent, elements: [] };
}

export function newCreativeElement(type: CreativeElement['type']): CreativeElement {
  const id = crypto.randomUUID();
  switch (type) {
    case 'text':
      return { id, type: 'text', text: '', style: { fontSizePx: 14 } };
    case 'image':
      return { id, type: 'image', src: '' };
    case 'button':
      return {
        id,
        type: 'button',
        label: 'ปุ่มใหม่',
        action: 'go_url',
        url: '/cart/placement',
        style: {
          widthPercent: 100,
          fullWidth: true,
          backgroundColor: '#171717',
          color: '#ffffff',
        },
      };
    case 'coupon':
      return { id, type: 'coupon' };
    case 'spacer':
      return { id, type: 'spacer', heightPx: 16 };
    case 'divider':
      return { id, type: 'divider' };
    case 'video':
      return { id, type: 'video', src: '', playMode: 'click', style: { aspectRatio: '16/9' } };
    case 'html':
      return { id, type: 'html', html: '<p>Custom HTML</p>' };
    case 'countdown':
      return {
        id,
        type: 'countdown',
        targetDatetime: new Date(Date.now() + 86400000).toISOString(),
        format: 'dhms',
        expiredText: 'หมดเวลาแล้ว',
        style: { align: 'center' },
      };
    case 'carousel':
      return { id, type: 'carousel', images: [], autoPlaySeconds: 3, style: { aspectRatio: '16/9' } };
    case 'product_grid':
      return {
        id,
        type: 'product_grid',
        source: { kind: 'promotion' },
        columns: 3,
        showPrice: true,
        showBadge: true,
      };
    case 'rich_text':
      return { id, type: 'rich_text', html: '<p>ข้อความ</p>' };
    case 'accordion':
      return { id, type: 'accordion', items: [], allowMultiOpen: false };
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export const ELEMENT_TYPES: Array<{ type: CreativeElement['type']; label: string }> = [
  { type: 'text', label: 'ข้อความ' },
  { type: 'image', label: 'รูปภาพ' },
  { type: 'button', label: 'ปุ่ม' },
  { type: 'coupon', label: 'คูปอง' },
  { type: 'spacer', label: 'ระยะห่าง' },
  { type: 'divider', label: 'เส้นคั่น' },
  { type: 'video', label: 'วิดีโอ' },
  { type: 'html', label: 'HTML' },
  { type: 'countdown', label: 'นับถอยหลัง' },
  { type: 'carousel', label: 'สไลด์รูป' },
];

/**
 * Palette for the promotion-page editor: the three page-only types first, then
 * every shared type.
 *
 * Why all 13 and not a filtered subset: nothing in `ELEMENT_TYPES` is
 * popup-specific at render time — countdown, carousel and video are landing-page
 * staples, and the shop page renderer (`CreativeBodyRenderer`) already handles
 * every type. The filtering that matters runs the other way: `product_grid`,
 * `rich_text` and `accordion` are deliberately kept OUT of `ELEMENT_TYPES` so
 * the popup and email palettes don't offer them — the backend email projection
 * (`projectChannelDesignToBlocks`) has no block type for them and would drop
 * them silently.
 */
export const PAGE_ELEMENT_TYPES: Array<{ type: CreativeElement['type']; label: string }> = [
  { type: 'rich_text', label: 'ข้อความ (Rich)' },
  { type: 'product_grid', label: 'กริดสินค้า' },
  { type: 'accordion', label: 'คำถามพบบ่อย' },
  ...ELEMENT_TYPES,
];

/** Split widths evenly across `count` columns — used after add/remove column. */
export function evenWidths(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(100 / count);
  const widths = new Array(count).fill(base);
  widths[widths.length - 1] = 100 - base * (count - 1);
  return widths;
}

/** Add a second (or nth) column to a row, redistributing widths evenly (50/50 for the common case). */
export function addColumnToRow(row: CreativeRow): CreativeRow {
  const columns = [...row.columns, newColumn(0)];
  const widths = evenWidths(columns.length);
  return {
    ...row,
    columns: columns.map((column, index) => ({ ...column, widthPercent: widths[index] })),
  };
}

export type RowColumnPreset = 1 | 2 | 3;

/**
 * Set a row to 1 / 2 / 3 equal-width columns (Unlayer-style layout preset).
 * Growing adds empty columns; shrinking merges elements from removed columns
 * onto the last remaining column so nothing is lost.
 */
export function setRowColumnCount(row: CreativeRow, count: RowColumnPreset): CreativeRow {
  const target = Math.min(3, Math.max(1, count)) as RowColumnPreset;
  let columns = row.columns.map((column) => ({
    ...column,
    elements: [...column.elements],
    rows: column.rows ? column.rows.map((nested) => ({ ...nested })) : column.rows,
  }));
  if (columns.length === 0) {
    columns = [newColumn(100)];
  }

  if (columns.length < target) {
    while (columns.length < target) {
      columns.push(newColumn(0));
    }
  } else if (columns.length > target) {
    const kept = columns.slice(0, target);
    const removed = columns.slice(target);
    const lastIndex = kept.length - 1;
    kept[lastIndex] = {
      ...kept[lastIndex],
      elements: [...kept[lastIndex].elements, ...removed.flatMap((column) => column.elements)],
      rows: [
        ...(kept[lastIndex].rows ?? []),
        ...removed.flatMap((column) => column.rows ?? []),
      ],
    };
    columns = kept;
  }

  const widths = evenWidths(columns.length);
  return {
    ...row,
    columns: columns.map((column, index) => ({ ...column, widthPercent: widths[index] })),
  };
}

function cloneRow(row: CreativeRow, idMap: Map<string, string>): CreativeRow {
  return {
    ...row,
    id: crypto.randomUUID(),
    columns: row.columns.map((column) => ({
      ...column,
      id: crypto.randomUUID(),
      elements: column.elements.map((element) => {
        const newId = crypto.randomUUID();
        idMap.set(element.id, newId);
        return { ...element, id: newId };
      }),
      rows: column.rows?.map((nested) => cloneRow(nested, idMap)),
    })),
  };
}

/** Remap a design's `i18n.elements` keys through `idMap`, dropping any id not in the map. */
function cloneI18n(
  i18n: ChannelDesign['i18n'],
  idMap: Map<string, string>,
): ChannelDesign['i18n'] {
  if (!i18n) return undefined;
  const cloned = Object.fromEntries(
    Object.entries(i18n).map(([locale, entry]) => {
      const elements = entry.elements
        ? Object.fromEntries(
            Object.entries(entry.elements)
              .filter(([elementId]) => idMap.has(elementId))
              .map(([elementId, overlay]) => [idMap.get(elementId) as string, overlay]),
          )
        : undefined;
      return [
        locale,
        {
          ...(elements ? { elements } : {}),
          ...(entry.chrome ? { chrome: entry.chrome } : {}),
        },
      ];
    }),
  );
  return cloned;
}

/** Deep-clone a design with fresh ids — used when a variant forks the default design. */
export function cloneChannelDesign(design: ChannelDesign): ChannelDesign {
  const grid = design.body.grid;
  if (!grid) {
    const rowsIdMap = new Map<string, string>();
    const rows = design.body.rows.map((row) => cloneRow(row, rowsIdMap));
    const i18n = cloneI18n(design.i18n, rowsIdMap);
    return {
      meta: { ...design.meta },
      body: { rows },
      ...(i18n ? { i18n } : {}),
    };
  }

  const idMap = new Map<string, string>();
  for (const element of grid.elements) {
    idMap.set(element.id, crypto.randomUUID());
  }
  const elements = grid.elements.map((element) => ({
    ...element,
    id: idMap.get(element.id) ?? crypto.randomUUID(),
  }));
  const items = grid.items
    .filter((item) => idMap.has(item.elementId))
    .map((item) => ({ ...item, elementId: idMap.get(item.elementId) as string }));

  const i18n = cloneI18n(design.i18n, idMap);

  return {
    meta: { ...design.meta },
    body: {
      rows: design.body.rows.map((row) => cloneRow(row, new Map<string, string>())),
      grid: { items, elements },
    },
    ...(i18n ? { i18n } : {}),
  };
}

export function removeColumnFromRow(row: CreativeRow, columnId: string): CreativeRow {
  const columns = row.columns.filter((column) => column.id !== columnId);
  if (columns.length === 0) return row;
  const widths = evenWidths(columns.length);
  return {
    ...row,
    columns: columns.map((column, index) => ({ ...column, widthPercent: widths[index] })),
  };
}

/** Default rowSpan per element type when converting or dropping (1 unit = 40px). */
export const DEFAULT_ROW_SPAN: Record<CreativeElement['type'], number> = {
  text: 2,
  image: 4,
  button: 2,
  coupon: 2,
  spacer: 1,
  divider: 1,
  video: 4,
  html: 3,
  countdown: 2,
  carousel: 4,
  // Product grid renders 1-2 rows of cards (image+title+price) — taller than a single image.
  product_grid: 6,
  // Rich text is free-form prose, closest in shape to the existing 'html' block.
  rich_text: 3,
  // Accordion starts collapsed (title bars only); grows with items, but a modest
  // default avoids reserving a huge empty area on a fresh element.
  accordion: 3,
};

/** Fresh popup design in grid mode (empty free grid). */
export function newPopupGridDesign(): ChannelDesign {
  return {
    meta: { ...DEFAULT_POPUP_CHROME },
    body: { rows: [], grid: { items: [], elements: [] } },
  };
}

/**
 * Ensure a popup design has a grid: converts a legacy rows design once.
 * Rows map to consecutive grid rows; column widthPercent maps to colSpan out of POPUP_GRID_COLS.
 * Nested rows are flattened in order. Returns the design unchanged if grid exists.
 */
export function ensureGridDesign(design: ChannelDesign): ChannelDesign {
  if (design.body.grid) return reconcileGridDesign(design);
  const items: GridItem[] = [];
  const elements: CreativeElement[] = [];
  let cursorRow = 0;
  const cols = POPUP_GRID_COLS;

  const placeRow = (row: CreativeRow) => {
    const total = row.columns.reduce((sum, c) => sum + (c.widthPercent || 1), 0) || 1;
    let col = 0;
    let rowHeight = 1;
    const pending: Array<{ el: CreativeElement; col: number; colSpan: number; row: number; rowSpan: number }> = [];
    const columnSpans: number[] = [];
    row.columns.forEach((column, index) => {
      const isLast = index === row.columns.length - 1;
      const colSpan = isLast
        ? Math.max(1, cols - col)
        : Math.max(1, Math.round(((column.widthPercent || 1) / total) * cols));
      const clampedSpan = Math.min(colSpan, cols - col);
      columnSpans.push(clampedSpan);
      let innerRow = cursorRow;
      for (const el of column.elements) {
        const span = DEFAULT_ROW_SPAN[el.type];
        pending.push({ el, col, colSpan: clampedSpan, row: innerRow, rowSpan: span });
        innerRow += span;
      }
      rowHeight = Math.max(rowHeight, innerRow - cursorRow);
      col = Math.min(cols - 1, col + colSpan);
    });
    for (const p of pending) {
      elements.push(p.el);
      items.push({ elementId: p.el.id, col: p.col, colSpan: p.colSpan, row: p.row, rowSpan: p.rowSpan });
    }
    cursorRow += rowHeight;

    // Nested rows flatten directly beneath this row block, depth-first,
    // before the next top-level (or sibling) row is placed.
    row.columns.forEach((column) => {
      for (const nested of column.rows ?? []) {
        placeRow(nested);
      }
    });
  };

  for (const row of design.body.rows) placeRow(row);

  return { ...design, body: { rows: [], grid: { items, elements } } };
}

/** Default colSpan for a newly placed grid element — matches useGridEditor's addElementAt default. */
export function defaultColSpanForType(type: CreativeElement['type']): number {
  return type === 'divider' || type === 'spacer' ? POPUP_GRID_COLS : 4;
}

/** Divider/spacer are separators: they always want the whole row, never a squeezed sliver. */
export function isFullWidthType(type: CreativeElement['type']): boolean {
  return type === 'divider' || type === 'spacer';
}

/**
 * Wix-like auto-fit for a dropped element: find the free horizontal gap at the drop
 * position and shrink/snap the new item into it, so it lands BESIDE its row
 * neighbours instead of colliding and being compacted underneath them.
 *
 * Rules:
 * - Only items whose row band `[row, row+rowSpan)` overlaps the target band count
 *   as occupying columns; everything else is irrelevant.
 * - The gap containing `col` wins; if `col` sits inside an occupied span, the
 *   nearest gap wins and `col` snaps to its left edge (dropping ON an element
 *   tucks the new one beside it, not under it).
 * - `colSpan` is clamped to the gap width; when the gap is wide enough for the
 *   default the item slides left just enough to fit the default fully.
 * - Full-width types (divider/spacer) and completely-full bands fall back to the
 *   requested position with only right-edge clamping — react-grid-layout's
 *   vertical compaction then pushes neighbours down, which is the sane result
 *   for a separator and the only possible result when there is no gap.
 */
export function computeAutoFitPlacement({
  items,
  type,
  col,
  row,
  rowSpan,
  cols = POPUP_GRID_COLS,
}: {
  items: GridItem[];
  type: CreativeElement['type'];
  col: number;
  row: number;
  rowSpan: number;
  cols?: number;
}): { col: number; colSpan: number } {
  const requestedCol = Math.max(0, Math.min(cols - 1, Math.round(col)));
  const targetRow = Math.max(0, Math.round(row));
  const band = Math.max(1, Math.round(rowSpan));
  const defaultSpan = defaultColSpanForType(type);
  const fallback = { col: requestedCol, colSpan: Math.min(defaultSpan, cols - requestedCol) };
  if (isFullWidthType(type)) return fallback;

  // Occupied column ranges in the target row band, merged.
  const occupied = items
    .filter((it) => it.row < targetRow + band && targetRow < it.row + Math.max(1, it.rowSpan))
    .map((it) => [Math.max(0, it.col), Math.min(cols, it.col + Math.max(1, it.colSpan))] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  const gaps: Array<[number, number]> = [];
  let cursor = 0;
  for (const [start, end] of occupied) {
    if (start > cursor) gaps.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < cols) gaps.push([cursor, cols]);

  const usable = gaps.filter(([s, e]) => e - s >= 1);
  if (usable.length === 0) return fallback;

  const containing = usable.find(([s, e]) => requestedCol >= s && requestedCol < e);
  const gap =
    containing ??
    usable.reduce((best, g) => {
      const d = requestedCol < g[0] ? g[0] - requestedCol : requestedCol - (g[1] - 1);
      const bd = requestedCol < best[0] ? best[0] - requestedCol : requestedCol - (best[1] - 1);
      return d < bd ? g : best;
    });

  const [gapStart, gapEnd] = gap;
  const gapWidth = gapEnd - gapStart;
  const colSpan = Math.min(defaultSpan, gapWidth);
  const startCol = containing
    ? Math.max(gapStart, Math.min(requestedCol, gapEnd - colSpan))
    : gapStart;
  return { col: startCol, colSpan };
}

/**
 * Reconcile an existing grid's items against its elements: drop items whose element
 * no longer exists, append a placed item for any element missing one, and snap
 * fractional / legacy-9-col placements onto POPUP_GRID_COLS integer tracks.
 * Returns the SAME design reference when nothing needs reconciling (callers rely
 * on this for effect-loop stability).
 */
/**
 * Page counterpart of `ensureGridDesign`'s reconcile half — and deliberately
 * NOT of its convert half.
 *
 * A page that still has `rows` and no `grid` is left exactly as it is. Popups
 * convert silently on open because the popup editor has no other mode left, but
 * a promotion page may be live: rows and grid lay out differently, so an
 * automatic rewrite on open would republish a visibly different page the next
 * time anyone pressed save. Conversion is an explicit, confirmed action —
 * `convertPageRowsToGrid` below.
 *
 * Returns the SAME reference when nothing needs reconciling, so the editor's
 * effect loop settles on the first render.
 */
export function reconcilePageGridDesign(design: PageLayoutDesign): PageLayoutDesign {
  if (!design.body.grid) return design;
  const reconciled = ensureGridDesign(design as unknown as ChannelDesign);
  return reconciled === (design as unknown as ChannelDesign)
    ? design
    : (reconciled as unknown as PageLayoutDesign);
}

/**
 * One-way rows → grid conversion for a legacy page, run from an explicit
 * "แปลงเป็น grid" action.
 *
 * `rows` is carried over untouched rather than emptied (which is what
 * `ensureGridDesign` does for popups): the storefront prefers `grid` whenever
 * it is present, so the old layout becomes inert but stays in the record as an
 * exact, revertible copy of what was published. Nothing is destroyed, and the
 * page's revision history keeps meaning something.
 */
export function convertPageRowsToGrid(design: PageLayoutDesign): PageLayoutDesign {
  const converted = ensureGridDesign({
    ...design,
    body: { rows: design.body.rows },
  } as unknown as ChannelDesign);
  return {
    ...design,
    body: {
      rows: design.body.rows,
      grid: converted.body.grid ?? { items: [], elements: [] },
    },
  };
}

function reconcileGridDesign(design: ChannelDesign): ChannelDesign {
  const grid = design.body.grid;
  if (!grid) return design;

  const elementIds = new Set(grid.elements.map((el) => el.id));
  const filtered = grid.items.filter((item) => elementIds.has(item.elementId));
  const itemElementIds = new Set(filtered.map((item) => item.elementId));
  const missing = grid.elements.filter((el) => !itemElementIds.has(el.id));

  const scaleFromLegacy9 = popupGridNeedsLegacyScale(filtered, POPUP_GRID_COLS);
  const snapItem = (item: GridItem): GridItem => ({
    ...item,
    ...normalizePopupGridItem(item, POPUP_GRID_COLS, { scaleFromLegacy9 }),
  });

  const snapped = filtered.map(snapItem);
  const needsSnap = snapped.some((item, i) => {
    const prev = filtered[i];
    return (
      item.col !== prev.col ||
      item.colSpan !== prev.colSpan ||
      item.row !== prev.row ||
      item.rowSpan !== prev.rowSpan
    );
  });

  if (filtered.length === grid.items.length && missing.length === 0 && !needsSnap) {
    return design;
  }

  let cursorRow = snapped.reduce((max, item) => Math.max(max, item.row + item.rowSpan), 0);
  const newItems: GridItem[] = [...snapped];
  for (const element of missing) {
    const colSpan = Math.min(defaultColSpanForType(element.type), POPUP_GRID_COLS);
    const rowSpan = DEFAULT_ROW_SPAN[element.type];
    newItems.push({ elementId: element.id, col: 0, colSpan, row: cursorRow, rowSpan });
    cursorRow += rowSpan;
  }

  return { ...design, body: { ...design.body, grid: { items: newItems, elements: grid.elements } } };
}
