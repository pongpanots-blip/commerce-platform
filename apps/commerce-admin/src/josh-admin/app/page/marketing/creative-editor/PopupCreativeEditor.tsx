import { useEffect, useState } from 'react';
import { resolveDesignForLocale } from '@josh/shared-api';
import { GridCanvas } from './GridCanvas';
import { GridElementPalette } from './GridElementPalette';
import { ElementInspector } from './ElementInspector';
import { ChromeInspector } from './ChromeInspector';
import { LayersOutlinePanel } from './LayersOutlinePanel';
import { ensureGridDesign } from './element-factory';
import { useGridEditor } from './use-grid-editor';
import { useCreativeI18n } from './use-creative-i18n';
import type { BannerOption, ChannelDesign, CouponOption, CreativeElement, PopupChrome } from './creative-editor.types';

/** Figma-style popup editor on an 8-column collision grid. */
// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function PopupCreativeEditor({
  design,
  onChange,
  title,
  onTitleChange,
  coupons,
  banners,
  variables,
}: {
  design: ChannelDesign;
  onChange: (design: ChannelDesign) => void;
  title: string;
  onTitleChange: (title: string) => void;
  coupons: CouponOption[];
  banners: BannerOption[];
  variables: Array<{ key: string; label: string }>;
}) {
  __useUiLocale();
  // Legacy designs (rows, no grid) convert once on open; existing grids are reconciled
  // (orphaned items removed, elements missing an item repaired).
  useEffect(() => {
    const next = ensureGridDesign(design);
    if (next !== design) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design]);

  const [draggingType, setDraggingType] = useState<CreativeElement['type'] | null>(null);
  const [editorLocale, setEditorLocale] = useState<'th' | 'en'>('th');

  const {
    items,
    elements,
    selectedElementId,
    setSelectedElementId,
    selectedElement,
    selectedItem,
    addElementAt,
    applyLayout,
    patchElement,
    patchElementImages,
    patchGridItem,
    duplicateElement,
    removeElement,
  } = useGridEditor(design, onChange);

  const { overlayFor, patchOverlay, chromeOverlayFor, patchChromeOverlay } = useCreativeI18n(
    design,
    onChange,
    editorLocale,
  );

  const patchMeta = (patch: Partial<PopupChrome>) => {
    onChange({ ...design, meta: { ...(design.meta as PopupChrome), ...patch } });
  };

  if (!design.body.grid) return null; // one render while the conversion effect runs

  // Mutations stay bound to the real design (useGridEditor above); this is display-only.
  const canvasDesign = editorLocale === 'th' ? design : resolveDesignForLocale(design, editorLocale);
  const canvasElements = canvasDesign.body.grid?.elements ?? elements;

  return (
    <div className="grid h-[640px] grid-cols-[260px_1fr_300px] overflow-hidden rounded-xl border border-neutral-200 bg-white">
      {/* Left panel — palette + layers */}
      <div className="flex flex-col overflow-hidden border-r border-neutral-200 bg-neutral-50">
        <div className="border-b border-neutral-200 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{__uiText("Elements")}</p>
          <GridElementPalette onDragTypeChange={setDraggingType} />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{__uiText("Layers")}</p>
          <LayersOutlinePanel
            design={design}
            selectedElementId={selectedElementId}
            onSelectElement={setSelectedElementId}
            onRemoveElement={removeElement}
            onDuplicateElement={duplicateElement}
            editorLocale={editorLocale}
          />
        </div>
      </div>

      {/* Center — grid canvas */}
      <div className="overflow-auto bg-neutral-100 p-6">
        <div className="mx-auto mb-3 flex w-full max-w-[720px] items-center gap-2">
          <input
            type="text"
            aria-label={__uiText("หัวข้อ popup (ไม่แสดงบน popup · ไม่บังคับ)")}
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder={__uiText("หัวข้อ (ไม่แสดงบน popup · ไม่บังคับ)")}
            className="block flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-center text-sm font-semibold text-neutral-700 hover:border-neutral-200 focus:border-primary focus:outline-none"
          />
          <div className="flex shrink-0 overflow-hidden rounded-md border border-neutral-200">
            {(['th', 'en'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setEditorLocale(code)}
                className={`px-2.5 py-1 text-[11px] font-medium ${
                  editorLocale === code ? 'bg-primary text-white' : 'bg-white text-neutral-500 hover:text-neutral-700'
                }`}
              >
                {code === 'th' ? __uiText("ไทย") : __uiText("EN")}
              </button>
            ))}
          </div>
        </div>
        <GridCanvas
          items={items}
          elements={canvasElements}
          selectedElementId={selectedElementId}
          draggingType={draggingType}
          onSelectElement={setSelectedElementId}
          onApplyLayout={applyLayout}
          onAddElementAt={addElementAt}
          onRemoveElement={removeElement}
          meta={canvasDesign.meta as PopupChrome}
        />
      </div>

      {/* Right panel — inspectors */}
      <div className="flex flex-col gap-3 overflow-y-auto border-l border-neutral-200 p-3">
        {selectedElement && (
          <ElementInspector
            element={selectedElement}
            coupons={coupons}
            banners={banners}
            variables={variables}
            onPatch={patchElement}
            onRemove={() => selectedElementId && removeElement(selectedElementId)}
            gridItem={selectedItem ?? undefined}
            onPatchGridItem={(patch) => selectedElementId && patchGridItem(selectedElementId, patch)}
            editorLocale={editorLocale}
            overlay={selectedElementId ? overlayFor(selectedElementId) : undefined}
            onPatchOverlay={(patch) => selectedElementId && patchOverlay(selectedElementId, patch)}
            onPatchElementImages={patchElementImages}
          />
        )}
        <ChromeInspector
          meta={design.meta as PopupChrome}
          onChange={patchMeta}
          translating={editorLocale !== 'th'}
          chromeOverlay={chromeOverlayFor()}
          onPatchChromeOverlay={patchChromeOverlay}
        />
      </div>
    </div>
  );
}
