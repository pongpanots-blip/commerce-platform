import { ELEMENT_TYPES } from './element-factory';
import {
  MdFormatAlignLeft, MdImage, MdSmartButton, MdLocalOffer, MdSpaceBar,
  MdHorizontalRule, MdPlayCircle, MdCode, MdTimer, MdViewCarousel,
  MdGridView, MdArticle, MdExpandMore,
} from 'react-icons/md';
import type { CreativeElement } from './creative-editor.types';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export const GRID_DND_MIME = 'application/x-creative-element';

const ICONS: Record<CreativeElement['type'], React.ReactNode> = {
  text: <MdFormatAlignLeft size={16} />,
  image: <MdImage size={16} />,
  button: <MdSmartButton size={16} />,
  coupon: <MdLocalOffer size={16} />,
  spacer: <MdSpaceBar size={16} />,
  divider: <MdHorizontalRule size={16} />,
  video: <MdPlayCircle size={16} />,
  html: <MdCode size={16} />,
  countdown: <MdTimer size={16} />,
  carousel: <MdViewCarousel size={16} />,
  product_grid: <MdGridView size={16} />,
  rich_text: <MdArticle size={16} />,
  accordion: <MdExpandMore size={16} />,
};

/**
 * Palette of element types draggable onto GridCanvas via native HTML5 drag.
 *
 * `types` is a prop rather than a hard-coded list because the popup and the
 * promotion page share this palette but not its contents: the page offers all
 * 13 types (`PAGE_ELEMENT_TYPES`), the popup only the 10 the email projection
 * can also render (`ELEMENT_TYPES`, the default).
 */
export function GridElementPalette({
  onDragTypeChange,
  types = ELEMENT_TYPES,
  onAdd,
  disabled = false,
  disabledHint,
}: {
  /** Fired with the type on dragstart and null on dragend — GridCanvas uses it for droppingItem sizing. */
  onDragTypeChange: (type: CreativeElement['type'] | null) => void;
  types?: Array<{ type: CreativeElement['type']; label: string }>;
  /**
   * Click-to-add fallback. Native HTML5 drag is unusable without a pointing
   * device (and untestable in jsdom), so a plain click appends the element at
   * the bottom of the grid. Omitted by the popup editor, which keeps drag-only.
   */
  onAdd?: (type: CreativeElement['type']) => void;
  /**
   * Turns every tile inert (no drag, no click) — used by the page editor while
   * the page is still a legacy rows page. See `disabledHint`.
   */
  disabled?: boolean;
  /** Shown under the tiles while `disabled`, explaining what to do instead. */
  disabledHint?: string;
}) {
  __useUiLocale();
  return (
    <div>
      <div
        data-testid="grid-element-palette"
        data-disabled={disabled ? 'true' : undefined}
        className={`grid grid-cols-2 gap-1.5 ${disabled ? 'opacity-40' : ''}`}
      >
        {types.map(({ type, label }) => (
          <div
            key={type}
            draggable={!disabled}
            unselectable="on"
            data-grid-palette-item={type}
            aria-disabled={disabled || undefined}
            onDragStart={
              disabled
                ? undefined
                : (event) => {
                    event.dataTransfer.setData(GRID_DND_MIME, type);
                    event.dataTransfer.effectAllowed = 'copy';
                    onDragTypeChange(type);
                  }
            }
            onDragEnd={disabled ? undefined : () => onDragTypeChange(null)}
            onClick={disabled || !onAdd ? undefined : () => onAdd(type)}
            title={
              disabled
                ? disabledHint ?? label
                : onAdd
                  ? __uiText("{0} — ลากไปวางบน grid หรือคลิกเพื่อเพิ่มท้ายหน้า", {"0": label})
                  : label
            }
            className={`flex flex-col items-center gap-1 rounded-md border border-neutral-200 bg-white p-2 text-neutral-500 ${
              disabled
                ? 'cursor-not-allowed'
                : 'cursor-grab hover:border-primary hover:text-primary active:cursor-grabbing'
            }`}
          >
            {ICONS[type]}
            <span className="text-[10px]">{label}</span>
          </div>
        ))}
      </div>
      {disabled && disabledHint && (
        <p
          data-testid="palette-disabled-hint"
          className="mt-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-700"
        >
          {disabledHint}
        </p>
      )}
    </div>
  );
}
