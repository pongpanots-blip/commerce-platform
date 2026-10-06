import type { StickerTransform } from '../../../types/batch-sticker';

export interface PoolLayer {
  transform: StickerTransform;
  bitmap: ImageBitmap;
}

interface PendingJob {
  resolve: (blob: Blob) => void;
  reject: (err: Error) => void;
}

/**
 * Owns a fixed-size pool of imageProcessor workers, each initialized with
 * the same sticker layers. `process` round-robins jobs across workers so
 * up to `size` images encode in parallel.
 */
export class ImageProcessorPool {
  private workers: Worker[] = [];
  private nextWorker = 0;
  private pending = new Map<string, PendingJob>();
  private jobCounter = 0;

  constructor(size: number, layers: PoolLayer[]) {
    for (let i = 0; i < size; i += 1) {
      const worker = new Worker(new URL('../../../workers/imageProcessor.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent) => this.handleMessage(event);
      // Each worker gets its own clone of the sticker bitmaps (structured
      // clone, not transferred) since a transferred ImageBitmap can only
      // go to one recipient.
      worker.postMessage({
        type: 'init',
        layers: layers.map((l) => ({ transform: l.transform, bitmap: l.bitmap })),
      });
      this.workers.push(worker);
    }
  }

  private handleMessage(event: MessageEvent): void {
    const { type, id } = event.data;
    const job = this.pending.get(id);
    if (!job) return;
    this.pending.delete(id);

    if (type === 'result') {
      job.resolve(event.data.blob as Blob);
    } else {
      job.reject(new Error(event.data.message as string));
    }
  }

  process(bitmap: ImageBitmap, width: number, height: number, quality: number): Promise<Blob> {
    const worker = this.workers[this.nextWorker];
    this.nextWorker = (this.nextWorker + 1) % this.workers.length;

    this.jobCounter += 1;
    const id = `job-${this.jobCounter}`;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'process', id, bitmap, width, height, quality }, [bitmap]);
    });
  }

  terminate(): void {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
  }
}
