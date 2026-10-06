import { useState } from 'react';
import { DragDropUpload } from '@josh/shared-ui-web';
import { isAcceptedStickerImage, readImageDimensions } from '../../lib/batch-sticker/image/decodeImage';
import type { StickerAsset } from '../../types/batch-sticker';

export function StickerUploader({ onAsset }: { onAsset: (asset: StickerAsset) => void }) {
  const [error, setError] = useState<string | null>(null);

  async function handleFileSelect(file: File) {
    if (!isAcceptedStickerImage(file)) {
      setError('Only PNG or WebP files are supported for stickers (need transparency).');
      return;
    }
    setError(null);

    try {
      const { width, height } = await readImageDimensions(file);
      onAsset({ file, filename: file.name, width, height, aspectRatio: width / height });
    } catch {
      setError(`Failed to decode ${file.name}.`);
    }
  }

  return (
    <div className="space-y-2">
      <DragDropUpload onFileSelect={handleFileSelect} accept="image/png,image/webp" maxSizeMB={20} />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

export default StickerUploader;
