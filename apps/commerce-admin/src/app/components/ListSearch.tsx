import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Field, FilterBar, SearchInput } from '@cp/ui';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, useUiLocale as __useUiLocale } from "@cp/ui";

/**
 * Server-side list search. The applied term lives in `?q=` so a link (e.g. from the ⌘K palette) can open a
 * filtered list; typing is debounced so each keystroke is not a request.
 */
export function useListSearch(delay = 300) {
  const [params, setParams] = useSearchParams();
  const applied = params.get('q') ?? '';
  const [text, setText] = useState(applied);
  // Follow the URL (back button, links) without eating a trailing space the user is still typing.
  useEffect(() => { setText(current => (current.trim() === applied ? current : applied)); }, [applied]);
  useEffect(() => {
    const next = text.trim();
    if (next === applied) return;
    const timer = setTimeout(() => setParams(current => {
      const updated = new URLSearchParams(current);
      if (next) updated.set('q', next); else updated.delete('q');
      return updated;
    }, { replace: true }), delay);
    return () => clearTimeout(timer);
  }, [text, applied, delay, setParams]);
  return { text, setText, applied, clear: () => setText('') };
}

/** Page number that falls back to 1 whenever the filter key (search, status…) changes. */
export function usePageFor(key: string) {
  const [state, setState] = useState({ key, page: 1 });
  return [state.key === key ? state.page : 1, (page: number) => setState({ key, page })] as const;
}

export function ListSearch({ search, label, placeholder, total, loading, children }: {
  search: ReturnType<typeof useListSearch>;
  label: string;
  placeholder: string;
  total: number | null;
  loading: boolean;
  children?: ReactNode;
}) {
  __useUiLocale();
  const hint = loading ? __uiText("กำลังโหลดข้อมูล…")
    : search.applied && total != null ? __uiText("พบ {0} รายการที่ตรงกับ “{1}”", { "0": total.toLocaleString(), "1": search.applied })
    : undefined;
  return <FilterBar hint={hint}>
      <Field label={label} className="min-w-0 w-full sm:w-80">
        <SearchInput value={search.text} placeholder={placeholder} onChange={event => search.setText(event.target.value)} />
      </Field>
      {children}
      {search.text && <Button icon="filter_alt_off" onClick={search.clear}>{__uiText("ล้างคำค้นหา")}</Button>}
    </FilterBar>;
}
