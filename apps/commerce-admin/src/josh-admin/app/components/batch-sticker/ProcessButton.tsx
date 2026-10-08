import { useState } from 'react';
import { Button } from '@josh/shared-ui-web';
import type { StickerLayer } from '../../types/batch-sticker';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function ProcessButton({
  imageCount,
  layers,
  quality,
  disabled,
  onProcess,
}: {
  imageCount: number;
  layers: StickerLayer[];
  quality: number;
  disabled?: boolean;
  onProcess: () => void;
}) {
  __useUiLocale();
  const [showSummary, setShowSummary] = useState(false);

  if (showSummary) {
    return (
      <div className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
        <div className="text-sm font-medium text-gray-700">{__uiText("Confirm processing")}</div>
        <dl className="grid grid-cols-2 gap-y-1 text-sm text-gray-600">
          <dt className="text-gray-400">{__uiText("Images")}</dt>
          <dd>{imageCount}</dd>
          <dt className="text-gray-400">{__uiText("Sticker layers")}</dt>
          <dd>{layers.map((l) => l.asset.filename).join(', ') || '—'}</dd>
          <dt className="text-gray-400">{__uiText("Output")}</dt>
          <dd>{__uiText("WebP / Quality ")}{Math.round(quality * 100)}</dd>
          <dt className="text-gray-400">{__uiText("Estimated output")}</dt>
          <dd>{imageCount} {__uiText(" files")}</dd>
        </dl>
        <div className="flex gap-3">
          <Button
            onClick={() => {
              setShowSummary(false);
              onProcess();
            }}
          >
            {__uiText("Process Lot")}</Button>
          <Button variant="secondary" onClick={() => setShowSummary(false)}>
            {__uiText("Back")}</Button>
        </div>
      </div>
    );
  }

  return (
    <Button disabled={disabled || imageCount === 0 || layers.length === 0} onClick={() => setShowSummary(true)}>
      {__uiText("Process ")}{imageCount} {__uiText(" Images")}</Button>
  );
}

export default ProcessButton;
