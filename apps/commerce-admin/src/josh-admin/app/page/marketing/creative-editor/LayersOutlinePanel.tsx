import { useState } from 'react';
import { MdMoreVert, MdDragIndicator, MdFormatAlignLeft, MdImage, MdSmartButton, MdLocalOffer, MdSpaceBar, MdHorizontalRule, MdPlayCircle, MdCode, MdTimer, MdViewCarousel, MdGridView, MdArticle, MdExpandMore } from 'react-icons/md';
import { gridStackOrder } from '@josh/shared-api';
import { useCreativeI18n } from './use-creative-i18n';
import type { ChannelDesign, CreativeElement, CreativeRow } from './creative-editor.types';

const ELEMENT_ICONS: Record<CreativeElement['type'], React.ReactNode> = {
  text: <MdFormatAlignLeft size={13} />,
  image: <MdImage size={13} />,
  button: <MdSmartButton size={13} />,
  coupon: <MdLocalOffer size={13} />,
  spacer: <MdSpaceBar size={13} />,
  divider: <MdHorizontalRule size={13} />,
  video: <MdPlayCircle size={13} />,
  html: <MdCode size={13} />,
  countdown: <MdTimer size={13} />,
  carousel: <MdViewCarousel size={13} />,
  product_grid: <MdGridView size={13} />,
  rich_text: <MdArticle size={13} />,
  accordion: <MdExpandMore size={13} />,
};

const ELEMENT_LABELS: Record<CreativeElement['type'], string> = {
  text: 'ข้อความ',
  image: 'รูปภาพ',
  button: 'ปุ่ม',
  coupon: 'คูปอง',
  spacer: 'ระยะห่าง',
  divider: 'เส้นคั่น',
  video: 'วิดีโอ',
  html: 'HTML',
  countdown: 'นับถอยหลัง',
  carousel: 'สไลด์รูป',
  product_grid: 'กริดสินค้า',
  rich_text: 'ข้อความ (Rich Text)',
  accordion: 'แอคคอร์เดียน',
};

