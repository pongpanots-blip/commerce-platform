import { useState } from 'react';
import { Button } from '@josh/shared-ui-web';
import type { StickerLayer } from '../../types/batch-sticker';

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
  const [showSummary, setShowSummary] = useState(false);

  if (showSummary) {
    return (
      <div className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
        <div className="text-sm font-medium text-gray-700">Confirm processing</div>
        <dl className="grid grid-cols-2 gap-y-1 text-sm text-gray-600">
          <dt className="text-gray-400">Images</dt>
          <dd>{imageCount}</dd>
          <dt className="text-gray-400">Sticker layers</dt>
          <dd>{layers.map((l) => l.asset.filename).join(', ') || '—'}</dd>
          <dt className="text-gray-400">Output</dt>
          <dd>WebP / Quality {Math.round(quality * 100)}</dd>
          <dt className="text-gray-400">Estimated output</dt>
          <dd>{imageCount} files</dd>
        </dl>
        <div className="flex gap-3">
          <Button
            onClick={() => {
              setShowSummary(false);
              onProcess();
            }}
          >
            Process Lot
          </Button>
          <Button variant="secondary" onClick={() => setShowSummary(false)}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button disabled={disabled || imageCount === 0 || layers.length === 0} onClick={() => setShowSummary(true)}>
      Process {imageCount} Images
    </Button>
  );
}

export default ProcessButton;
