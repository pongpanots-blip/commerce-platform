import { useEffect, useRef, useState } from 'react';
import { applyDragDelta, applyResizeDelta, applyRotateDelta } from '../../lib/batch-sticker/gestures/dragResizeRotate';
import type { ContainRect } from '../../lib/batch-sticker/image/previewLayout';
import type { StickerLayer, StickerTransform } from '../../types/batch-sticker';

type Gesture = 'drag' | 'resize' | 'rotate' | null;

export function StickerOverlay({
  layer,
  containRect,
  isSelected,
  onSelect,
  onCommit,
}: {
  layer: StickerLayer;
  containRect: ContainRect;
  isSelected: boolean;
  onSelect: () => void;
  onCommit: (transform: StickerTransform) => void;
}) {
  const [liveTransform, setLiveTransform] = useState<StickerTransform | null>(null);
  const gestureRef = useRef<Gesture>(null);
  const startRef = useRef<{ x: number; y: number; transform: StickerTransform } | null>(null);

  const transform = liveTransform ?? layer.transform;

  const [assetUrl, setAssetUrl] = useState<string>('');
  useEffect(() => {
    const url = URL.createObjectURL(layer.asset.file);
    setAssetUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [layer.asset.file]);

  function beginGesture(gesture: Gesture, e: React.PointerEvent) {
    e.stopPropagation();
    onSelect();
    gestureRef.current = gesture;
    startRef.current = { x: e.clientX, y: e.clientY, transform: layer.transform };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!gestureRef.current || !startRef.current) return;

    const dxPx = e.clientX - startRef.current.x;
    const dyPx = e.clientY - startRef.current.y;
    const dxNorm = dxPx / containRect.width;
    const dyNorm = dyPx / containRect.height;

    let next: StickerTransform;
    if (gestureRef.current === 'drag') {
      next = applyDragDelta(startRef.current.transform, dxNorm, dyNorm);
    } else if (gestureRef.current === 'resize') {
      next = applyResizeDelta(startRef.current.transform, dxNorm, dyNorm, {
        lockAspectRatio: layer.lockAspectRatio,
        aspectRatio: layer.asset.aspectRatio,
      });
    } else {
      // Rotate: angle from the bbox center to the current pointer position.
      const centerX = containRect.x + (startRef.current.transform.x + startRef.current.transform.width / 2) * containRect.width;
      const centerY = containRect.y + (startRef.current.transform.y + startRef.current.transform.height / 2) * containRect.height;
      next = applyRotateDelta(startRef.current.transform, e.clientX - centerX, e.clientY - centerY);
    }

    setLiveTransform(next);
  }

  function endGesture() {
    if (liveTransform) onCommit(liveTransform);
    gestureRef.current = null;
    startRef.current = null;
    setLiveTransform(null);
  }

  const left = containRect.x + transform.x * containRect.width;
  const top = containRect.y + transform.y * containRect.height;
  const width = transform.width * containRect.width;
  const height = transform.height * containRect.height;

  return (
    <div
      className={`absolute ${isSelected ? 'outline outline-2 outline-primary' : ''}`}
      style={{
        left,
        top,
        width,
        height,
        transform: `rotate(${transform.rotation}deg)`,
        transformOrigin: 'center center',
        opacity: transform.opacity,
        touchAction: 'none',
        cursor: isSelected ? 'move' : 'pointer',
      }}
      onPointerDown={(e) => beginGesture('drag', e)}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
    >
      {assetUrl && <img src={assetUrl} alt="" className="h-full w-full select-none" draggable={false} />}

      {isSelected && (
        <>
          <div
            className="absolute -bottom-2 -right-2 h-4 w-4 cursor-se-resize rounded-full border-2 border-white bg-primary"
            style={{ touchAction: 'none' }}
            onPointerDown={(e) => beginGesture('resize', e)}
            onPointerMove={handlePointerMove}
            onPointerUp={endGesture}
          />
          <div
            className="absolute -top-6 left-1/2 h-4 w-4 -translate-x-1/2 cursor-alias rounded-full border-2 border-white bg-primary"
            style={{ touchAction: 'none' }}
            onPointerDown={(e) => beginGesture('rotate', e)}
            onPointerMove={handlePointerMove}
            onPointerUp={endGesture}
          />
        </>
      )}
    </div>
  );
}

export default StickerOverlay;
