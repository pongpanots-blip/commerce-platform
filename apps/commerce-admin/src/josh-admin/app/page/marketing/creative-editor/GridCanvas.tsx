import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import { MdOutlineClose } from 'react-icons/md';
import { POPUP_GRID_COLS } from '@josh/shared-api';
import { renderElementPreview } from './ChannelCanvas';
import { computeAutoFitPlacement, DEFAULT_ROW_SPAN, defaultColSpanForType } from './element-factory';
import { GRID_DND_MIME } from './GridElementPalette';
import type { CreativeElement, GridItem, PopupChrome } from './creative-editor.types';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGrid = WidthProvider(GridLayout);

export const GRID_COLS = POPUP_GRID_COLS;
export const GRID_ROW_HEIGHT = 40;

/**
 * Grid cell under a pointer position, from the RGL container's rect.
 * Pure so the coordinate math is unit-testable; mirrors RGL's calcXY but is
 * NOT clamped by a placeholder width — that clamp is exactly what made
 * narrow gaps unreachable.
 */
export function pointerToGridCell(args: {
  clientX: number;
  clientY: number;
  rect: { left: number; top: number; width: number };
  cols: number;
  transformScale: number;
}): { col: number; row: number } | null {
  const { clientX, clientY, rect, cols, transformScale } = args;
  const containerWidth = rect.width / transformScale;
  const layerX = (clientX - rect.left) / transformScale;
  const layerY = (clientY - rect.top) / transformScale;
  const marginX = 6;
  const marginY = 6;
  const colWidth = (containerWidth - marginX * (cols - 1) - marginX * 2) / cols;
  if (!Number.isFinite(colWidth) || colWidth <= 0) return null;
  return {
    col: Math.max(0, Math.min(cols - 1, Math.floor((layerX - marginX) / (colWidth + marginX)))),
    row: Math.max(0, Math.floor((layerY - marginY) / (GRID_ROW_HEIGHT + marginY))),
  };
}

/**
 * Chrome the canvas needs to paint its frame. `PopupChrome` satisfies it; the
 * page editor passes a synthetic object built from `PageChrome`
 * (`maxWidthPx` → `widthPx`), so one canvas serves both without a fork.
 */
export type GridCanvasChrome = Pick<PopupChrome, 'widthPx' | 'backgroundColor' | 'borderRadiusPx'>;

/**
 * Collision-grid canvas shared by the popup editor and the promotion-page editor
 * (react-grid-layout).
 *
 * Everything that differs between the two consumers is a prop: the frame width
 * comes from `meta.widthPx` (720 for a popup, up to 1200 for a page), and
 * `transformScale` tells react-grid-layout how much the canvas is visually
 * scaled by an ancestor's `transform: scale()` so drag deltas stay under the
 * cursor. `cols` is a prop for symmetry but both consumers use 8 —
 * `POPUP_GRID_COLS` is also what the storefront's `CreativePageGrid` renders.
 */
