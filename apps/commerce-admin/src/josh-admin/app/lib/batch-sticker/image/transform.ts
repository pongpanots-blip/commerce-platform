import type { StickerRect, StickerTransform } from '../../../types/batch-sticker';

/**
 * Single source of truth for turning a normalized sticker transform into
 * real pixel coordinates for a given image size. Both the interactive
 * preview canvas and the batch worker must call this — never reimplement
 * the math in either place — or preview and export will drift apart.
 */
export function calculateStickerRect(
  imageWidth: number,
  imageHeight: number,
  transform: StickerTransform,
): StickerRect {
  const width = transform.width * imageWidth;
  const height = transform.height * imageHeight;
  const x = transform.x * imageWidth;
  const y = transform.y * imageHeight;

  return {
    x,
    y,
    width,
    height,
    centerX: x + width / 2,
    centerY: y + height / 2,
    rotationRadians: (transform.rotation * Math.PI) / 180,
    opacity: transform.opacity,
  };
}

/**
 * Keeps the unrotated bbox inside the 0–1 normalized image bounds.
 * Rotation is intentionally ignored here (see spec §7): a rotated sticker
 * near an edge may still visually extend past the canvas.
 */
export function clampTransform(transform: StickerTransform): StickerTransform {
  const width = Math.min(Math.max(transform.width, 0), 1);
  const height = Math.min(Math.max(transform.height, 0), 1);
  const maxX = Math.max(1 - width, 0);
  const maxY = Math.max(1 - height, 0);
  const x = Math.min(Math.max(transform.x, 0), maxX);
  const y = Math.min(Math.max(transform.y, 0), maxY);

  return { ...transform, x, y, width, height };
}

/**
 * Draws every sticker layer onto a 2D context in zIndex order, applying
 * rotation about each layer's bbox center. Used by both the preview
 * canvas and the batch worker's OffscreenCanvas.
 */
export function drawStickerLayer(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  stickerImage: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  transform: StickerTransform,
): void {
  const rect = calculateStickerRect(imageWidth, imageHeight, transform);

  ctx.save();
  ctx.translate(rect.centerX, rect.centerY);
  ctx.rotate(rect.rotationRadians);
  ctx.globalAlpha = rect.opacity;
  ctx.drawImage(stickerImage, -rect.width / 2, -rect.height / 2, rect.width, rect.height);
  ctx.restore();
}
