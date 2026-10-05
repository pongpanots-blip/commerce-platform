import { clampTransform } from '../image/transform';
import type { StickerTransform } from '../../../types/batch-sticker';

const MIN_SIZE = 0.02;

/** Moves the layer by a normalized (0–1 scale) pixel delta, clamped to image bounds. */
export function applyDragDelta(transform: StickerTransform, dxNormalized: number, dyNormalized: number): StickerTransform {
  return clampTransform({ ...transform, x: transform.x + dxNormalized, y: transform.y + dyNormalized });
}

/**
 * Resizes from the bottom-right handle. When aspect ratio is locked, only
 * the width delta drives the result and height is derived from it — this
 * matches dragging a single corner handle, which is the MVP interaction.
 */
export function applyResizeDelta(
  transform: StickerTransform,
  dWidthNormalized: number,
  dHeightNormalized: number,
  options: { lockAspectRatio: boolean; aspectRatio: number },
): StickerTransform {
  const width = Math.max(transform.width + dWidthNormalized, MIN_SIZE);
  const height = options.lockAspectRatio
    ? Math.max(width / options.aspectRatio, MIN_SIZE)
    : Math.max(transform.height + dHeightNormalized, MIN_SIZE);

  return clampTransform({ ...transform, width, height });
}

/**
 * Sets rotation from the pointer's angle relative to the bbox center.
 * Convention: a pointer directly above center (the handle's rest position)
 * is 0deg; angle increases clockwise, matching how a rotate handle above
 * the box behaves when dragged around it.
 */
export function applyRotateDelta(transform: StickerTransform, dx: number, dy: number): StickerTransform {
  const radians = Math.atan2(dx, -dy);
  const degrees = ((radians * 180) / Math.PI + 360) % 360;
  return { ...transform, rotation: degrees };
}
