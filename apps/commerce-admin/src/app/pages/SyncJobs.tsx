import { useState } from 'react';
import { Button, Empty, ErrorText, Field, FormPanel, Loading, Page, PageHeader, Panel, PanelHead, Select, StatusChip, TBody, TD, TH, THead, TR, Table, fmt } from '@cp/ui';
import { api, Integration, SyncJob } from '../../lib/api';
import { useAsync } from '../hooks';

const OPERATIONS = ['customers', 'products', 'inventory', 'prices'] as const;

export function SyncJobs() {
  const jobs = useAsync(() => api.get<SyncJob[]>('/sync-jobs'));
  const integrations = useAsync(() => api.get<Integration[]>('/integrations'));
  const [integrationId, setIntegrationId] = useState('');
  const [operation, setOperation] = useState<(typeof OPERATIONS)[number]>('customers');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function trigger(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/sync-jobs', { integrationId, operation });
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
        crumbs={['Sync jobs']}
        title="Sync jobs"
        subtitle="Run a connector sync operation and track its result."
        actions={<Button icon="refresh" variant="secondary" onClick={jobs.reload}>Refresh</Button>}
      />

      <FormPanel
        title="Trigger a sync"
        icon="sync"
        cols={2}
        error={formError}
        submitLabel="Run sync"
        busy={busy}
        onSubmit={trigger}
      >
        <Field label="Integration">
          <Select required value={integrationId} onChange={(e) => setIntegrationId(e.target.value)}>
            <option value="">Select…</option>
            {integrations.data?.map((i) => (
              <option key={i.id} value={i.id}>{i.name} ({i.type})</option>
            ))}
          </Select>
        </Field>
        <Field label="Operation">
          <Select value={operation} onChange={(e) => setOperation(e.target.value as typeof operation)}>
            {OPERATIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </Select>
        </Field>
      </FormPanel>

      <Panel>
        <PanelHead title="Job history" />
        {jobs.loading && !jobs.data ? (
          <Loading />
        ) : !jobs.data?.length ? (
          <Empty>No sync jobs yet.</Empty>
        ) : (
          <Table>
            <THead>
              <TH>Started</TH>
              <TH>Operation</TH>
              <TH>Status</TH>
              <TH>Result</TH>
            </THead>
            <TBody>
              {jobs.data.map((j) => (
                <TR key={j.id}>
                  <TD kind="time">{fmt.when(j.createdAt)}</TD>
                  <TD kind="mono">{j.operation}</TD>
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
