import { useState } from 'react';
import { applyCarouselImagesTransform } from '@josh/shared-api';
import {
  addColumnToRow as splitRowColumn,
  newCreativeElement,
  newRow,
  removeColumnFromRow,
  setRowColumnCount,
  type RowColumnPreset,
} from './element-factory';
import { useCreativeI18n } from './use-creative-i18n';
import type { ChannelDesign, CreativeColumn, CreativeElement, CreativeRow } from './creative-editor.types';

/** Apply `fn` to the row with `rowId` at any nest depth. */
function updateRowById(
  design: ChannelDesign,
  rowId: string,
  fn: (row: CreativeRow) => CreativeRow,
): ChannelDesign {
  const mapRows = (rows: CreativeRow[]): CreativeRow[] =>
    rows.map((row) => {
      if (row.id === rowId) return fn(row);
      return {
        ...row,
        columns: row.columns.map((column) => ({
          ...column,
          rows: column.rows?.length ? mapRows(column.rows) : column.rows,
        })),
      };
    });
  return { ...design, body: { rows: mapRows(design.body.rows) } };
}

/** Apply `fn` to the column with `columnId` at any nest depth. */
function updateColumnById(
  design: ChannelDesign,
  columnId: string,
  fn: (column: CreativeColumn) => CreativeColumn,
): ChannelDesign {
  const mapRows = (rows: CreativeRow[]): CreativeRow[] =>
    rows.map((row) => ({
      ...row,
      columns: row.columns.map((column) => {
        if (column.id === columnId) return fn(column);
        return {
          ...column,
          rows: column.rows?.length ? mapRows(column.rows) : column.rows,
        };
      }),
    }));
  return { ...design, body: { rows: mapRows(design.body.rows) } };
}

function findInRow(
  row: CreativeRow,
  elementId: string,
): { rowId: string; columnId: string } | null {
  for (const column of row.columns) {
    if (column.elements.some((el) => el.id === elementId)) {
      return { rowId: row.id, columnId: column.id };
    }
    for (const nested of column.rows ?? []) {
      const found = findInRow(nested, elementId);
      if (found) return found;
    }
  }
  return null;
}

function findElementColumn(
  design: ChannelDesign,
  elementId: string,
): { rowId: string; columnId: string } | null {
  for (const row of design.body.rows) {
    const found = findInRow(row, elementId);
    if (found) return found;
  }
  return null;
}

function findColumnById(
  design: ChannelDesign,
  columnId: string,
): { rowId: string; column: CreativeColumn } | null {
  const search = (rows: CreativeRow[]): { rowId: string; column: CreativeColumn } | null => {
    for (const row of rows) {
      for (const column of row.columns) {
        if (column.id === columnId) return { rowId: row.id, column };
        if (column.rows?.length) {
          const nested = search(column.rows);
          if (nested) return nested;
        }
      }
    }
    return null;
  };
  return search(design.body.rows);
}

/** Nest depth of a column: 0 = top-level body column, 1 = inside a nested row. */
function findColumnDepth(design: ChannelDesign, columnId: string): number | null {
  const search = (rows: CreativeRow[], depth: number): number | null => {
    for (const row of rows) {
      for (const column of row.columns) {
        if (column.id === columnId) return depth;
        if (column.rows?.length) {
          const nested = search(column.rows, depth + 1);
          if (nested != null) return nested;
        }
      }
    }
    return null;
  };
  return search(design.body.rows, 0);
}

function firstColumnId(design: ChannelDesign): string | null {
  return design.body.rows[0]?.columns[0]?.id ?? null;
}

/**
 * Shared row/column/element mutation logic for canvas-based channel editors.
 * Supports one level of nested rows inside top-level columns.
 */