export function GridCanvas({
  items,
  elements,
  selectedElementId,
  draggingType,
  onSelectElement,
  onApplyLayout,
  onAddElementAt,
  onRemoveElement,
  meta,
  cols = GRID_COLS,
  transformScale = 1,
  minHeightPx = 320,
}: {
  items: GridItem[];
  elements: CreativeElement[];
  selectedElementId: string | null;
  /** Palette type currently being dragged (null when not dragging) — sizes the drop placeholder. */
  draggingType: CreativeElement['type'] | null;
  onSelectElement: (id: string | null) => void;
  onApplyLayout: (layout: Layout[]) => void;
  onAddElementAt: (type: CreativeElement['type'], col: number, row: number) => void;
  onRemoveElement: (id: string) => void;
  meta: GridCanvasChrome;
  cols?: number;
  /** CSS scale applied by an ancestor (zoom-to-fit). 1 when unscaled. */
  transformScale?: number;
  minHeightPx?: number;
}) {
  const elementById = new Map(elements.map((el) => [el.id, el]));
  const layout: Layout[] = items.map((it) => ({
    i: it.elementId,
    x: it.col,
    y: it.row,
    w: it.colSpan,
    h: it.rowSpan,
  }));

  return (
    <div
      data-testid="grid-canvas"
      className="mx-auto rounded-xl border border-neutral-200 shadow-sm"
      style={{
        width: '100%',
        maxWidth: meta.widthPx ?? 720,
        backgroundColor: meta.backgroundColor ?? '#ffffff',
        borderRadius: meta.borderRadiusPx ?? 12,
      }}
      onClick={() => onSelectElement(null)}
    >
      <ResponsiveGrid
        style={{ minHeight: minHeightPx }}
        cols={cols}
        rowHeight={GRID_ROW_HEIGHT}
        margin={[6, 6]}
        compactType="vertical"
        preventCollision={false}
        isDroppable={true}
        transformScale={transformScale}
        droppingItem={{
          i: '__dropping__',
          w: draggingType ? defaultColSpanForType(draggingType) : 4,
          h: draggingType ? DEFAULT_ROW_SPAN[draggingType] : 2,
        }}
        // Size the drop placeholder to the free gap under the cursor.
        //
        // react-grid-layout 1.5.3 only applies the `onDropDragOver` result on the
        // FIRST dragover after the pointer enters the grid (ReactGridLayout.js
        // `onDragOver`: `finalDroppingItem` is used only in the
        // `if (!this.state.droppingDOMNode)` branch; later dragovers just move
        // `droppingPosition`). So the width is chosen at entry and then frozen —
        // it is not recomputed as the marketer slides across the row. That is
        // still the difference between "placeable" and "not placeable" here,
        // because `calcXY` clamps `x` to `cols - w`: a fixed w=4 placeholder on
        // an 8-col grid can never sit past col 4, so a gap at cols 5-7 was
        // literally unreachable. `addElementAt` re-fits the real item at commit,
        // which is what the marketer ends up with.
        onDropDragOver={(e) => {
          if (!draggingType) return undefined;
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const containerWidth = rect.width / transformScale;
          const layerX = (e.clientX - rect.left) / transformScale;
          const layerY = (e.clientY - rect.top) / transformScale;
          const marginX = 6;
          const marginY = 6;
          const colWidth = (containerWidth - marginX * (cols - 1) - marginX * 2) / cols;
          if (!Number.isFinite(colWidth) || colWidth <= 0) return undefined;
          const col = Math.round((layerX - marginX) / (colWidth + marginX));
          const row = Math.round((layerY - marginY) / (GRID_ROW_HEIGHT + marginY));
          const rowSpan = DEFAULT_ROW_SPAN[draggingType];
          const fit = computeAutoFitPlacement({
            items,
            type: draggingType,
            col,
            row: Math.max(0, row),
            rowSpan,
            cols,
          });
          return { w: fit.colSpan, h: rowSpan };
        }}
        // West handles let a marketer pull the left edge. react-grid-layout
        // recomputes `x = x + (w - newW)` for 'w'/'sw' (ReactGridLayout onResize),
        // so the right edge stays put and `x` never goes below 0 — which is what
        // `normalizePopupGridItem` clamps to anyway, so the two agree at col 0.
        resizeHandles={['w', 'e', 's', 'sw', 'se']}
        layout={layout}
        onLayoutChange={(next) => {
          // Ignore transient layouts that include the drop placeholder
          if (next.some((l) => l.i === '__dropping__')) return;
          onApplyLayout(next);
        }}
        onDrop={(_layout, item, event) => {
          const dragEvent = event as DragEvent;
          const type = dragEvent.dataTransfer?.getData(GRID_DND_MIME) as
            | CreativeElement['type']
            | '';
          if (!type) return;
          // Do NOT trust `item` for the position: RGL hands us the placeholder's
          // slot in the already-compacted layout (`layout.find(placeholder)`),
          // i.e. where the shadow was PUSHED TO when the gap under the cursor was
          // narrower than it. Committing there lands in an empty row below, so
          // the gap auto-fit never saw the row the marketer pointed at — "it
          // snaps but never shrinks". The cursor is the intent; use it.
          const target = (dragEvent.currentTarget ?? dragEvent.target) as HTMLElement | null;
          const rect = target?.getBoundingClientRect?.();
          const cell = rect
            ? pointerToGridCell({
                clientX: dragEvent.clientX,
                clientY: dragEvent.clientY,
                rect,
                cols,
                transformScale,
              })
            : null;
          // Placeholder (then bottom-of-grid) only as fallbacks for synthetic
          // drops that carry no usable coordinates (e2e, jsdom).
          const bottomRow = layout.reduce((max, l) => Math.max(max, l.y + l.h), 0);
          onAddElementAt(type, cell?.col ?? item?.x ?? 0, cell?.row ?? item?.y ?? bottomRow);
        }}
      >
        {items.map((it) => {
          const element = elementById.get(it.elementId);
          const selected = selectedElementId === it.elementId;
          if (!element) {
            return (
              <div
                key={it.elementId}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectElement(it.elementId);
                }}
                className="group/cell relative flex items-center justify-center overflow-hidden rounded-md border border-dashed border-neutral-300 bg-neutral-50"
              >
                <p className="px-2 text-center text-[11px] text-neutral-400">องค์ประกอบหาย — ลบได้</p>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveElement(it.elementId);
                  }}
                  className="absolute right-1 top-1 z-10 rounded p-0.5 text-neutral-300 opacity-0 hover:text-red-500 group-hover/cell:opacity-100"
                  title="ลบองค์ประกอบนี้"
                >
                  <MdOutlineClose size={14} />
                </button>
              </div>
            );
          }
          // Text must not use overflow-hidden — Thai diacritics above the
          // em-box get clipped. Images/video still clip to the cell.
          // Inline overflow beats react-grid-layout's .react-grid-item CSS.
          const clipContent = element.type !== 'text';
          return (
            <div
              key={it.elementId}
              data-element-wrapper
              data-element-id={it.elementId}
              onClick={(event) => {
                event.stopPropagation();
                onSelectElement(it.elementId);
              }}
              style={clipContent ? undefined : { overflow: 'visible' }}
              className={`group/cell relative rounded-md border bg-white ${
                clipContent ? 'overflow-hidden' : 'overflow-visible'
              } ${
                selected
                  ? 'border-primary ring-2 ring-primary/40'
                  : 'border-neutral-200 hover:border-primary/40'
              }`}
            >
              <div
                className={`h-full w-full p-1 ${
                  clipContent ? 'overflow-hidden' : 'overflow-visible'
                }`}
              >
                {renderElementPreview(element)}
              </div>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveElement(it.elementId);
                }}
                className="absolute right-1 top-1 z-10 rounded p-0.5 text-neutral-300 opacity-0 hover:text-red-500 group-hover/cell:opacity-100"
                title="ลบองค์ประกอบนี้"
              >
                <MdOutlineClose size={14} />
              </button>
            </div>
          );
        })}
      </ResponsiveGrid>
      {items.length === 0 && (
        <div
          style={{ marginTop: -minHeightPx, height: minHeightPx }}
          className="pointer-events-none grid place-items-center text-xs text-neutral-300"
        >
          ลาก element จากแผงซ้ายมาวางบน grid ได้เลย
        </div>
      )}
    </div>
  );
}
