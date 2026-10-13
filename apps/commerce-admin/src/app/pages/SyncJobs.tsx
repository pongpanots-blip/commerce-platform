import { useState } from 'react';
import { Button, Empty, ErrorText, Field, FormPanel, Input, Loading, Page, PageHeader, Panel, PanelHead, Select, StatusChip, statusLabel, TBody, TD, TH, THead, TR, Table, fmt } from '@cp/ui';
import { api, Integration, SyncJob } from '../../lib/api';
import { useAsync } from '../hooks';
import { commerceText as text } from '../commerce-copy';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const OPERATIONS = ['customers', 'products', 'inventory', 'prices'] as const;
/** What each sync operation copies, in staff words. Request values stay the raw operation code. */
export const OPERATION_LABEL: Record<string, string> = {
  customers: 'ซิงก์ลูกค้า',
  products: 'ซิงก์สินค้า',
  inventory: 'ซิงก์สต็อก',
  prices: 'ซิงก์ราคา',
};
export const operationLabel = (op: string) => (OPERATION_LABEL[op] ? __uiText(OPERATION_LABEL[op]) : op);

export function SyncJobs() {
  __useUiLocale();
  const jobs = useAsync(() => api.get<SyncJob[]>('/sync-jobs'));
  const integrations = useAsync(() => api.get<Integration[]>('/integrations'));
  const [integrationId, setIntegrationId] = useState('');
  const [operation, setOperation] = useState<(typeof OPERATIONS)[number]>('customers');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const term = search.trim().toLocaleLowerCase();
  const filtered = (jobs.data ?? []).filter(job => (!status || job.status === status) &&
    [job.id, job.integrationId, job.operation, operationLabel(job.operation), job.error ?? '', JSON.stringify(job.result ?? '')]
      .some(value => value.toLocaleLowerCase().includes(term)));

  async function trigger(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/sync-jobs', { integrationId, operation });
      setShowForm(false);
      setTimeout(() => jobs.reload(), 600);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title={__uiText("งานซิงก์ข้อมูล")}
        subtitle={__uiText("งานซิงก์ข้อมูลกับระบบภายนอกและผลลัพธ์")}
        actions={<>
          <Button icon="refresh" variant="secondary" onClick={jobs.reload} disabled={jobs.loading}>{__uiText("Refresh")}</Button>
          <Button icon="add" variant="primary" onClick={() => setShowForm(true)} disabled={showForm}>{__uiText("เริ่มซิงก์ข้อมูล")}</Button>
        </>}
      />

      {showForm && <FormPanel
        title={__uiText("Trigger a sync")}
        icon="sync"
        cols={2}
        error={formError}
        submitLabel={__uiText("Run sync")}
        busy={busy}
        onSubmit={trigger}
        onCancel={() => setShowForm(false)}
      >
        <ErrorText error={integrations.error} onRetry={integrations.reload} />
        <Field label={__uiText("Integration")}>
          <Select required disabled={integrations.loading || !!integrations.error} value={integrationId} onChange={(e) => setIntegrationId(e.target.value)}>
            <option value="">{__uiText("Select…")}</option>
            {integrations.data?.map((i) => (
              <option key={i.id} value={i.id}>{i.name} ({i.type})</option>
            ))}
          </Select>
        </Field>
        <Field label={__uiText("Operation")}>
          <Select value={operation} onChange={(e) => setOperation(e.target.value as typeof operation)}>
            {OPERATIONS.map((o) => (
              <option key={o} value={o}>{operationLabel(o)}</option>
            ))}
          </Select>
        </Field>
      </FormPanel>}

      <Panel>
        <PanelHead title={__uiText("Job history")} />
        <div className="flex flex-wrap items-end gap-3 px-5 py-3">
          <Field label={text('ค้นหางานซิงก์', 'Find sync jobs')} className="min-w-0 w-full sm:w-80">
            <Input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={text('ค้นหารหัสงาน ชนิดงาน หรือผลลัพธ์', 'Search job ID, operation or result')} />
          </Field>
          <Field label={__uiText('Status')}>
            <Select value={status} onChange={event => setStatus(event.target.value)}>
              <option value="">{__uiText('ทั้งหมด')}</option>
              {['pending', 'running', 'completed', 'failed'].map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}
            </Select>
          </Field>
          {(search || status) && <Button variant="secondary" onClick={() => { setSearch(''); setStatus(''); }}>{text('ล้างตัวกรอง', 'Clear filters')}</Button>}
        </div>
        <ErrorText error={jobs.error} onRetry={jobs.reload} />
        {jobs.loading && !jobs.data ? (
          <Loading />
        ) : jobs.error && !jobs.data ? null : !jobs.data?.length ? (
          <Empty icon="sync">{__uiText("ยังไม่มีงานซิงก์ กดปุ่ม “เริ่มซิงก์ข้อมูล” เพื่อเริ่มงานแรก")}</Empty>
        ) : !filtered.length ? (
          <Empty icon="search_off">{text('ไม่พบงานที่ตรงกับตัวกรอง ลองล้างตัวกรอง', 'No jobs match these filters. Try clearing the filters.')}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText("Started")}</TH>
              <TH>{__uiText("Operation")}</TH>
              <TH>{__uiText("Status")}</TH>
              <TH>{__uiText("Result")}</TH>
            </THead>
            <TBody>
              {filtered.map((j) => (
                <TR key={j.id}>
                  <TD kind="time">{fmt.when(j.createdAt)}</TD>
                  <TD>{operationLabel(j.operation)}</TD>
                  <TD><StatusChip status={j.status} /></TD>
                  <TD kind="mono">{j.error ? <span className="text-danger">{j.error}</span> : j.result != null ? JSON.stringify(j.result) : '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </Page>
  );
}
