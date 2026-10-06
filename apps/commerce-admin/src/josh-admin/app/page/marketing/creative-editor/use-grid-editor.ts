import { useState } from 'react';
import { applyCarouselImagesTransform, POPUP_GRID_COLS } from '@josh/shared-api';
import { computeAutoFitPlacement, DEFAULT_ROW_SPAN, newCreativeElement } from './element-factory';
import { useCreativeI18n } from './use-creative-i18n';
import type { ChannelDesign, CreativeElement, GridItem } from './creative-editor.types';

/**
 * State + mutations for the popup free-grid editor (`POPUP_GRID_COLS` columns).
 * Requires design.body.grid to exist (call ensureGridDesign before using).
 */
export function useGridEditor(design: ChannelDesign, onChange: (design: ChannelDesign) => void) {
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  // Pure overlay helpers only — editorLocale is irrelevant to dropOverlay/copyOverlay.
  const { dropOverlay, copyOverlay } = useCreativeI18n(design, onChange, 'th');

  const grid = design.body.grid ?? { items: [], elements: [] };
  const { items, elements } = grid;

  const selectedElement =
    (selectedElementId && elements.find((el) => el.id === selectedElementId)) || null;
  const selectedItem =
    (selectedElementId && items.find((it) => it.elementId === selectedElementId)) || null;

  const writeGrid = (nextItems: GridItem[], nextElements: CreativeElement[]) => {
    onChange({ ...design, body: { ...design.body, grid: { items: nextItems, elements: nextElements } } });
  };

  /**
   * Drop a new element of `type` at (col, row). The width auto-fits the free gap
   * at that spot (see `computeAutoFitPlacement`) so dropping beside an existing
   * element keeps both on the same row instead of pushing one down.
   */
  const addElementAt = (type: CreativeElement['type'], col: number, row: number) => {
    const element = newCreativeElement(type);
    const rowSpan = DEFAULT_ROW_SPAN[type];
    const targetRow = Math.max(0, Math.round(row));
    const fit = computeAutoFitPlacement({
      items,
      type,
      col,
      row: targetRow,
      rowSpan,
      cols: POPUP_GRID_COLS,
    });
    const item: GridItem = {
      elementId: element.id,
      col: fit.col,
      colSpan: fit.colSpan,
      row: targetRow,
      rowSpan,
    };
    writeGrid([...items, item], [...elements, element]);
    setSelectedElementId(element.id);
  };

  /** Write back all positions after react-grid-layout drag/resize/compaction. */
  const applyLayout = (layout: Array<{ i: string; x: number; y: number; w: number; h: number }>) => {
    const byId = new Map(layout.map((l) => [l.i, l]));
    const nextItems = items.map((it) => {
      const l = byId.get(it.elementId);
      if (!l) return it;
      // Integers only — fractional x/w break CSS grid on shop-web.
      const col = Math.max(0, Math.min(POPUP_GRID_COLS - 1, Math.round(l.x)));
      const colSpan = Math.max(1, Math.min(POPUP_GRID_COLS - col, Math.round(l.w)));
      return {
        ...it,
        col,
        colSpan,
        row: Math.max(0, Math.round(l.y)),
        rowSpan: Math.max(1, Math.round(l.h)),
      };
    });
    // react-grid-layout fires onLayoutChange once on mount (and again whenever the
    // canvas remounts, e.g. switching viewport back to desktop). Writing an
    // identical layout back would mark an untouched page as edited, so a no-op
    // layout is dropped here rather than round-tripping through onChange.
    // This hook is shared: the popup editor gets the same suppression, so a
    // popup that is merely opened no longer reports itself as having changes.
    const unchanged = nextItems.every((item, index) => {
      const prev = items[index];
      return (
        item.col === prev.col &&
        item.colSpan === prev.colSpan &&
        item.row === prev.row &&
        item.rowSpan === prev.rowSpan
      );
    });
    if (unchanged) return;

    writeGrid(nextItems, elements);
  };

  /** Patch any element by id — used by callers that hold the id themselves (breakpoint tools). */
  const patchElementById = (elementId: string, patch: Partial<CreativeElement>) => {
    writeGrid(
      items,
      elements.map((el) => (el.id === elementId ? ({ ...el, ...patch } as CreativeElement) : el)),
    );
  };

  const patchElement = (patch: Partial<CreativeElement>) => {
    if (!selectedElementId) return;
    patchElementById(selectedElementId, patch);
  };

  /**
   * Structural carousel edits (reorder/add/delete a slide) — delegates to the shared
   * `applyCarouselImagesTransform` (libs/shared-api/.../marketing-creative.schema.ts),
   * which writes the base element's `images` AND applies the same positional
   * transform to that element's overlay `images` array in every locale, in one
   * write. Overlays are positional (`overlay.images[N]` overlays `images[N]`), so
   * any base reshuffle that doesn't also reshuffle the overlays silently
   * misattaches translations to the wrong slide.
   */
  const patchElementImages = (
    elementId: string,
    transform: (images: Array<{ src?: string; alt?: string; linkUrl?: string }>) => Array<{ src?: string; alt?: string; linkUrl?: string }>,
  ) => {
    onChange(applyCarouselImagesTransform(design, elementId, transform));
  };

  /** Numeric inspector edits; clamps to grid bounds. */
  const patchGridItem = (elementId: string, patch: Partial<Omit<GridItem, 'elementId'>>) => {
    writeGrid(
      items.map((it) => {
        if (it.elementId !== elementId) return it;
        const next = { ...it, ...patch };
        next.col = Math.max(0, Math.min(POPUP_GRID_COLS - 1, Math.round(Number(next.col) || 0)));
        next.colSpan = Math.max(
          1,
          Math.min(POPUP_GRID_COLS - next.col, Math.round(Number(next.colSpan) || 1)),
        );
        next.row = Math.max(0, Math.round(Number(next.row) || 0));
        next.rowSpan = Math.max(1, Math.round(Number(next.rowSpan) || 1));
        return next;
      }),
      elements,
    );
  };

  const duplicateElement = (elementId: string) => {
    const original = elements.find((el) => el.id === elementId);
    const originalItem = items.find((it) => it.elementId === elementId);
    if (!original || !originalItem) return;
    const clone: CreativeElement = { ...original, id: crypto.randomUUID() };
    const cloneItem: GridItem = { ...originalItem, elementId: clone.id, row: originalItem.row + originalItem.rowSpan };
    const nextDesign = copyOverlay(design, elementId, clone.id);
    onChange({
      ...nextDesign,
      body: { ...nextDesign.body, grid: { items: [...items, cloneItem], elements: [...elements, clone] } },
    });
    setSelectedElementId(clone.id);
  };

  const removeElement = (elementId: string) => {
    const nextDesign = dropOverlay(design, elementId);
    onChange({
      ...nextDesign,
      body: {
        ...nextDesign.body,
        grid: {
          items: items.filter((it) => it.elementId !== elementId),
          elements: elements.filter((el) => el.id !== elementId),
        },
      },
    });
    if (selectedElementId === elementId) setSelectedElementId(null);
  };

  return {
    items,
    elements,
    selectedElementId,
    setSelectedElementId,
    selectedElement,
    selectedItem,
    addElementAt,
    applyLayout,
    patchElement,
    patchElementById,
    patchElementImages,
    patchGridItem,
    duplicateElement,
    removeElement,
  };
}
