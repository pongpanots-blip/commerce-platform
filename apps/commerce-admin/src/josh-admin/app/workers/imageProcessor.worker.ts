/// <reference lib="webworker" />
import { renderComposite } from '../lib/batch-sticker/image/renderComposite';
import { encodeCanvasToWebp } from '../lib/batch-sticker/image/webp';
import type { StickerTransform } from '../types/batch-sticker';

interface InitMessage {
  type: 'init';
  layers: Array<{ transform: StickerTransform; bitmap: ImageBitmap }>;
}

interface ProcessMessage {
  type: 'process';
  id: string;
  bitmap: ImageBitmap;
  width: number;
  height: number;
  quality: number;
}

type IncomingMessage = InitMessage | ProcessMessage;

let layers: InitMessage['layers'] = [];

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;

  if (message.type === 'init') {
    layers = message.layers;
    return;
  }

  const { id, bitmap, width, height, quality } = message;

  try {
    const renderableLayers = layers.map((l) => ({ transform: l.transform, image: l.bitmap }));
    const canvas = renderComposite(bitmap, width, height, renderableLayers, (w, h) => new OffscreenCanvas(w, h));
    const blob = await encodeCanvasToWebp(canvas, quality);
    bitmap.close();
    (self as unknown as Worker).postMessage({ type: 'result', id, blob });
  } catch (err) {
    bitmap.close();
    (self as unknown as Worker).postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
