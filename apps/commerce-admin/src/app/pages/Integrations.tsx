import { useState } from 'react';
import { Button, Chip, CopyValue, Empty, ErrorText, Field, FormPanel, Input, Loading, Page, PageHeader, Panel, PanelHead, StatusChip, TBody, TD, TH, THead, TR, Table } from '@cp/ui';
import { api, Integration } from '../../lib/api';
import { useAsync } from '../hooks';

export function Integrations() {
  const { data, loading, error, reload } = useAsync(() => api.get<Integration[]>('/integrations'));
  const [form, setForm] = useState({ name: '', type: 'example', slug: '', signingSecret: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const webhookUrl = (i: Integration) => `${api.base}/webhooks/${i.slug ?? i.id}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post('/integrations', {
        name: form.name,
        type: form.type,
        ...(form.slug ? { slug: form.slug } : {}),
        ...(form.signingSecret ? { signingSecret: form.signingSecret } : {}),
      });
      setForm({ name: '', type: 'example', slug: '', signingSecret: '' });
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Integrations"
        subtitle="External systems connected to the platform."
        actions={<Button icon="refresh" variant="secondary" onClick={reload}>Refresh</Button>}
      />

      <FormPanel
        title="Connect an integration"
        icon="hub"
        cols={2}
        error={formError}
        submitLabel="Create integration"
        busy={submitting}
        onSubmit={submit}
      >
        <Field label="Name">
          <Input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Shopify Store"
          />
        </Field>
        <Field label="Type (connector)">
          <Input
            required
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            placeholder="example"
          />
        </Field>
        <Field label="Webhook slug">
          <Input
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            placeholder="auto from type"
          />
        </Field>
        <Field label="Signing secret">
          <Input
            value={form.signingSecret}
            onChange={(e) => setForm({ ...form, signingSecret: e.target.value })}
            placeholder="for webhook HMAC"
          />
        </Field>
      </FormPanel>

      <Panel>
        <PanelHead title="All integrations" />
        <ErrorText error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.length ? (
          <Empty>No integrations yet.</Empty>
        ) : (
          <Table>
            <THead>
              <TH>Name</TH>
              <TH>Type</TH>
              <TH>Status</TH>
              <TH>Secret</TH>
              <TH>Webhook URL</TH>
            </THead>
            <TBody>
              {data.map((i) => (
                <TR key={i.id}>
                  <TD>{i.name}</TD>
                  <TD kind="mono">{i.type}</TD>
                  <TD><StatusChip status={i.status} /></TD>
                  <TD>{i.signingSecret ? <Chip tone="muted">set</Chip> : '—'}</TD>
                  <TD>
                    <CopyValue value={webhookUrl(i)} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </Page>
  );
}
