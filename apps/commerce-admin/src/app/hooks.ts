import { useCallback, useEffect, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Runs an async loader on mount and exposes a manual reload. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(() => {
    setLoading(true);
    setError(null);
    loader()
      .then((d) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => run(), [run]);

  return { data, loading, error, reload: run };
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'processed':
    case 'completed':
    case 'active':
    case 'published':
      return 'badge ok';
    case 'failed':
      return 'badge danger';
    case 'received':
    case 'pending':
    case 'processing':
    case 'running':
      return 'badge warn';
    default:
      return 'badge muted';
  }
}
