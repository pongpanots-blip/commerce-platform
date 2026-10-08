// ui-caption-migration: literal captions only
import { useState } from 'react';
import { Alert, Button, ButtonLink, EmptyState, ErrorText, Field, FormPanel, Input, Loading, Modal, Page, PageHeader, Panel, PanelHead, Pager, Select, Textarea, TBody, TD, TH, THead, TR, Table, toast } from '@cp/ui';
import { api, Paginated } from '../../lib/api';
import { useAsync } from '../hooks';
import { CurrentPageFilters, useCurrentPageFilter } from './CurrentPageFilters';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export interface Column<T> {
  label: string;
  render: (row: T) => React.ReactNode;
}

export interface Field {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  type?: 'email' | 'tel' | 'textarea';
  hint?: string;
}

interface Props<T> {
  title: string;
  subtitle: string;
  endpoint: string;
  columns: Column<T>[];
  fields: Field[];
  createLabel: string;
  readOnly?: boolean;
  searchText: (row: T) => string;
  searchPlaceholder: string;
}

export function ResourcePage<T extends { id: string; status: string }>(props: Props<T>) {
  __useUiLocale();
  const { title, subtitle, endpoint, columns, fields, createLabel, readOnly } = props;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync(
    () => api.get<Paginated<T>>(`${endpoint}?page=${page}&pageSize=${pageSize}`),
    [page, pageSize, endpoint],
  );

  const [form, setForm] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit() {
    const nextErrors: Record<string, string> = {};
    for (const f of fields) {
      if (f.required && !form[f.name]?.trim()) nextErrors[f.name] = __uiMessage('กรอก{0} ตัวอย่าง: {1}', { 0: f.label, 1: f.placeholder || f.label });
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const payload: Record<string, string> = {};
      for (const f of fields) {
        if (form[f.name]) payload[f.name] = form[f.name];
      }
      const saved = await api.post<T>(endpoint, payload);
      setForm({});
      setFieldErrors({});
      setCreating(false);
      setCreated(saved.id);
      toast(__uiMessage('บันทึกแล้ว'), { label: __uiText('เปิดรายการที่เพิ่งบันทึก'), href: `${endpoint}/${saved.id}` });
      if (page !== 1) setPage(1);
      else reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const total = data?.total ?? 0;
  const filter = useCurrentPageFilter(data?.items ?? [], props.searchText, row => row.status);

  return (
    <Page>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={<><Button icon="refresh" variant="secondary" onClick={reload}>{__uiText("รีเฟรช")}</Button>{!readOnly && <Button variant="primary" icon="add" onClick={() => { setCreating(true); setCreated(null); }}>{createLabel}</Button>}</>}
      />

      {created && <Alert tone="ok" onClose={() => setCreated(null)} actions={<ButtonLink to={`${endpoint}/${created}`}>{__uiText("ดูรายการที่เพิ่ม")}</ButtonLink>}>{__uiText("เพิ่มรายการเรียบร้อยแล้ว")}</Alert>}
      {!readOnly && creating && <Modal title={createLabel} onClose={() => { if (!submitting) setCreating(false); }} width={640}><FormPanel
        title={__uiText("ข้อมูลรายการใหม่")}
        icon="add_circle"
        cols={2}
        error={formError}
        submitLabel={createLabel}
        busy={submitting}
        onSubmit={handleSubmit}
        onCancel={() => setCreating(false)}
      >
        {fields.map((f) => (
          <Field key={f.name} label={f.label} required={f.required} error={fieldErrors[f.name]} hint={f.hint ?? __uiText('ตัวอย่าง: {0}', { 0: f.placeholder || '—' })} className={f.type === 'textarea' ? 'md:col-span-2' : undefined}>
            {f.options ? (
              <Select value={form[f.name] ?? ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}>
                <option value="">{__uiText('เลือก')}</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            ) : f.type === 'textarea' ? <Textarea rows={3} placeholder={f.placeholder} value={form[f.name] ?? ''} onChange={event => setForm({ ...form, [f.name]: event.target.value })} /> : (
              <Input
                type={f.type ?? 'text'}
                placeholder={f.placeholder}
                value={form[f.name] ?? ''}
                onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
              />
            )}
          </Field>
        ))}
      </FormPanel></Modal>}

      <Panel>
        <PanelHead title={__uiText("รายการทั้งหมด")} sub={__uiText("{0} รายการ",{'0':total.toLocaleString()})} actions={<label className="flex items-center gap-2 whitespace-nowrap text-xs text-on-surface-variant">{__uiText("ต่อหน้า")}<Select aria-label={__uiText("จำนวนรายการต่อหน้า")} value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }} className="w-20">{[10, 20, 50].map(size => <option key={size} value={size}>{size}</option>)}</Select></label>} />
        <CurrentPageFilters filter={filter} placeholder={props.searchPlaceholder} loading={loading} />
        <ErrorText error={error} />
        {loading && !data ? (
          <Loading />
        ) : error && !data ? null : !data?.items.length ? (
          <EmptyState
            title={__uiText('ยังไม่มีรายการ')}
            description={readOnly ? __uiText('เมื่อมีข้อมูล รายการจะแสดงที่นี่') : __uiText('เริ่มด้วยการเพิ่มรายการแรก')}
            action={!readOnly && <Button variant="primary" icon="add" onClick={() => { setCreating(true); setCreated(null); }}>{createLabel}</Button>}
          />
        ) : (
          <>
            {filter.visible.length ? <Table>
              <THead>
                {columns.map((c) => (
                  <TH key={c.label}>{c.label}</TH>
                ))}
              </THead>
              <TBody>
                {filter.visible.map((row) => (
                  <TR key={row.id}>
                    {columns.map((c) => (
                      <TD key={c.label}>{c.render(row)}</TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table> : <EmptyState icon="search_off" title={__uiText('ไม่พบรายการในหน้านี้')} description={__uiText('ล้างตัวกรองเพื่อดูรายการทั้งหมดในหน้านี้ หรือเปิดหน้าถัดไป')} action={<Button icon="filter_alt_off" onClick={filter.clear}>{__uiText('ล้างตัวกรอง')}</Button>} />}
            <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
          </>
        )}
      </Panel>
    </Page>
  );
}
