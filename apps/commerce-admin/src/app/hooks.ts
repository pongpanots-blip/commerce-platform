import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Latest request wins. Dependency changes clear old records; reload retains them for context. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const run = useCallback(() => {
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    // Also catch synchronous loader errors. Ignore superseded and unmounted requests.
    Promise.resolve().then(loader)
      .then((d) => { if (request === generation.current) setData(d); })
      .catch((e) => { if (request === generation.current) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (request === generation.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    setData(null);
    run();
    return () => { ++generation.current; };
  }, [run]);

  return { data, loading, error, reload: run };
}

/** A synchronous lock prevents double submissions before React renders the disabled button. */
export function useMutation() {
  const lock = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  async function run<T>(operation: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    if (lock.current || !mounted.current) return { ok: false };
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = await operation();
      return mounted.current ? { ok: true, value } : { ok: false };
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
      return { ok: false };
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { busy, error, run };
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
