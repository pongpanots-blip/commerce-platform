import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from '@hello-pangea/dnd';
import { Fragment, useEffect, useState } from 'react';
import { MdAdd, MdDragIndicator, MdOutlineClose } from 'react-icons/md';
import type { RowColumnPreset } from './element-factory';
import type {
  ChannelDesign,
  CreativeColumn,
  CreativeElement,
  CreativeRow,
  EmailChrome,
  PopupChrome,
} from './creative-editor.types';

function textAlignClass(align?: 'left' | 'center' | 'right'): string {
  if (align === 'center') return 'text-center';
  if (align === 'right') return 'text-right';
  return 'text-left';
}

function closeButtonCornerClass(corner: 'tl' | 'tr' | 'bl' | 'br' = 'tr'): string {
  switch (corner) {
    case 'tl':
      return 'left-2 top-2';
    case 'bl':
      return 'left-2 bottom-2';
    case 'br':
      return 'right-2 bottom-2';
    case 'tr':
    default:
      return 'right-2 top-2';
  }
}

const ROW_LAYOUT_PRESETS: Array<{ columns: RowColumnPreset; label: string; title: string }> = [
  { columns: 1, label: '□', title: '1 คอลัมน์' },
  { columns: 2, label: '□□', title: '2 คอลัมน์ (50/50)' },
  { columns: 3, label: '□□□', title: '3 คอลัมน์ (33/33/33)' },
];

