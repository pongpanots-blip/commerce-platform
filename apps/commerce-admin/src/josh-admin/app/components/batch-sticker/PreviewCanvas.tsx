import { useEffect, useRef, useState } from 'react';
import { computeContainRect } from '../../lib/batch-sticker/image/previewLayout';
import { StickerOverlay } from './StickerOverlay';
import type { BatchImage, StickerLayer, StickerTransform } from '../../types/batch-sticker';

/**
 * Renders the current preview image plus every sticker layer, positioned
 * via CSS using the same normalized coordinates the batch worker uses for
 * export (calculateStickerRect) — here expressed against the container's
 * actual "object-fit: contain" bounds so a mixed-aspect-ratio lot never
 * shifts the preview panel's own size.
 */
export function PreviewCanvas({
  image,
  layers,
  selectedLayerId,
  onSelectLayer,
  onCommitTransform,
}: {
  image: BatchImage | undefined;
  layers: StickerLayer[];
  selectedLayerId: string | null;
  onSelectLayer: (layerId: string | null) => void;
  onCommitTransform: (layerId: string, transform: StickerTransform) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [imageUrl, setImageUrl] = useState('');

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!image) {
      setImageUrl('');
      return;
    }
    const url = URL.createObjectURL(image.file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  if (!image) {
    return (
      <div className="flex h-[500px] items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-400">
        No preview available yet.
      </div>
    );
  }

  const containRect =
    image.width && image.height && containerSize.width > 0
      ? computeContainRect(containerSize.width, containerSize.height, image.width, image.height)
      : { x: 0, y: 0, width: containerSize.width, height: containerSize.height };

  const sortedLayers = [...layers].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div
      ref={containerRef}
      className="relative h-[500px] w-full overflow-hidden rounded-md border border-gray-200 bg-gray-50"
      onPointerDown={() => onSelectLayer(null)}
    >
      {imageUrl && (
        <img src={imageUrl} alt={image.filename} className="h-full w-full object-contain" draggable={false} />
      )}
      {sortedLayers.map((layer) => (
        <StickerOverlay
          key={layer.id}
          layer={layer}
          containRect={containRect}
          isSelected={layer.id === selectedLayerId}
          onSelect={() => onSelectLayer(layer.id)}
          onCommit={(transform) => onCommitTransform(layer.id, transform)}
        />
      ))}
    </div>
  );
}

export default PreviewCanvas;
