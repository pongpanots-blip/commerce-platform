export interface QueueProgress {
  completed: number;
  failed: number;
  total: number;
}

export type QueueResult<TItem, TValue> =
  | { item: TItem; status: 'success'; value: TValue }
  | { item: TItem; status: 'failed'; error: Error };

export interface RunQueueOptions<TItem, TValue> {
  items: TItem[];
  concurrency: number;
  worker: (item: TItem) => Promise<TValue>;
  onProgress?: (progress: QueueProgress, result: QueueResult<TItem, TValue>) => void;
  /** Checked before starting each new item; once true, no further items are started. */
  isCancelled?: () => boolean;
}

/**
 * Runs `worker` over `items` with at most `concurrency` in flight at once.
 * A single item throwing is captured as a 'failed' result and never aborts
 * the rest of the batch. Results are returned in the same order as the
 * items that were actually started (cancellation may leave the array
 * shorter than `items`).
 */
export async function runQueue<TItem, TValue>(
  options: RunQueueOptions<TItem, TValue>,
): Promise<QueueResult<TItem, TValue>[]> {
  const { items, concurrency, worker, onProgress, isCancelled } = options;
  const results: QueueResult<TItem, TValue>[] = [];
  let completed = 0;
  let failed = 0;
  let nextIndex = 0;

  async function runOne(): Promise<void> {
    while (nextIndex < items.length) {
      if (isCancelled?.()) return;

      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];

      let result: QueueResult<TItem, TValue>;
      try {
        const value = await worker(item);
        result = { item, status: 'success', value };
        completed += 1;
      } catch (err) {
        result = { item, status: 'failed', error: err instanceof Error ? err : new Error(String(err)) };
        failed += 1;
      }

      results[index] = result;
      onProgress?.({ completed, failed, total: items.length }, result);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => runOne());
  await Promise.all(workers);

  return results.filter((r): r is QueueResult<TItem, TValue> => r !== undefined);
}
