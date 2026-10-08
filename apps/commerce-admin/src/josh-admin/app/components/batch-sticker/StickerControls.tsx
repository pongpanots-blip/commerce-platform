import type { StickerLayer, StickerTransform } from '../../types/batch-sticker';
import { clampTransform } from '../../lib/batch-sticker/image/transform';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
function NumberField({
  label,
  value,
  suffix,
  onCommit,
}: {
  label: string;
  value: number;
  suffix?: string;
  onCommit: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm text-gray-600">
      <span className="w-16 shrink-0">{label}</span>
      <input
        type="number"
        className="w-full rounded-md border border-gray-200 px-2 py-1 text-right"
        value={value}
        onChange={(e) => onCommit(Number(e.target.value))}
      />
      {suffix && <span className="w-4 text-gray-400">{suffix}</span>}
    </label>
  );
}

export function StickerControls({
  layer,
  onChange,
  onToggleLockAspectRatio,
  onReset,
}: {
  layer: StickerLayer;
  onChange: (transform: StickerTransform) => void;
  onToggleLockAspectRatio: (locked: boolean) => void;
  onReset: () => void;
}) {
  __useUiLocale();
  const { transform } = layer;

  function commit(partial: Partial<StickerTransform>) {
    onChange(clampTransform({ ...transform, ...partial }));
  }

  return (
    <div className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
      <div className="text-sm font-medium text-gray-700">{layer.asset.filename}</div>
      <NumberField label={__uiText("X")} suffix="%" value={Math.round(transform.x * 100)} onCommit={(v) => commit({ x: v / 100 })} />
      <NumberField label={__uiText("Y")} suffix="%" value={Math.round(transform.y * 100)} onCommit={(v) => commit({ y: v / 100 })} />
      <NumberField
        label={__uiText("Width")}
        suffix="%"
        value={Math.round(transform.width * 100)}
        onCommit={(v) => {
          const width = v / 100;
          const height = layer.lockAspectRatio ? width / layer.asset.aspectRatio : transform.height;
          commit({ width, height });
        }}
      />
      <NumberField
        label={__uiText("Height")}
        suffix="%"
        value={Math.round(transform.height * 100)}
        onCommit={(v) => {
          const height = v / 100;
          const width = layer.lockAspectRatio ? height * layer.asset.aspectRatio : transform.width;
          commit({ width, height });
        }}
      />
      <NumberField
        label={__uiText("Opacity")}
        suffix="%"
        value={Math.round(transform.opacity * 100)}
        onCommit={(v) => commit({ opacity: Math.min(Math.max(v / 100, 0), 1) })}
      />
      <NumberField label={__uiText("Rotation")} suffix="°" value={Math.round(transform.rotation)} onCommit={(v) => commit({ rotation: ((v % 360) + 360) % 360 })} />
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input
          type="checkbox"
          checked={layer.lockAspectRatio}
          onChange={(e) => onToggleLockAspectRatio(e.target.checked)}
        />
        {__uiText("Lock Aspect Ratio")}</label>
      <button
        type="button"
        className="w-full rounded-md border border-gray-200 py-1 text-sm text-gray-600 hover:bg-gray-50"
        onClick={onReset}
      >
        {__uiText("Reset")}</button>
    </div>
  );
}

export default StickerControls;