export function useChannelBodyEditor(design: ChannelDesign, onChange: (design: ChannelDesign) => void) {
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  // Column the user clicked directly (empty-space click). Element selection wins
  // over it; a stale id (column removed from the design) is ignored gracefully.
  const [explicitColumnId, setExplicitColumnId] = useState<string | null>(null);
  // Pure overlay helpers only — editorLocale is irrelevant to dropOverlay/copyOverlay.
  const { dropOverlay, copyOverlay } = useCreativeI18n(design, onChange, 'th');

  const elementColumnId =
    (selectedElementId && findElementColumn(design, selectedElementId)?.columnId) ?? null;
  const validExplicitColumnId =
    !elementColumnId && explicitColumnId && findColumnById(design, explicitColumnId)
      ? explicitColumnId
      : null;
  const selectedColumnId = elementColumnId ?? validExplicitColumnId ?? firstColumnId(design);
  const isColumnExplicitlySelected = validExplicitColumnId != null;

  /** Click on a column's empty space: make it the add target, deselect any element. */
  const selectColumn = (columnId: string) => {
    setExplicitColumnId(columnId);
    setSelectedElementId(null);
  };

  const selectedElement: CreativeElement | null = selectedElementId
    ? (() => {
        const located = findElementColumn(design, selectedElementId);
        if (!located) return null;
        const column = findColumnById(design, located.columnId)?.column;
        return column?.elements.find((el) => el.id === selectedElementId) ?? null;
      })()
    : null;

  /** Append a new element to a specific column (per-column quick-add). */
  const addElementToColumn = (type: CreativeElement['type'], columnId: string) => {
    const located = findColumnById(design, columnId);
    if (!located) return;
    const element = newCreativeElement(type);
    onChange(
      updateColumnById(design, columnId, (column) => ({
        ...column,
        elements: [...column.elements, element],
      })),
    );
    setSelectedElementId(element.id);
  };

  const addElement = (type: CreativeElement['type']) => {
    const targetColumnId = selectedColumnId ?? firstColumnId(design);
    if (!targetColumnId) return;
    addElementToColumn(type, targetColumnId);
  };

  const insertElementAt = (
    type: CreativeElement['type'],
    columnId: string,
    insertIndex: number,
  ) => {
    const located = findColumnById(design, columnId);
    if (!located) return;
    const element = newCreativeElement(type);
    onChange(
      updateColumnById(design, columnId, (column) => {
        const elements = [...column.elements];
        elements.splice(insertIndex, 0, element);
        return { ...column, elements };
      }),
    );
    setSelectedElementId(element.id);
  };

  const duplicateElement = (elementId: string) => {
    const located = findElementColumn(design, elementId);
    if (!located) return;
    const column = findColumnById(design, located.columnId)?.column;
    if (!column) return;
    const original = column.elements.find((el) => el.id === elementId);
    if (!original) return;
    const clone: CreativeElement = { ...original, id: crypto.randomUUID() };
    const nextDesign = copyOverlay(design, elementId, clone.id);
    onChange(
      updateColumnById(nextDesign, located.columnId, (col) => {
        const elements = [...col.elements];
        const originalIndex = elements.findIndex((el) => el.id === elementId);
        elements.splice(originalIndex + 1, 0, clone);
        return { ...col, elements };
      }),
    );
    setSelectedElementId(clone.id);
  };

  const patchElementById = (elementId: string, patch: Partial<CreativeElement>) => {
    const located = findElementColumn(design, elementId);
    if (!located) return;
    onChange(
      updateColumnById(design, located.columnId, (column) => ({
        ...column,
        elements: column.elements.map((el) =>
          el.id === elementId ? ({ ...el, ...patch } as CreativeElement) : el,
        ),
      })),
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
   * write. Mirrors `useGridEditor.patchElementImages`
   * (apps/web-admin/src/app/page/marketing/creative-editor/use-grid-editor.ts) for
   * the free-grid body used by the popup canvas — overlays are positional
   * (`overlay.images[N]` overlays `images[N]`), so any base reshuffle that doesn't also
   * reshuffle the overlays silently misattaches translations (including click-through
   * `linkUrl`) to the wrong slide.
   */
  const patchElementImages = (
    elementId: string,
    transform: (
      images: Array<{ src?: string; alt?: string; linkUrl?: string }>,
    ) => Array<{ src?: string; alt?: string; linkUrl?: string }>,
  ) => {
    onChange(applyCarouselImagesTransform(design, elementId, transform));
  };

  const removeElement = (elementId: string) => {
    const located = findElementColumn(design, elementId);
    if (!located) return;
    const nextDesign = dropOverlay(design, elementId);
    onChange(
      updateColumnById(nextDesign, located.columnId, (column) => ({
        ...column,
        elements: column.elements.filter((el) => el.id !== elementId),
      })),
    );
    if (selectedElementId === elementId) setSelectedElementId(null);
  };

  const reorderElement = (columnId: string, sourceIndex: number, destinationIndex: number) => {
    const located = findColumnById(design, columnId);
    if (!located) return;
    onChange(
      updateColumnById(design, columnId, (column) => {
        const elements = [...column.elements];
        const [moved] = elements.splice(sourceIndex, 1);
        elements.splice(destinationIndex, 0, moved);
        return { ...column, elements };
      }),
    );
  };

  const moveElement = (
    sourceColumnId: string,
    sourceIndex: number,
    destColumnId: string,
    destIndex: number,
  ) => {
    if (sourceColumnId === destColumnId) {
      reorderElement(sourceColumnId, sourceIndex, destIndex);
      return;
    }
    const sourceLocated = findColumnById(design, sourceColumnId);
    const destLocated = findColumnById(design, destColumnId);
    if (!sourceLocated || !destLocated) return;
    const moving = sourceLocated.column.elements[sourceIndex];
    if (!moving) return;

    let next = updateColumnById(design, sourceColumnId, (column) => ({
      ...column,
      elements: column.elements.filter((_, index) => index !== sourceIndex),
    }));
    next = updateColumnById(next, destColumnId, (column) => {
      const elements = [...column.elements];
      elements.splice(destIndex, 0, moving);
      return { ...column, elements };
    });
    onChange(next);
  };

  const addRow = () => {
    onChange({ ...design, body: { rows: [...design.body.rows, newRow()] } });
  };

  /** Add a nested row inside a top-level column only (depth 0). */
  const addNestedRow = (columnId: string) => {
    if (findColumnDepth(design, columnId) !== 0) return;
    onChange(
      updateColumnById(design, columnId, (column) => ({
        ...column,
        rows: [...(column.rows ?? []), newRow()],
      })),
    );
  };

  const removeNestedRow = (parentColumnId: string, nestedRowId: string) => {
    onChange(
      updateColumnById(design, parentColumnId, (column) => ({
        ...column,
        rows: (column.rows ?? []).filter((row) => row.id !== nestedRowId),
      })),
    );
  };

  const addColumn = (rowId: string) => {
    onChange(updateRowById(design, rowId, (row) => splitRowColumn(row)));
  };

  const removeColumn = (rowId: string, columnId: string) => {
    onChange(updateRowById(design, rowId, (row) => removeColumnFromRow(row, columnId)));
    if (selectedElementId) {
      const located = findElementColumn(design, selectedElementId);
      if (located?.columnId === columnId) setSelectedElementId(null);
    }
  };

  const setRowLayout = (rowId: string, columns: RowColumnPreset) => {
    onChange(updateRowById(design, rowId, (row) => setRowColumnCount(row, columns)));
  };

  const changeColumnWidth = (rowId: string, columnId: string, widthPercent: number) => {
    onChange(
      updateRowById(design, rowId, (row) => ({
        ...row,
        columns: row.columns.map((column) =>
          column.id === columnId ? { ...column, widthPercent } : column,
        ),
      })),
    );
  };

  const changeAdjacentColumnWidths = (
    rowId: string,
    leftColumnId: string,
    rightColumnId: string,
    leftPercent: number,
    rightPercent: number,
  ) => {
    onChange(
      updateRowById(design, rowId, (row) => ({
        ...row,
        columns: row.columns.map((column) => {
          if (column.id === leftColumnId) return { ...column, widthPercent: leftPercent };
          if (column.id === rightColumnId) return { ...column, widthPercent: rightPercent };
          return column;
        }),
      })),
    );
  };

  return {
    selectedElementId,
    setSelectedElementId,
    selectedElement,
    selectedColumnId,
    isColumnExplicitlySelected,
    selectColumn,
    addElement,
    addElementToColumn,
    insertElementAt,
    duplicateElement,
    patchElement,
    patchElementById,
    patchElementImages,
    removeElement,
    reorderElement,
    moveElement,
    addRow,
    addNestedRow,
    removeNestedRow,
    addColumn,
    removeColumn,
    setRowLayout,
    changeColumnWidth,
    changeAdjacentColumnWidths,
  };
}