function ElementMenu({
  onDuplicate,
  onRemove,
}: {
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Element actions"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
      >
        <MdMoreVert size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-0.5 w-28 overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg">
            <button
              type="button"
              className="flex w-full items-center px-3 py-1.5 text-left text-[11px] hover:bg-neutral-50"
              onClick={(e) => { e.stopPropagation(); onDuplicate(); setOpen(false); }}
            >
              Duplicate
            </button>
            <button
              type="button"
              className="flex w-full items-center px-3 py-1.5 text-left text-[11px] text-red-500 hover:bg-red-50"
              onClick={(e) => { e.stopPropagation(); onRemove(); setOpen(false); }}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function RowSection({
  row,
  rowIndex,
  selectedElementId,
  onSelectElement,
  onRemoveElement,
  onDuplicateElement,
  needsTranslation,
}: {
  row: CreativeRow;
  rowIndex: number;
  selectedElementId: string | null;
  onSelectElement: (id: string) => void;
  onRemoveElement: (id: string) => void;
  onDuplicateElement: (id: string) => void;
  /** True when the element still needs a translation (translatable type + no meaningful overlay). */
  needsTranslation: (elementId: string, elementType: CreativeElement['type']) => boolean;
}) {
  return (
    <div className="mb-2">
      <p className="mb-0.5 px-1 text-[9px] font-semibold uppercase tracking-wider text-neutral-400">
        แถว {rowIndex + 1}
      </p>
      {row.columns.map((column, colIndex) => (
        <div key={column.id} className="mb-1 ml-2">
          {row.columns.length > 1 && (
            <p className="mb-0.5 text-[9px] text-neutral-400">
              คอลัมน์ {colIndex + 1}
            </p>
          )}
          <div className="ml-2 space-y-0.5">
            {column.elements.map((element) => (
              <div
                key={element.id}
                onClick={() => onSelectElement(element.id)}
                className={`group flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] ${
                  selectedElementId === element.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                <MdDragIndicator size={12} className="shrink-0 text-neutral-300" />
                <span className="shrink-0 text-neutral-400">{ELEMENT_ICONS[element.type]}</span>
                <span className="flex-1 truncate">{ELEMENT_LABELS[element.type]}</span>
                {needsTranslation(element.id, element.type) && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="ยังไม่ได้แปล" />
                )}
                <div className="opacity-0 group-hover:opacity-100">
                  <ElementMenu
                    onDuplicate={() => onDuplicateElement(element.id)}
                    onRemove={() => onRemoveElement(element.id)}
                  />
                </div>
              </div>
            ))}
            {column.elements.length === 0 && (
              <p className="px-2 py-1 text-[10px] italic text-neutral-300">ว่างเปล่า</p>
            )}
            {/* Nested rows */}
            {(column.rows ?? []).map((nestedRow, nri) => (
              <div key={nestedRow.id} className="ml-2 mt-1">
                <p className="mb-0.5 text-[9px] text-neutral-400">แถวย่อย {nri + 1}</p>
                {nestedRow.columns.map((nestedCol) => (
                  <div key={nestedCol.id} className="ml-2 space-y-0.5">
                    {nestedCol.elements.map((element) => (
                      <div
                        key={element.id}
                        onClick={() => onSelectElement(element.id)}
                        className={`group flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] ${
                          selectedElementId === element.id
                            ? 'bg-primary/10 text-primary'
                            : 'text-neutral-600 hover:bg-neutral-100'
                        }`}
                      >
                        <MdDragIndicator size={12} className="shrink-0 text-neutral-300" />
                        <span className="shrink-0 text-neutral-400">{ELEMENT_ICONS[element.type]}</span>
                        <span className="flex-1 truncate">{ELEMENT_LABELS[element.type]}</span>
                        {needsTranslation(element.id, element.type) && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="ยังไม่ได้แปล" />
                        )}
                        <div className="opacity-0 group-hover:opacity-100">
                          <ElementMenu
                            onDuplicate={() => onDuplicateElement(element.id)}
                            onRemove={() => onRemoveElement(element.id)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function LayersOutlinePanel({
  design,
  selectedElementId,
  onSelectElement,
  onRemoveElement,
  onDuplicateElement,
  editorLocale,
}: {
  design: ChannelDesign;
  selectedElementId: string | null;
  onSelectElement: (id: string) => void;
  onRemoveElement: (id: string) => void;
  onDuplicateElement: (id: string) => void;
  editorLocale?: string;
}) {
  // Pure reads only (needsTranslation/hasOverlay) — this panel never mutates the design.
  const { needsTranslation } = useCreativeI18n(design, () => {}, editorLocale ?? 'th');
  const grid = design.body.grid;
  if (grid) {
    const sorted = gridStackOrder(grid.items);
    if (sorted.length === 0) {
      return (
        <p className="px-2 py-3 text-center text-[11px] italic text-neutral-300">
          ยังไม่มี element — ลากจาก Elements มาวางได้เลย
        </p>
      );
    }
    const byId = new Map(grid.elements.map((el) => [el.id, el]));
    return (
      <div className="space-y-0.5">
        {sorted.map((it) => {
          const element = byId.get(it.elementId);
          if (!element) return null;
          return (
            <div
              key={it.elementId}
              onClick={() => onSelectElement(it.elementId)}
              className={`group flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] ${
                selectedElementId === it.elementId
                  ? 'bg-primary/10 text-primary'
                  : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              <span className="shrink-0 text-neutral-400">{ELEMENT_ICONS[element.type]}</span>
              <span className="flex-1 truncate">{ELEMENT_LABELS[element.type]}</span>
              {needsTranslation(element.id, element.type) && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="ยังไม่ได้แปล" />
              )}
              <span className="text-[9px] text-neutral-300">
                r{it.row} c{it.col}·{it.colSpan}
              </span>
              <div className="opacity-0 group-hover:opacity-100">
                <ElementMenu
                  onDuplicate={() => onDuplicateElement(it.elementId)}
                  onRemove={() => onRemoveElement(it.elementId)}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  if (design.body.rows.length === 0) {
    return (
      <p className="px-2 py-3 text-center text-[11px] italic text-neutral-300">
        ยังไม่มี element — ลากจาก Elements มาวางได้เลย
      </p>
    );
  }
  return (
    <div>
      {design.body.rows.map((row, rowIndex) => (
        <RowSection
          key={row.id}
          row={row}
          rowIndex={rowIndex}
          selectedElementId={selectedElementId}
          onSelectElement={onSelectElement}
          onRemoveElement={onRemoveElement}
          onDuplicateElement={onDuplicateElement}
          needsTranslation={needsTranslation}
        />
      ))}
    </div>
  );
}