function RowLayoutPicker({
  columnCount,
  onChange,
}: {
  columnCount: number;
  onChange: (columns: RowColumnPreset) => void;
}) {
  const active = Math.min(3, Math.max(1, columnCount)) as RowColumnPreset;
  return (
    <div className="mb-1 flex items-center gap-1">
      <span className="mr-1 text-[9px] font-semibold tracking-wide text-neutral-400">Layout</span>
      {ROW_LAYOUT_PRESETS.map((preset) => (
        <button
          key={preset.columns}
          type="button"
          title={preset.title}
          onClick={() => onChange(preset.columns)}
          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-tighter ${
            active === preset.columns
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300'
          }`}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

function ColumnResizeDivider({
  row,
  leftColumn,
  rightColumn,
  onCommit,
  gridColumn,
}: {
  row: { id: string; columns: Array<{ id: string; widthPercent: number }> };
  leftColumn: { id: string; widthPercent: number };
  rightColumn: { id: string; widthPercent: number };
  onCommit: (rowId: string, leftColId: string, rightColId: string, leftPct: number, rightPct: number) => void;
  /** Explicit track. Auto-placement is not safe once columns are pinned. */
  gridColumn: number;
}) {
  const [dragging, setDragging] = useState(false);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const totalPercent = leftColumn.widthPercent + rightColumn.widthPercent;
    const container = event.currentTarget.closest('.grid') as HTMLElement | null;
    if (!container) return;
    const containerWidth = container.getBoundingClientRect().width;
    const dividerCount = row.columns.length - 1;
    const pxPerPercent = (containerWidth - dividerCount * 8) / 100;

    setDragging(true);

    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const deltaPercent = delta / pxPerPercent;
      const MIN = 15;
      let newLeft = Math.round(leftColumn.widthPercent + deltaPercent);
      newLeft = Math.max(MIN, Math.min(totalPercent - MIN, newLeft));
      const newRight = totalPercent - newLeft;
      const gridEl = container as HTMLElement;
      const cols = row.columns.map((col) => {
        if (col.id === leftColumn.id) return `${newLeft}fr`;
        if (col.id === rightColumn.id) return `${newRight}fr`;
        return `${col.widthPercent}fr`;
      });
      gridEl.style.gridTemplateColumns = cols.join(' 8px ');
    };

    const cleanup = () => {
      setDragging(false);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', cleanup);
    };

    const onUp = (upEvent: PointerEvent) => {
      const delta = upEvent.clientX - startX;
      const deltaPercent = delta / pxPerPercent;
      const MIN = 15;
      let newLeft = Math.round(leftColumn.widthPercent + deltaPercent);
      newLeft = Math.max(MIN, Math.min(totalPercent - MIN, newLeft));
      const newRight = totalPercent - newLeft;
      onCommit(row.id, leftColumn.id, rightColumn.id, newLeft, newRight);
      cleanup();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', cleanup);
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      className={`relative z-10 shrink-0 cursor-col-resize select-none self-stretch ${dragging ? 'bg-primary/40' : 'hover:bg-primary/20'}`}
      style={{ gridColumn }}
      title="ลากเพื่อปรับความกว้างคอลัมน์"
    />
  );
}

function ElementResizeHandle({
  direction,
  currentValue,
  min,
  max,
  onCommit,
}: {
  direction: 'right' | 'bottom';
  currentValue: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const isRight = direction === 'right';

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    const startCoord = isRight ? event.clientX : event.clientY;

    const wrapper = event.currentTarget.closest('[data-element-wrapper]') as HTMLElement | null;
    const containerSize = wrapper
      ? isRight
        ? wrapper.getBoundingClientRect().width
        : wrapper.getBoundingClientRect().height
      : 200;
    const pxPerUnit = isRight ? containerSize / 100 : 1;

    const onMove = (moveEvent: PointerEvent) => {
      const delta = isRight ? moveEvent.clientX - startCoord : moveEvent.clientY - startCoord;
      const raw = currentValue + (isRight ? delta / pxPerUnit : delta);
      const preview = Math.round(Math.max(min, Math.min(max, raw)));
      if (wrapper) {
        if (isRight) {
          wrapper.style.maxWidth = `${preview}%`;
        } else {
          wrapper.style.minHeight = `${preview}px`;
        }
      }
    };

    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', cleanup);
    };

    const onUp = (upEvent: PointerEvent) => {
      const delta = isRight
        ? upEvent.clientX - startCoord
        : upEvent.clientY - startCoord;
      const raw = currentValue + (isRight ? delta / pxPerUnit : delta);
      const clamped = Math.round(Math.max(min, Math.min(max, raw)));
      if (wrapper) {
        wrapper.style.maxWidth = '';
        wrapper.style.minHeight = '';
      }
      onCommit(clamped);
      cleanup();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', cleanup);
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      className={`absolute z-20 rounded-full bg-primary/50 opacity-0 transition-opacity group-hover/element:opacity-100 ${
        isRight
          ? 'right-0 top-1/2 -translate-y-1/2 h-8 w-1.5 cursor-col-resize'
          : 'bottom-0 left-1/2 -translate-x-1/2 h-1.5 w-8 cursor-row-resize'
      }`}
      title={isRight ? 'ลากเพื่อปรับความกว้าง' : 'ลากเพื่อปรับความสูง'}
    />
  );
}

export function renderElementPreview(element: CreativeElement) {
  switch (element.type) {
    case 'text':
      return (
        <p
          className={`min-h-[1.25rem] whitespace-pre-line px-0.5 leading-relaxed text-neutral-600 ${textAlignClass(element.style?.align)}`}
          style={{
            fontSize: element.style?.fontSizePx ? `${element.style.fontSizePx}px` : undefined,
            fontWeight: element.style?.fontWeight === 'bold' ? 700 : 400,
            color: element.style?.color,
            // Thai tone marks sit above the em-box — keep them visible inside
            // overflow-hidden grid cells.
            lineHeight: 1.5,
            paddingTop: '0.2em',
            overflow: 'visible',
          }}
        >
          {element.text.trim() ? (
            element.text
          ) : (
            <span className="text-xs text-neutral-300">คลิกแล้วพิมพ์ข้อความในแผงขวา...</span>
          )}
        </p>
      );
    case 'image':
      return element.src.trim() ? (
        <img
          src={element.src.trim()}
          alt={element.alt ?? ''}
          className="max-w-none object-cover"
          style={{ width: `${element.style?.widthPercent ?? 100}%` }}
        />
      ) : (
        <div className="grid h-16 place-items-center rounded-md border border-dashed border-neutral-300 text-[11px] text-neutral-400">
          คลิกเพื่อเลือกรูปจากคลัง Banner
        </div>
      );
    case 'button':
      return (
        <span
          className={`block rounded-lg px-3 py-2 text-center text-xs font-medium ${
            element.style?.backgroundColor || element.style?.color
              ? element.style?.backgroundColor
                ? ''
                : 'border border-neutral-200'
              : element.action === 'go_url'
                ? 'bg-neutral-900 text-white'
                : 'border border-neutral-200 text-neutral-700'
          }`}
          style={{
            // Same rule as shop: fill cell unless fullWidth explicitly false
            width:
              element.style?.fullWidth === false
                ? `${element.style?.widthPercent ?? 100}%`
                : '100%',
            backgroundColor: element.style?.backgroundColor,
            color: element.style?.color,
            borderRadius: element.style?.borderRadiusPx
              ? `${element.style.borderRadiusPx}px`
              : undefined,
          }}
        >
          {element.label || 'ปุ่ม'}
        </span>
      );
    case 'coupon':
      return (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-2.5 py-2">
          <p className="text-[9px] font-medium uppercase tracking-wide text-neutral-500">
            โค้ดที่ใช้ได้
          </p>
          <p className="font-mono text-sm font-semibold text-neutral-900">
            {element.legacyCode || 'เลือกคูปองในแผงขวา'}
          </p>
        </div>
      );
    case 'spacer':
      return (
        <div
          style={{ height: `${element.heightPx}px` }}
          className="rounded border border-dashed border-neutral-200"
        />
      );
    case 'divider':
      return (
        <hr
          className="border-0"
          style={{
            borderTopWidth: element.style?.thicknessPx ?? 1,
            borderTopStyle: 'solid',
            borderTopColor: element.style?.color ?? '#e5e5e5',
          }}
        />
      );
    case 'video':
      return (
        <div className="flex items-center justify-center rounded bg-gray-100 text-xs text-gray-400" style={{ aspectRatio: element.style?.aspectRatio ?? '16/9', width: `${element.style?.widthPercent ?? 100}%` }}>
          🎬 {element.src ? (() => { try { return new URL(element.src).hostname; } catch { return element.src; } })() : 'วิดีโอ (ใส่ URL)'}
        </div>
      );
    case 'html':
      return (
        <div className="rounded border border-dashed border-amber-300 bg-amber-50 p-2 text-[10px] font-mono text-amber-700 line-clamp-3">{element.html}</div>
      );
    case 'countdown':
      return (
        <div className="rounded bg-gray-50 p-2 text-center font-mono text-sm font-bold text-gray-700">⏱ {element.format === 'dhms' ? '01:23:45:00' : element.format === 'hms' ? '23:45:00' : '45:00'}</div>
      );
    case 'carousel':
      return (
        <div className="flex gap-1 overflow-hidden rounded" style={{ width: `${element.style?.widthPercent ?? 100}%` }}>
          {(element.images ?? []).slice(0, 3).map((img, i) => (
            <img key={i} src={img.src} alt="" className="h-16 w-16 flex-shrink-0 rounded object-cover bg-gray-100" onError={(e) => { (e.target as HTMLImageElement).src = ''; }} />
          ))}
          {(!element.images?.length) && <div className="flex h-16 w-full items-center justify-center rounded bg-gray-100 text-xs text-gray-400">🖼 ยังไม่มีรูปภาพ</div>}
        </div>
      );
    case 'product_grid': {
      // Skeleton only — the canvas never calls the pricing API, so what shows here
      // is shape (columns x 2 rows of cards), not real products.
      // Guard incomplete source shapes (e.g. kind flipped before kind-specific fields exist).
      const source = element.source;
      const count =
        source?.kind === 'category'
          ? (source.limit ?? 8)
          : source?.kind === 'skus'
            ? (source.skus?.length ?? 0)
            : 8;
      return (
        <div className="rounded-md border border-dashed border-gray-300 p-2">
          <p className="mb-1.5 text-[9px] font-semibold tracking-wide text-gray-400">
            ตารางสินค้า · {element.columns} คอลัมน์ · ~{count} รายการ
          </p>
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${element.columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: element.columns * 2 }).map((_, index) => (
              <div key={index} className="space-y-1 rounded bg-gray-100 p-1.5">
                <div className="h-10 rounded bg-gray-200" />
                <div className="h-1.5 w-4/5 rounded bg-gray-200" />
                {element.showPrice && <div className="h-1.5 w-1/2 rounded bg-gray-200" />}
              </div>
            ))}
          </div>
        </div>
      );
    }
    case 'rich_text':
      return (
        <div
          className="max-w-none text-xs text-gray-600"
          dangerouslySetInnerHTML={{
            __html:
              element.html || '<span class="text-xs text-gray-300">แก้ไขเนื้อหาในแผงขวา...</span>',
          }}
        />
      );
    case 'accordion': {
      const items = element.items ?? [];
      return (
        <div className="divide-y divide-gray-200 rounded-md border border-gray-200">
          {items.length === 0 && (
            <p className="px-2 py-1.5 text-[11px] text-gray-300">ยังไม่มีหัวข้อ</p>
          )}
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[11px] text-gray-600">{item.title || 'หัวข้อ'}</span>
              <span className="text-[11px] text-gray-300">⌄</span>
            </div>
          ))}
        </div>
      );
    }
    default:
      return null;
  }
}

/**
 * Per-column quick-add: a small "+" that appears on column hover and opens the
 * same element type list as the palette, inserting into THAT column. Zero-drag
 * path into nested-row columns, whose droppable areas are small.
 */
function ColumnQuickAdd({
  columnId,
  elementTypes,
  onQuickAddElement,
}: {
  columnId: string;
  elementTypes: Array<{ type: CreativeElement['type']; label: string }>;
  onQuickAddElement: (type: CreativeElement['type'], columnId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  // Escape closes the popover — click-away alone strands keyboard users, and a
  // marketer mid-edit expects Escape to dismiss any floating panel.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        data-quick-add=""
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={`flex w-full items-center justify-center rounded border border-dashed border-neutral-200 py-0.5 text-neutral-300 transition-opacity hover:border-primary hover:text-primary ${
          open ? 'opacity-100' : 'opacity-0 group-hover/column:opacity-100'
        }`}
        title="เพิ่มองค์ประกอบลงคอลัมน์นี้"
      >
        <MdAdd size={13} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-30 mt-1 max-h-56 w-40 overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg">
            {elementTypes.map((item) => (
              <button
                key={item.type}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                  onQuickAddElement(item.type, columnId);
                }}
                className="block w-full px-2.5 py-1 text-left text-[11px] text-neutral-600 hover:bg-primary/5 hover:text-primary"
              >
                + {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function trackSumPercent(columns: CreativeColumn[], startIndex: number, span: number): number {
  return columns
    .slice(startIndex, startIndex + span)
    .reduce((sum, column) => sum + (column.widthPercent || 0), 0);
}

function CanvasColumn({
  row,
  column,
  columnIndex,
  depth,
  selectedElementId,
  onSelectElement,
  onRemoveElement,
  onRemoveColumn,
  onSetRowLayout,
  onAddNestedRow,
  onRemoveNestedRow,
  hidePresetPicker,
  onChangeAdjacentColumnWidths,
  onPatchElement,
  onSelectColumn,
  addTargetColumnId,
  isDragActive,
  elementTypes,
  onQuickAddElement,
}: {
  row: CreativeRow;
  column: CreativeColumn;
  columnIndex: number;
  depth: number;
  selectedElementId: string | null;
  onSelectElement: (elementId: string) => void;
  onRemoveElement: (elementId: string) => void;
  onRemoveColumn: (rowId: string, columnId: string) => void;
  onSetRowLayout: (rowId: string, columns: RowColumnPreset) => void;
  onAddNestedRow: (columnId: string) => void;
  onRemoveNestedRow: (parentColumnId: string, nestedRowId: string) => void;
  hidePresetPicker?: boolean;
  onChangeAdjacentColumnWidths?: (rowId: string, leftColId: string, rightColId: string, leftPct: number, rightPct: number) => void;
  onPatchElement?: (elementId: string, patch: Partial<CreativeElement>) => void;
  onSelectColumn?: (columnId: string) => void;
  addTargetColumnId?: string | null;
  isDragActive?: boolean;
  elementTypes?: Array<{ type: CreativeElement['type']; label: string }>;
  onQuickAddElement?: (type: CreativeElement['type'], columnId: string) => void;
}) {
  const canNest = depth === 0;
  const columnCount = row.columns.length;
  const isEmpty = column.elements.length === 0 && !column.rows?.length;
  const isAddTarget = addTargetColumnId === column.id;

  return (
    <Droppable droppableId={column.id}>
      {(dropProvided, dropSnapshot) => (
        <div
          ref={dropProvided.innerRef}
          {...dropProvided.droppableProps}
          // Test hook: lets e2e aim a drop at a specific column and assert which
          // column the element actually landed in (see apps/web-admin-e2e).
          data-column-id={column.id}
          data-add-target={isAddTarget ? 'true' : undefined}
          // Empty-space click selects the column as the click-to-add target.
          // Element clicks never reach here (their own handlers don't bubble a
          // matching currentTarget); guard on target anyway so inner controls
          // (quick-add, nested rows) don't retarget the parent column.
          onClick={(event) => {
            if (event.target === event.currentTarget) onSelectColumn?.(column.id);
          }}
          className={`group/column relative min-w-0 space-y-2 rounded-md border border-dashed p-1 ${
            dropSnapshot.isDraggingOver
              ? 'border-primary bg-primary/5'
              : isDragActive
                ? 'border-neutral-300 bg-neutral-50/60'
                : isAddTarget
                  ? 'border-primary/50 ring-1 ring-primary/30'
                  : 'border-transparent'
          } ${depth > 0 ? 'bg-neutral-50/80' : ''}`}
          style={{
            // With resize handles on, the track list interleaves an 8px divider
            // between columns (`33fr 8px 33fr 8px 33fr`), so column N is track
            // 2N+1, not N+1. Placing it at N+1 put every column after the first
            // onto a divider track — an 8px-wide cell that wrapped Thai text one
            // character per line.
            gridColumn: onChangeAdjacentColumnWidths ? columnIndex * 2 + 1 : columnIndex + 1,
            // Empty columns (and any column during a drag) get an honestly
            // hittable landing area — 48px was too small to aim at.
            minHeight: isEmpty || isDragActive ? 80 : 48,
          }}
        >
          {isAddTarget && (
            <span className="pointer-events-none absolute -top-2 left-1 z-10 rounded bg-primary px-1 py-px text-[8px] font-semibold text-white">
              เพิ่มที่นี่
            </span>
          )}
          {row.columns.length > 1 && (
            <button
              type="button"
              onClick={() => onRemoveColumn(row.id, column.id)}
              className="absolute -top-1 right-0 z-10 rounded-full bg-gray-900/70 p-0.5 text-white opacity-60 hover:opacity-100"
              title="ลบคอลัมน์นี้"
            >
              <MdOutlineClose size={10} />
            </button>
          )}
          {column.elements.map((element, index) => {
            const span = Math.min(
              Math.max(1, element.columnSpan ?? 1),
              columnCount - columnIndex,
            );
            const spanTrackPercent = trackSumPercent(row.columns, columnIndex, span);
            const homePercent = column.widthPercent || 1;
            const spanWidthRatio = span > 1 ? spanTrackPercent / homePercent : 1;

            return (
              <Draggable key={element.id} draggableId={element.id} index={index}>
                {(dragProvided, snapshot) => (
                  <div
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    onClick={() => onSelectElement(element.id)}
                    data-element-wrapper=""
                    className={`group/element relative flex items-start gap-1.5 rounded-md border bg-white p-1.5 ${
                      snapshot.isDragging
                        ? 'border-primary shadow-md ring-2 ring-primary'
                        : selectedElementId === element.id
                          ? 'border-primary/50 ring-2 ring-primary/40'
                          : 'border-neutral-200 hover:border-primary/40'
                    }`}
                    style={{
                      ...dragProvided.draggableProps.style,
                      ...(span > 1
                        ? {
                            width: `calc(${spanWidthRatio * 100}% + ${(span - 1) * 0.5}rem)`,
                            maxWidth: 'none',
                            position: 'relative',
                            zIndex: 5,
                          }
                        : undefined),
                    }}
                    title={span > 1 ? `ครอบคลุม ${span} คอลัมน์` : undefined}
                  >
                    <span
                      {...dragProvided.dragHandleProps}
                      className="mt-0.5 shrink-0 cursor-grab touch-none text-neutral-400 hover:text-neutral-700 active:cursor-grabbing"
                      title="ลากเพื่อย้ายช่องเริ่มต้น / จัดลำดับ"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <MdDragIndicator size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      {renderElementPreview(element)}
                      {span > 1 && (
                        <p className="mt-0.5 text-[9px] font-medium text-primary">span ×{span}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveElement(element.id);
                      }}
                      className="shrink-0 rounded p-0.5 text-neutral-300 hover:text-red-500"
                      title="ลบองค์ประกอบนี้"
                    >
                      <MdOutlineClose size={14} />
                    </button>
                    {selectedElementId === element.id && (
                      <>
                        {(element.type === 'image' ||
                          element.type === 'video' ||
                          element.type === 'carousel' ||
                          (element.type === 'button' && !element.style?.fullWidth)) && (
                          <ElementResizeHandle
                            direction="right"
                            currentValue={element.style?.widthPercent ?? 100}
                            min={10}
                            max={100}
                            onCommit={(value) =>
                              onPatchElement?.(element.id, {
                                style: { ...(element as { style?: Record<string, unknown> }).style, widthPercent: value },
                              } as Partial<CreativeElement>)
                            }
                          />
                        )}
                        {element.type === 'spacer' && (
                          <ElementResizeHandle
                            direction="bottom"
                            currentValue={element.heightPx}
                            min={4}
                            max={400}
                            onCommit={(value) =>
                              onPatchElement?.(element.id, { heightPx: value } as Partial<CreativeElement>)
                            }
                          />
                        )}
                      </>
                    )}
                  </div>
                )}
              </Draggable>
            );
          })}
          {dropProvided.placeholder}
          {isEmpty && (
            <div
              onClick={() => onSelectColumn?.(column.id)}
              className={`grid h-16 place-items-center rounded-md border border-dashed text-[10px] ${
                onSelectColumn ? 'cursor-pointer' : ''
              } ${isDragActive ? 'border-primary/40 text-primary/60' : 'border-neutral-200 text-neutral-300'}`}
            >
              วางที่นี่ (= คอลัมน์ {columnIndex + 1})
            </div>
          )}
          {elementTypes && onQuickAddElement && (
            <ColumnQuickAdd
              columnId={column.id}
              elementTypes={elementTypes}
              onQuickAddElement={onQuickAddElement}
            />
          )}

          {(column.rows ?? []).map((nestedRow) => (
            <div
              key={nestedRow.id}
              className="rounded border border-neutral-200 bg-white/90 p-1.5"
            >
              <div className="mb-1 flex items-center justify-between gap-1">
                <span className="text-[9px] font-semibold text-neutral-400">แถวย่อย</span>
                <button
                  type="button"
                  onClick={() => onRemoveNestedRow(column.id, nestedRow.id)}
                  className="text-[9px] text-red-400 hover:text-red-600"
                >
                  ลบแถวย่อย
                </button>
              </div>
              <CanvasRow
                row={nestedRow}
                depth={depth + 1}
                selectedElementId={selectedElementId}
                onSelectElement={onSelectElement}
                onRemoveElement={onRemoveElement}
                onRemoveColumn={onRemoveColumn}
                onSetRowLayout={onSetRowLayout}
                onAddNestedRow={onAddNestedRow}
                onRemoveNestedRow={onRemoveNestedRow}
                hidePresetPicker={hidePresetPicker}
                onChangeAdjacentColumnWidths={onChangeAdjacentColumnWidths}
                onPatchElement={onPatchElement}
                onSelectColumn={onSelectColumn}
                addTargetColumnId={addTargetColumnId}
                isDragActive={isDragActive}
                elementTypes={elementTypes}
                onQuickAddElement={onQuickAddElement}
              />
            </div>
          ))}

          {canNest && (
            <button
              type="button"
              onClick={() => onAddNestedRow(column.id)}
              className="flex w-full items-center justify-center gap-0.5 rounded border border-dashed border-neutral-300 py-1 text-[9px] text-neutral-400 hover:border-primary hover:text-primary"
            >
              <MdAdd size={11} /> แถวย่อยในคอลัมน์นี้
            </button>
          )}
        </div>
      )}
    </Droppable>
  );
}

function CanvasRow({
  row,
  depth,
  selectedElementId,
  onSelectElement,
  onRemoveElement,
  onRemoveColumn,
  onSetRowLayout,
  onAddNestedRow,
  onRemoveNestedRow,
  hidePresetPicker,
  onChangeAdjacentColumnWidths,
  onPatchElement,
  onSelectColumn,
  addTargetColumnId,
  isDragActive,
  elementTypes,
  onQuickAddElement,
}: {
  row: CreativeRow;
  depth: number;
  selectedElementId: string | null;
  onSelectElement: (elementId: string) => void;
  onRemoveElement: (elementId: string) => void;
  onRemoveColumn: (rowId: string, columnId: string) => void;
  onSetRowLayout: (rowId: string, columns: RowColumnPreset) => void;
  onAddNestedRow: (columnId: string) => void;
  onRemoveNestedRow: (parentColumnId: string, nestedRowId: string) => void;
  hidePresetPicker?: boolean;
  onChangeAdjacentColumnWidths?: (rowId: string, leftColId: string, rightColId: string, leftPct: number, rightPct: number) => void;
  onPatchElement?: (elementId: string, patch: Partial<CreativeElement>) => void;
  onSelectColumn?: (columnId: string) => void;
  addTargetColumnId?: string | null;
  isDragActive?: boolean;
  elementTypes?: Array<{ type: CreativeElement['type']; label: string }>;
  onQuickAddElement?: (type: CreativeElement['type'], columnId: string) => void;
}) {
  const gridTemplateColumns =
    onChangeAdjacentColumnWidths && row.columns.length > 1
      ? row.columns.map((col) => `${col.widthPercent}fr`).join(' 8px ')
      : row.columns.map((col) => `${col.widthPercent}fr`).join(' ');

  return (
    <div className="group/row relative">
      {!hidePresetPicker && (
        <RowLayoutPicker
          columnCount={row.columns.length}
          onChange={(columns) => onSetRowLayout(row.id, columns)}
        />
      )}
      <div
        className={`grid w-full ${onChangeAdjacentColumnWidths ? '' : 'gap-2'}`}
        style={{ gridTemplateColumns }}
      >
        {row.columns.map((column, columnIndex) => (
          <Fragment key={column.id}>
            {columnIndex > 0 && onChangeAdjacentColumnWidths && (
              <ColumnResizeDivider
                row={row}
                leftColumn={row.columns[columnIndex - 1]}
                rightColumn={column}
                onCommit={onChangeAdjacentColumnWidths}
                gridColumn={columnIndex * 2}
              />
            )}
            <CanvasColumn
              row={row}
              column={column}
              columnIndex={columnIndex}
              depth={depth}
              selectedElementId={selectedElementId}
              onSelectElement={onSelectElement}
              onRemoveElement={onRemoveElement}
              onRemoveColumn={onRemoveColumn}
              onSetRowLayout={onSetRowLayout}
              onAddNestedRow={onAddNestedRow}
              onRemoveNestedRow={onRemoveNestedRow}
              hidePresetPicker={hidePresetPicker}
              onChangeAdjacentColumnWidths={onChangeAdjacentColumnWidths}
              onPatchElement={onPatchElement}
              onSelectColumn={onSelectColumn}
              addTargetColumnId={addTargetColumnId}
              isDragActive={isDragActive}
              elementTypes={elementTypes}
              onQuickAddElement={onQuickAddElement}
            />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/**
 * Chrome preview + rows/columns/elements canvas with one level of nested rows
 * inside top-level columns. DnD works across any column droppable.
 */
export function ChannelCanvas({
  design,
  title,
  onTitleChange,
  selectedElementId,
  onSelectElement,
  onReorderElement,
  onMoveElement,
  onRemoveElement,
  onAddRow,
  onRemoveColumn,
  onSetRowLayout,
  onAddNestedRow,
  onRemoveNestedRow,
  mode = 'popup',
  externalContext = false,
  hidePresetPicker,
  onChangeAdjacentColumnWidths,
  onPatchElement,
  onSelectColumn,
  addTargetColumnId,
  isDragActive,
  elementTypes,
  onQuickAddElement,
}: {
  design: ChannelDesign;
  title?: string;
  onTitleChange?: (value: string) => void;
  selectedElementId: string | null;
  onSelectElement: (elementId: string) => void;
  onReorderElement: (columnId: string, sourceIndex: number, destinationIndex: number) => void;
  onMoveElement: (
    sourceColumnId: string,
    sourceIndex: number,
    destColumnId: string,
    destIndex: number,
  ) => void;
  onRemoveElement: (elementId: string) => void;
  onAddRow: () => void;
  onRemoveColumn: (rowId: string, columnId: string) => void;
  onSetRowLayout: (rowId: string, columns: RowColumnPreset) => void;
  onAddNestedRow: (columnId: string) => void;
  onRemoveNestedRow: (parentColumnId: string, nestedRowId: string) => void;
  mode?: 'popup' | 'email';
  externalContext?: boolean;
  hidePresetPicker?: boolean;
  onChangeAdjacentColumnWidths?: (rowId: string, leftColId: string, rightColId: string, leftPct: number, rightPct: number) => void;
  onPatchElement?: (elementId: string, patch: Partial<CreativeElement>) => void;
  /** Empty-space click on a column selects it as the click-to-add target. */
  onSelectColumn?: (columnId: string) => void;
  /** Column that the next click-to-add will land in — gets a visible marker. */
  addTargetColumnId?: string | null;
  /**
   * A drag is in progress (palette or element). Only meaningful with
   * `externalContext` — when the canvas owns its DragDropContext it tracks
   * this itself. All columns advertise their landing zone while true.
   */
  isDragActive?: boolean;
  /** Element type list for the per-column quick-add "+" (with onQuickAddElement). */
  elementTypes?: Array<{ type: CreativeElement['type']; label: string }>;
  onQuickAddElement?: (type: CreativeElement['type'], columnId: string) => void;
}) {
  const isEmail = mode === 'email';
  // Internal DragDropContext case (popup/email editors): track drag state here.
  const [internalDragActive, setInternalDragActive] = useState(false);
  // Landing-zone visuals are an opt-in feature of hosts that pass the new
  // column-targeting props. When ChannelCanvas owns its own DragDropContext
  // (email editor standalone mode), keep the pre-existing rendering: the email
  // editor never asked for drag-active outlines, and turning them on there
  // would be a silent behaviour change for a different feature's commit.
  const columnTargetingEnabled = Boolean(onSelectColumn || onQuickAddElement || isDragActive !== undefined);
  const dragActive = columnTargetingEnabled
    ? (externalContext ? !!isDragActive : internalDragActive)
    : false;
  const popupMeta = design.meta as PopupChrome;
  const emailMeta = design.meta as EmailChrome;
  const handleDragEnd = (result: DropResult) => {
    setInternalDragActive(false);
    if (!result.destination) return;
    const { source, destination } = result;
    if (source.droppableId === destination.droppableId) {
      if (source.index === destination.index) return;
      onReorderElement(source.droppableId, source.index, destination.index);
      return;
    }
    onMoveElement(source.droppableId, source.index, destination.droppableId, destination.index);
  };

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        backgroundColor: isEmail
          ? emailMeta.backgroundColor || '#f4f4f4'
          : popupMeta.overlayColor || 'rgba(0,0,0,0.5)',
      }}
    >
      <div
        className={`relative mx-auto overflow-x-clip overflow-y-visible ${isEmail ? 'shadow-sm' : 'bg-white shadow-2xl'}`}
        style={{
          maxWidth: '100%',
          width: isEmail ? emailMeta.contentWidthPx ?? 600 : popupMeta.widthPx ?? 448,
          borderRadius: isEmail ? 4 : popupMeta.borderRadiusPx ?? 16,
          backgroundColor: isEmail ? emailMeta.contentBackgroundColor || '#ffffff' : '#ffffff',
        }}
      >
        {!isEmail && (
          <span
            className={`absolute z-10 grid h-6 w-6 place-items-center rounded-full bg-black/50 text-xs font-bold text-white ${closeButtonCornerClass(popupMeta.closeButton?.corner ?? 'tr')}`}
          >
            ×
          </span>
        )}
        <div className="space-y-2.5 px-3 py-3">
          {!isEmail && onTitleChange && (
            <input
              type="text"
              aria-label="หัวข้อ popup"
              className="min-h-[2.75rem] w-full border-0 bg-transparent pr-7 text-sm font-semibold text-neutral-900 placeholder:text-neutral-300 focus:outline-none focus:ring-1 focus:ring-primary/40"
              placeholder="พิมพ์หัวข้อ popup ตรงนี้..."
              value={title ?? ''}
              onChange={(event) => onTitleChange(event.target.value)}
            />
          )}

          {externalContext ? (
            <div className="space-y-3">
              {design.body.rows.map((row) => (
                <CanvasRow
                  key={row.id}
                  row={row}
                  depth={0}
                  selectedElementId={selectedElementId}
                  onSelectElement={onSelectElement}
                  onRemoveElement={onRemoveElement}
                  onRemoveColumn={onRemoveColumn}
                  onSetRowLayout={onSetRowLayout}
                  onAddNestedRow={onAddNestedRow}
                  onRemoveNestedRow={onRemoveNestedRow}
                  hidePresetPicker={hidePresetPicker}
                  onChangeAdjacentColumnWidths={onChangeAdjacentColumnWidths}
                  onPatchElement={onPatchElement}
                  onSelectColumn={onSelectColumn}
                  addTargetColumnId={addTargetColumnId}
                  isDragActive={dragActive}
                  elementTypes={elementTypes}
                  onQuickAddElement={onQuickAddElement}
                />
              ))}
            </div>
          ) : (
            <DragDropContext
              onDragStart={() => setInternalDragActive(true)}
              onDragEnd={handleDragEnd}
            >
              <div className="space-y-3">
                {design.body.rows.map((row) => (
                  <CanvasRow
                    key={row.id}
                    row={row}
                    depth={0}
                    selectedElementId={selectedElementId}
                    onSelectElement={onSelectElement}
                    onRemoveElement={onRemoveElement}
                    onRemoveColumn={onRemoveColumn}
                    onSetRowLayout={onSetRowLayout}
                    onAddNestedRow={onAddNestedRow}
                    onRemoveNestedRow={onRemoveNestedRow}
                    hidePresetPicker={hidePresetPicker}
                    onChangeAdjacentColumnWidths={onChangeAdjacentColumnWidths}
                    onPatchElement={onPatchElement}
                    onSelectColumn={onSelectColumn}
                    addTargetColumnId={addTargetColumnId}
                    isDragActive={dragActive}
                    elementTypes={elementTypes}
                    onQuickAddElement={onQuickAddElement}
                  />
                ))}
              </div>
            </DragDropContext>
          )}

          <button
            type="button"
            onClick={onAddRow}
            className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-neutral-300 py-1.5 text-[11px] text-neutral-400 hover:border-primary hover:text-primary"
          >
            <MdAdd size={13} /> เพิ่มแถวใหม่
          </button>
        </div>
      </div>
    </div>
  );
}
