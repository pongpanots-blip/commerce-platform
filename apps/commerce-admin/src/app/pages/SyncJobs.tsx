import { useState } from 'react';
import { Button, Empty, ErrorText, Field, FormPanel, Loading, Page, PageHeader, Panel, PanelHead, Select, StatusChip, TBody, TD, TH, THead, TR, Table, fmt } from '@cp/ui';
import { api, Integration, SyncJob } from '../../lib/api';
import { useAsync } from '../hooks';

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
          <Button icon="refresh" variant="secondary" onClick={jobs.reload}>{__uiText("Refresh")}</Button>
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
        <Field label={__uiText("Integration")}>
          <Select required value={integrationId} onChange={(e) => setIntegrationId(e.target.value)}>
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
        {jobs.loading && !jobs.data ? (
          <Loading />
        ) : !jobs.data?.length ? (
          <Empty icon="sync">{__uiText("ยังไม่มีงานซิงก์ กดปุ่ม “เริ่มซิงก์ข้อมูล” เพื่อเริ่มงานแรก")}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText("Started")}</TH>
              <TH>{__uiText("Operation")}</TH>
              <TH>{__uiText("Status")}</TH>
              <TH>{__uiText("Result")}</TH>
            </THead>
            <TBody>
              {jobs.data.map((j) => (
                <TR key={j.id}>
                  <TD kind="time">{fmt.when(j.createdAt)}</TD>
                  <TD>{operationLabel(j.operation)}</TD>
                  <TD><StatusChip status={j.status} /></TD>
                  <TD kind="mono">{j.result ? JSON.stringify(j.result) : '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </Page>
  );
}
