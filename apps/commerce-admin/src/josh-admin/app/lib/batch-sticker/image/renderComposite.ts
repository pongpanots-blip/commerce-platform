import { drawStickerLayer } from './transform';
import type { StickerTransform } from '../../../types/batch-sticker';

export interface RenderableLayer {
  transform: StickerTransform;
  image: CanvasImageSource;
}

/**
 * Draws the source image at its ORIGINAL resolution (never resized) onto a
 * new canvas, then every sticker layer on top in zIndex order (callers
 * must pass `layers` pre-sorted). Works with both OffscreenCanvas (worker)
 * and HTMLCanvasElement (main-thread fallback) since both share the same
 * 2D context drawing API.
 */
export function renderComposite(
  source: CanvasImageSource,
  width: number,
  height: number,
  layers: RenderableLayer[],
  createCanvas: (w: number, h: number) => OffscreenCanvas | HTMLCanvasElement,
): OffscreenCanvas | HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  ctx.drawImage(source, 0, 0, width, height);

  for (const layer of layers) {
    drawStickerLayer(ctx, layer.image, width, height, layer.transform);
  }

  return canvas;
}
