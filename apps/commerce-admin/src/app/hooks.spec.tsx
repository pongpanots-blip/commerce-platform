// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useAsync, useMutation, type AsyncState } from './hooks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let state: AsyncState<string>;
let mutation: ReturnType<typeof useMutation>;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function Read({ loader, query }: { loader: () => Promise<string>; query: string }) {
  state = useAsync(loader, [query]);
  return <div>{state.loading ? 'Loading' : state.error ?? state.data}</div>;
}
function Write() { mutation = useMutation(); return <div>{String(mutation.busy)}</div>; }
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('keeps the latest dependency result when older requests finish out of order', async () => {
  const first = deferred<string>();
  const second = deferred<string>();
  await act(async () => root.render(<Read query="first" loader={() => first.promise} />));
  await act(async () => root.render(<Read query="second" loader={() => second.promise} />));
  await act(async () => second.resolve('new'));
  expect(state.data).toBe('new');
  await act(async () => first.reject(new Error('old failure')));
  expect(state).toMatchObject({ data: 'new', loading: false, error: null });
});

it('ignores superseded reloads and clears stale records on a new query', async () => {
  const pending: ReturnType<typeof deferred<string>>[] = [];
  const loader = () => { const request = deferred<string>(); pending.push(request); return request.promise; };
  await act(async () => root.render(<Read query="a" loader={loader} />));
  await act(async () => pending[0].resolve('initial'));
  await act(async () => { state.reload(); state.reload(); });
  await act(async () => pending[1].resolve('superseded'));
  expect(state).toMatchObject({ data: 'initial', loading: true });
  await act(async () => pending[2].resolve('current'));
  await act(async () => root.render(<Read query="b" loader={loader} />));
  expect(state).toMatchObject({ data: null, loading: true });
});

it('catches synchronous failures and retries without retaining an error', async () => {
  let fail = true;
  const loader = () => { if (fail) throw new Error('sync failure'); return Promise.resolve('retried'); };
  await act(async () => root.render(<Read query="a" loader={loader} />));
  expect(state).toMatchObject({ error: 'sync failure', loading: false });
  fail = false;
  await act(async () => state.reload());
  expect(state).toMatchObject({ data: 'retried', error: null, loading: false });
});

it('locks same-tick duplicate mutations, preserves failures and permits retry', async () => {
  const request = deferred<string>();
  let calls = 0;
  let first!: ReturnType<typeof mutation.run<string>>;
  let duplicate!: ReturnType<typeof mutation.run<string>>;
  await act(async () => root.render(<Write />));
  await act(async () => {
    first = mutation.run(() => { calls++; return request.promise; });
    duplicate = mutation.run(() => { calls++; return Promise.resolve('duplicate'); });
  });
  expect(calls).toBe(1);
  await expect(duplicate).resolves.toEqual({ ok: false });
  expect(mutation.busy).toBe(true);
  await act(async () => request.reject(new Error('not persisted')));
  await expect(first).resolves.toEqual({ ok: false });
  expect(mutation.error).toBe('not persisted');
  let retry;
  await act(async () => { retry = await mutation.run(() => Promise.resolve('saved')); });
  expect(retry).toEqual({ ok: true, value: 'saved' });
  expect(mutation).toMatchObject({ busy: false, error: null });
});

it('does not report mutation success to an unmounted flow', async () => {
  const request = deferred<string>();
  let result!: ReturnType<typeof mutation.run<string>>;
  await act(async () => root.render(<Write />));
  await act(async () => { result = mutation.run(() => request.promise); });
  await act(async () => root.render(null));
  await act(async () => request.resolve('saved elsewhere'));
  await expect(result).resolves.toEqual({ ok: false });
});
