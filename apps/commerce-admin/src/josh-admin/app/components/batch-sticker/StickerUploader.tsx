// ui-metadata-migration: static labels and UI notices only
import { useState } from 'react';
import { DragDropUpload } from '@josh/shared-ui-web';
import { isAcceptedStickerImage, readImageDimensions } from '../../lib/batch-sticker/image/decodeImage';
import type { StickerAsset } from '../../types/batch-sticker';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function StickerUploader({ onAsset }: { onAsset: (asset: StickerAsset) => void }) {
  __useUiLocale();
  const [error, setError] = useState<string | null>(null);

  async function handleFileSelect(file: File) {
    if (!isAcceptedStickerImage(file)) {
      setError(__uiMessage("Only PNG or WebP files are supported for stickers (need transparency)."));
      return;
    }
    setError(null);

    try {
      const { width, height } = await readImageDimensions(file);
      onAsset({ file, filename: file.name, width, height, aspectRatio: width / height });
    } catch {
      setError(__uiMessage("Failed to decode {0}.", {"0": file.name}));
    }
  }

  return (
    <div className="space-y-2">
      <DragDropUpload onFileSelect={handleFileSelect} accept="image/png,image/webp" maxSizeMB={20} />
      {error && <p className="text-sm text-red-600">{(typeof error === 'string' ? __uiText(error) : error)}</p>}
    </div>
  );
}

export default StickerUploader;
