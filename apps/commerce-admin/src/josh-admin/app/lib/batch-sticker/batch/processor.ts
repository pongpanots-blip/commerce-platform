import { decodeImage } from '../image/decodeImage';
import { renderComposite } from '../image/renderComposite';
import { encodeCanvasToWebp, supportsWorkerPipeline } from '../image/webp';
import { runQueue } from './queue';
import { ImageProcessorPool } from './workerPool';
import type { BatchImage, StickerLayer } from '../../../types/batch-sticker';

export const DEFAULT_CONCURRENCY = 3;

export interface ProcessBatchOptions {
  images: BatchImage[];
  layers: StickerLayer[];
  quality: number; // 0–1
  concurrency?: number;
  onProgress?: (progress: { completed: number; failed: number; total: number; currentFile: string }) => void;
  isCancelled?: () => boolean;
}

export interface ProcessBatchResult {
  succeeded: Array<{ filename: string; blob: Blob }>;
  failed: Array<{ filename: string; error: string }>;
}

/** zIndex ascending, matching the paint order every renderer must use. */
function sortedLayers(layers: StickerLayer[]) {
  return [...layers].sort((a, b) => a.zIndex - b.zIndex);
}

async function processOneWithPool(pool: ImageProcessorPool, image: BatchImage, quality: number): Promise<Blob> {
  const decoded = await decodeImage(image.file);
  try {
    return await pool.process(decoded.bitmap, decoded.width, decoded.height, quality);
  } catch (err) {
    decoded.bitmap.close();
    throw err;
  }
}

async function processOneOnMainThread(
  image: BatchImage,
  layers: Array<{ transform: StickerLayer['transform']; image: CanvasImageSource }>,
  quality: number,
): Promise<Blob> {
  const decoded = await decodeImage(image.file);
  const canvas = renderComposite(decoded.bitmap, decoded.width, decoded.height, layers, (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  });
  decoded.bitmap.close();
  return encodeCanvasToWebp(canvas, quality);
}

/**
 * Runs the full lot through the sticker pipeline. Uses the worker +
 * OffscreenCanvas pool when available (keeps the UI thread free), falling
 * back to a same-thread canvas path otherwise. Never resizes source
 * images — output resolution always equals input resolution.
 */
export async function processBatch(options: ProcessBatchOptions): Promise<ProcessBatchResult> {
  const { images, layers, quality, concurrency = DEFAULT_CONCURRENCY, onProgress, isCancelled } = options;
  const orderedLayers = sortedLayers(layers);

  const succeeded: Array<{ filename: string; blob: Blob }> = [];
  const failed: Array<{ filename: string; error: string }> = [];

  const useWorkers = supportsWorkerPipeline() && typeof Worker !== 'undefined';

  let pool: ImageProcessorPool | undefined;
  let mainThreadLayers: Array<{ transform: StickerLayer['transform']; image: CanvasImageSource }> = [];

  if (useWorkers) {
    const stickerBitmaps = await Promise.all(orderedLayers.map((l) => createImageBitmap(l.asset.file)));
    pool = new ImageProcessorPool(
      Math.max(1, concurrency),
      orderedLayers.map((l, i) => ({ transform: l.transform, bitmap: stickerBitmaps[i] })),
    );
  } else {
    mainThreadLayers = await Promise.all(
      orderedLayers.map(async (l) => ({ transform: l.transform, image: await createImageBitmap(l.asset.file) })),
    );
  }

  try {
    await runQueue({
      items: images,
      concurrency: useWorkers ? Math.max(1, concurrency) : 1,
      isCancelled,
      worker: async (image) => {
        const blob = useWorkers
          ? await processOneWithPool(pool!, image, quality)
          : await processOneOnMainThread(image, mainThreadLayers, quality);
        succeeded.push({ filename: image.filename, blob });
        return blob;
      },
      onProgress: (progress, result) => {
        if (result.status === 'failed') {
          failed.push({ filename: result.item.filename, error: result.error.message });
        }
        onProgress?.({ ...progress, currentFile: result.item.filename });
      },
    });
  } finally {
    pool?.terminate();
  }

  return { succeeded, failed };
}
