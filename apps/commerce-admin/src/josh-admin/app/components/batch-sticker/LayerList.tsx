import type { StickerLayer } from '../../types/batch-sticker';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function LayerList({
  layers,
  selectedLayerId,
  onSelect,
  onRemove,
  onMove,
  onAddLayerClick,
}: {
  layers: StickerLayer[];
  selectedLayerId: string | null;
  onSelect: (layerId: string) => void;
  onRemove: (layerId: string) => void;
  onMove: (layerId: string, direction: 'up' | 'down') => void;
  onAddLayerClick: () => void;
}) {
  __useUiLocale();
  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{__uiText("Sticker Layers")}</span>
        <button
          type="button"
          className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          onClick={onAddLayerClick}
        >
          {__uiText("+ Add layer")}</button>
      </div>
      {sorted.length === 0 && <p className="text-sm text-gray-400">{__uiText("No sticker layers yet.")}</p>}
      <ul className="space-y-1">
        {sorted.map((layer, i) => (
          <li
            key={layer.id}
            className={`flex items-center justify-between rounded-md border px-2 py-1 text-sm ${
              layer.id === selectedLayerId ? 'border-primary bg-primary-soft' : 'border-gray-200'
            }`}
          >
            <button type="button" className="flex-1 truncate text-left" onClick={() => onSelect(layer.id)}>
              {layer.asset.filename}
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label={__uiText("Move layer up")}
                className="px-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                disabled={i === sorted.length - 1}
                onClick={() => onMove(layer.id, 'up')}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={__uiText("Move layer down")}
                className="px-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                disabled={i === 0}
                onClick={() => onMove(layer.id, 'down')}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={__uiText("Remove layer")}
                className="px-1 text-gray-400 hover:text-red-600"
                onClick={() => onRemove(layer.id)}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default LayerList;
