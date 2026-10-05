import { useState } from 'react';
import { resolveDesignForLocale } from '@josh/shared-api';
import { ChannelCanvas } from './ChannelCanvas';
import { ElementInspector, RowLayoutInspector } from './ElementInspector';
import { EmailChromeInspector } from './ChromeInspector';
import { ELEMENT_TYPES } from './element-factory';
import { useChannelBodyEditor } from './use-channel-body-editor';
import { useCreativeI18n } from './use-creative-i18n';
import type { BannerOption, ChannelDesign, CouponOption, EmailChrome } from './creative-editor.types';

/**
 * Email counterpart to `PopupCreativeEditor` — same canvas + inspectors, no
 * popup overlay/close button/title field (email has no "headline" chrome
 * concept; subject/title stays on the notify's own title field). Edits a
 * `ChannelDesign` whose `meta` is `EmailChrome` (content width + backgrounds).
 */
export function EmailCreativeEditor({
  design,
  onChange,
  coupons,
  banners,
  variables,
}: {
  design: ChannelDesign;
  onChange: (design: ChannelDesign) => void;
  coupons: CouponOption[];
  banners: BannerOption[];
  variables: Array<{ key: string; label: string }>;
}) {
  const [editorLocale, setEditorLocale] = useState<'th' | 'en'>('th');

  const {
    selectedElementId,
    setSelectedElementId,
    selectedElement,
    selectedColumnId,
    selectColumn,
    addElement,
    addElementToColumn,
    patchElement,
    patchElementImages,
    removeElement,
    reorderElement,
    moveElement,
    addRow,
    addNestedRow,
    removeNestedRow,
    removeColumn,
    setRowLayout,
    changeColumnWidth,
  } = useChannelBodyEditor(design, onChange);

  const { overlayFor, patchOverlay } = useCreativeI18n(design, onChange, editorLocale);

  const patchMeta = (patch: Partial<EmailChrome>) => {
    onChange({ ...design, meta: { ...(design.meta as EmailChrome), ...patch } });
  };

  // Mutations stay bound to the real design (useChannelBodyEditor above); this is display-only.
  const canvasDesign = editorLocale === 'th' ? design : resolveDesignForLocale(design, editorLocale);

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold tracking-wide text-gray-400">เพิ่มองค์ประกอบ</span>
            {ELEMENT_TYPES.map((item) => (
              <button
                key={item.type}
                type="button"
                onClick={() => addElement(item.type)}
                className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                + {item.label}
              </button>
            ))}
            <span className="text-[10px] text-gray-400">
              · Layout 1/2/3 · แถวย่อยในคอลัมน์ · ลาก ⋮⋮ ข้ามช่องได้
            </span>
          </div>
          <div className="flex shrink-0 overflow-hidden rounded-md border border-gray-200">
            {(['th', 'en'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setEditorLocale(code)}
                className={`px-2.5 py-1 text-[11px] font-medium ${
                  editorLocale === code ? 'bg-primary text-white' : 'bg-white text-gray-500 hover:text-gray-700'
                }`}
              >
                {code === 'th' ? 'ไทย' : 'EN'}
              </button>
            ))}
          </div>
        </div>

        <ChannelCanvas
          mode="email"
          design={canvasDesign}
          selectedElementId={selectedElementId}
          onSelectElement={setSelectedElementId}
          onReorderElement={reorderElement}
          onMoveElement={moveElement}
          onRemoveElement={removeElement}
          onAddRow={addRow}
          onRemoveColumn={removeColumn}
          onSetRowLayout={setRowLayout}
          onAddNestedRow={addNestedRow}
          onRemoveNestedRow={removeNestedRow}
          onSelectColumn={selectColumn}
          addTargetColumnId={selectedColumnId}
          elementTypes={ELEMENT_TYPES}
          onQuickAddElement={addElementToColumn}
        />
      </div>

      <div className="space-y-3">
        <ElementInspector
          element={selectedElement}
          coupons={coupons}
          banners={banners}
          variables={variables}
          onPatch={patchElement}
          onPatchElementImages={patchElementImages}
          onRemove={() => selectedElementId && removeElement(selectedElementId)}
          editorLocale={editorLocale}
          overlay={selectedElementId ? overlayFor(selectedElementId) : undefined}
          onPatchOverlay={(patch) => selectedElementId && patchOverlay(selectedElementId, patch)}
        />
        <RowLayoutInspector rows={design.body.rows} onChangeColumnWidth={changeColumnWidth} />
        <EmailChromeInspector meta={design.meta as EmailChrome} onChange={patchMeta} />
      </div>
    </div>
  );
}
