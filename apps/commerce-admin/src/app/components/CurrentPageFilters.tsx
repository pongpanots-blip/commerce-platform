import { useState } from 'react';
import { Button, Field, FilterBar, SearchInput, Select, statusLabel } from '@cp/ui';

/** These APIs paginate records but do not support a server-side text query. */
// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function useCurrentPageFilter<T>(rows: T[], searchText: (row: T) => string, statusText: (row: T) => string) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const normalized = query.trim().toLocaleLowerCase();
  const visible = rows.filter(row => (!normalized || searchText(row).toLocaleLowerCase().includes(normalized)) && (!status || statusText(row) === status));
  const statuses = [...new Set([...rows.map(statusText), status].filter(Boolean))].sort();
  return { query, setQuery, status, setStatus, visible, statuses, loaded: rows.length, filtered: Boolean(normalized || status), clear: () => { setQuery(''); setStatus(''); } };
}

export function CurrentPageFilters({ filter, placeholder, loading }: {
  filter: ReturnType<typeof useCurrentPageFilter>;
  placeholder: string;
  loading: boolean;
}) {
  __useUiLocale();
  return <FilterBar hint={loading ? __uiText("กำลังโหลดข้อมูล…") : __uiText("แสดง {0} จาก {1} รายการในหน้านี้ · ค้นหาและกรองเฉพาะหน้าที่เปิดอยู่", {"0": filter.visible.length.toLocaleString(), "1": filter.loaded.toLocaleString()})}>
      <Field label={__uiText("ค้นหาในหน้านี้")} hint={__uiText("พิมพ์ชื่อหรือรหัสที่เห็นในตารางนี้")} className="min-w-0 w-full sm:w-80">
        <SearchInput value={filter.query} placeholder={placeholder} onChange={event => filter.setQuery(event.target.value)} disabled={loading} />
      </Field>
      <Field label={__uiText("สถานะในหน้านี้")} hint={__uiText("แสดงเฉพาะสถานะที่อยู่ในหน้านี้")} className="w-full sm:w-48">
        <Select value={filter.status} onChange={event => filter.setStatus(event.target.value)} disabled={loading}>
          <option value="">{__uiText("ทุกสถานะ")}</option>
          {filter.statuses.map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}
        </Select>
      </Field>
      {filter.filtered && <Button icon="filter_alt_off" onClick={filter.clear}>{__uiText("ล้างตัวกรอง")}</Button>}
    </FilterBar>;
}
