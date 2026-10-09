// ui-caption-migration: literal captions only
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, ButtonLink, EmptyState, ErrorText, Hint, TaskPanelForm, TaskInput, Loading, Modal, Page, PageHeader, Panel, PanelHead, Pager, Select, TaskSelect, TaskTextarea, useUnsavedChanges, TBody, TD, TH, THead, TR, Table, toast } from '@cp/ui';
import { api, Paginated } from '../../lib/api';
import { useAsync } from '../hooks';
import { InterruptedAction, requireSaved, taskMessages, useActionDraft, writeFailure } from '../task-forms';
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
  saveLabel?: string;
  readOnly?: boolean;
  searchText: (row: T) => string;
  searchPlaceholder: string;
}

export function ResourcePage<T extends { id: string; status: string }>(props: Props<T>) {
  __useUiLocale();
  const { title, subtitle, endpoint, columns, fields, createLabel, saveLabel = createLabel, readOnly } = props;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const location = useLocation();
  const navigate = useNavigate();
  const creating = location.pathname === `${endpoint}/new`;
  const draft = useActionDraft(`create:${endpoint}`, Object.fromEntries(fields.map(field => [field.name, ''])));
  const form = draft.values;
  useUnsavedChanges(creating && (draft.dirty || draft.pending));
  const open = () => { setCreated(null); navigate(`${endpoint}/new${location.search}${location.hash}`); };
  const close = () => { if (!draft.pending) navigate(`${endpoint}${location.search}${location.hash}`); };
  const [created, setCreated] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync(
    () => api.get<Paginated<T>>(`${endpoint}?page=${page}&pageSize=${pageSize}`),
    [page, pageSize, endpoint],
  );

  function validate() {
    const errors: Record<string, string> = {};
    for (const f of fields) {
      if (f.required && !form[f.name]?.trim()) errors[f.name] = __uiMessage('กรอก{0} ตัวอย่าง: {1}', { 0: f.label, 1: f.placeholder ? __uiText(f.placeholder) : f.label });
      if (form[f.name] && f.options && !f.options.includes(form[f.name])) errors[f.name] = __uiText('เลือกค่าที่รองรับ');
    }
    return errors;
  }
  async function handleSubmit(_data: FormData, signal: AbortSignal) {
    if (readOnly || !draft.begin(signal)) return { ok: false as const, formError: __uiText('ยังยืนยันผลการบันทึกไม่ได้') };
    try {
      const payload: Record<string, string> = {};
      for (const f of fields) if (form[f.name]) payload[f.name] = form[f.name];
      const saved = requireSaved(await api.post<T>(endpoint, payload), row => typeof row.id === 'string' && !!row.id.trim());
      return { ok: true as const, receipt: saved };
    } catch (error) { if (!signal.aborted) draft.fail(error); return writeFailure(error); }
    finally { draft.settle(); }
  }
  function saved(row: T) {
    draft.clear(); setCreated(row.id);
    navigate(`${endpoint}${location.search}${location.hash}`);
    toast(__uiMessage('บันทึกแล้ว'), { label: __uiText('เปิดรายการที่เพิ่งบันทึก'), href: `${endpoint}/${row.id}` });
    if (page !== 1) setPage(1); else reload();
  }
  async function checkLatest() {
    const latest = await api.get<Paginated<T>>(`${endpoint}?page=1&pageSize=20`);
    if (!Array.isArray(latest.items) || !Number.isFinite(latest.total)) throw new Error(__uiText('ยังยืนยันผลการบันทึกไม่ได้'));
    reload();
    return __uiText('โหลดรายการล่าสุดแล้ว {0} รายการ ตรวจชื่อหรือรหัสและหน้าถัดไปก่อนลองใหม่', { 0: latest.total });
  }

  const total = data?.total ?? 0;
  const filter = useCurrentPageFilter(data?.items ?? [], props.searchText, row => row.status);

  return (
    <Page>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={<><Button icon="refresh" variant="secondary" onClick={reload}>{__uiText("รีเฟรช")}</Button>{!readOnly && <Button variant="primary" icon="add" onClick={open}>{createLabel}</Button>}</>}
      />

      {created && <Alert tone="ok" onClose={() => setCreated(null)} actions={<ButtonLink to={`${endpoint}/${created}`}>{__uiText("ดูรายการที่เพิ่ม")}</ButtonLink>}>{__uiText("เพิ่มรายการเรียบร้อยแล้ว")}</Alert>}
      {!readOnly && creating && <Modal title={createLabel} onClose={close} width={640}>
        {draft.recovered && !draft.interrupted && <Hint>{__uiText('กู้คืนข้อมูลที่ยังไม่บันทึกแล้ว ตรวจข้อมูลก่อนบันทึก')}</Hint>}
        {draft.interrupted && <InterruptedAction onCheck={checkLatest} onContinue={draft.acknowledge} outstanding={draft.outstanding} />}
        <TaskPanelForm title={__uiText('ข้อมูลรายการใหม่')} icon="add_circle" cols={2} messages={taskMessages()} validate={validate} submitLabel={saveLabel} disabled={draft.interrupted || draft.outstanding} onSubmit={handleSubmit} onSuccess={saved} onCancel={() => navigate(`${endpoint}${location.search}${location.hash}`)}>
        {fields.map(f => {
          const common = { key: f.name, name: f.name, label: f.label, required: f.required, help: f.hint ?? (f.placeholder ? __uiText('ตัวอย่าง: {0}', { 0: __uiText(f.placeholder) }) : undefined), value: form[f.name] ?? '', onChange: (event: { target: { value: string } }) => draft.set(current => ({ ...current, [f.name]: event.target.value })) };
          return f.options ? <TaskSelect {...common}><option value="">{__uiText('เลือก')}</option>{f.options.map(o => <option key={o} value={o}>{o}</option>)}</TaskSelect>
            : f.type === 'textarea' ? <TaskTextarea {...common} rows={3} fieldClassName="md:col-span-2" placeholder={f.placeholder ? __uiText(f.placeholder) : undefined} />
            : <TaskInput {...common} type={f.type ?? 'text'} placeholder={f.placeholder ? __uiText(f.placeholder) : undefined} />;
        })}
        </TaskPanelForm>
      </Modal>}

      <Panel>
        <PanelHead title={__uiText("รายการทั้งหมด")} sub={__uiText("{0} รายการ",{'0':total.toLocaleString()})} actions={<label className="flex items-center gap-2 whitespace-nowrap text-xs text-on-surface-variant">{__uiText("ต่อหน้า")}<Select aria-label={__uiText("จำนวนรายการต่อหน้า")} value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }} className="w-20">{[10, 20, 50].map(size => <option key={size} value={size}>{size}</option>)}</Select></label>} />
        <CurrentPageFilters filter={filter} placeholder={props.searchPlaceholder} loading={loading} />
        <ErrorText error={error} onRetry={reload} />
        {loading && !data ? (
          <Loading variant="table" />
        ) : error && !data ? null : !data?.items.length ? (
          <EmptyState
            title={__uiText('ยังไม่มีรายการ')}
            description={readOnly ? __uiText('เมื่อมีข้อมูล รายการจะแสดงที่นี่') : __uiText('เริ่มด้วยการเพิ่มรายการแรก')}
            action={!readOnly && <Button variant="primary" icon="add" onClick={open}>{createLabel}</Button>}
          />
        ) : (
          <>
            {filter.visible.length ? <Table scrollLabel={__uiText("รายการทั้งหมด")}>
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
