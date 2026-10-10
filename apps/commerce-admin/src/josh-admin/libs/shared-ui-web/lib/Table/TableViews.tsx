import { useState } from 'react';
import { uiText, useUiLocale } from '@cp/ui';
import { session } from '../../../../../lib/auth';
import type { TableColumn } from './Table';

export type TableView<S> = { name: string; state: Partial<S>; hidden: string[] };

// ponytail: localStorage, so views are per user per browser; move to a table if teams want shared views.
const keyFor = (page: string) => `cp-views:${encodeURIComponent(session.claims()?.sub ?? 'anon')}:${page}`;
function read<T>(key: string, valid: (v: unknown) => v is T, fallback: T): T {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: lives for this page only */ }
}
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isViews = <S,>(v: unknown): v is TableView<S>[] =>
  Array.isArray(v) && v.every((x) => x && typeof x.name === 'string' && typeof x.state === 'object' && isStrings(x.hidden));

/**
 * Named views (filters + sort + hidden columns) and the current column choice for one list page.
 * `current` is what a view saves; `apply` puts a saved state back (keys missing from old views are absent).
 */
export function useTableViews<S extends Record<string, unknown>>(page: string, current: S, apply: (state: Partial<S>) => void) {
  const key = keyFor(page);
  const [views, setViews] = useState<TableView<S>[]>(() => read(`${key}:views`, isViews<S>, []));
  const [hidden, setHiddenState] = useState<string[]>(() => read(`${key}:hidden`, isStrings, []));
  const [active, setActive] = useState('');
  const setHidden = (next: string[]) => { setHiddenState(next); write(`${key}:hidden`, next); };
  const persist = (next: TableView<S>[]) => { setViews(next); write(`${key}:views`, next); };
  return {
    views, active, hidden, setHidden,
    save(name: string) {
      persist([...views.filter((v) => v.name !== name), { name, state: current, hidden }]);
      setActive(name);
    },
    use(name: string) {
      const view = views.find((v) => v.name === name);
      setActive(view ? name : '');
      if (!view) return;
      apply(view.state);
      setHidden(view.hidden);
    },
    remove(name: string) {
      persist(views.filter((v) => v.name !== name));
      if (active === name) setActive('');
    },
  };
}
export type TableViewsState = ReturnType<typeof useTableViews<Record<string, unknown>>>;

/** Saved-view picker + save/delete + column chooser, placed above a josh `Table`. */
export function TableViewBar<T>({ views, columns }: { views: TableViewsState; columns: TableColumn<T>[] }) {
  useUiLocale();
  const shown = columns.filter((c) => !views.hidden.includes(c.key));
  const toggle = (key: string) =>
    views.setHidden(views.hidden.includes(key) ? views.hidden.filter((k) => k !== key) : [...views.hidden, key]);
  const save = () => {
    const name = window.prompt(uiText('ตั้งชื่อมุมมองนี้'), views.active)?.trim();
    if (name) views.save(name.slice(0, 60));
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select
        aria-label={uiText('มุมมองที่บันทึกไว้')}
        className="rounded-lg border border-secondary-container bg-surface-container-lowest px-2 py-1.5"
        value={views.active}
        onChange={(e) => views.use(e.target.value)}
      >
        <option value="">{uiText('มุมมองที่บันทึกไว้')}</option>
        {views.views.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
      </select>
      <button type="button" className="rounded-lg border border-secondary-container px-2.5 py-1.5" onClick={save}>
        {uiText('บันทึกมุมมอง')}
      </button>
      {views.active && (
        <button
          type="button"
          className="rounded-lg border border-secondary-container px-2.5 py-1.5"
          onClick={() => { if (window.confirm(uiText('ลบมุมมอง "{0}"?', { 0: views.active }))) views.remove(views.active); }}
        >
          {uiText('ลบมุมมอง')}
        </button>
      )}
      <details className="relative">
        <summary className="cursor-pointer list-none rounded-lg border border-secondary-container px-2.5 py-1.5">
          {uiText('คอลัมน์')} ({shown.length}/{columns.length})
        </summary>
        <div className="absolute right-0 z-20 mt-1 max-h-80 w-56 overflow-auto rounded-lg border border-secondary-container bg-surface-container-lowest p-2 shadow-lg">
          {columns.map((c) => {
            const on = !views.hidden.includes(c.key);
            return (
              <label key={c.key} className="flex items-center gap-2 py-1">
                {/* Keep at least one column. */}
                <input type="checkbox" checked={on} disabled={on && shown.length === 1} onChange={() => toggle(c.key)} />
                {uiText(c.label) || c.key}
              </label>
            );
          })}
        </div>
      </details>
    </div>
  );
}
