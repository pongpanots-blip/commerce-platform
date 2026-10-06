import { useState } from 'react';
import { Button, Checkbox, ErrorText, Field, FormPanel, Icon, Input, Loading, Page, PageHeader, Panel, PanelHead, Span, TBody, TD, TH, THead, TR, Table, fmt } from '@cp/ui';
import { webhooks, events, TestWebhookResult } from '../../lib/api';
import { useAsync } from '../hooks';

export function Webhooks() {
  const { data, loading, error, reload } = useAsync(() => webhooks.list());
  const eventsState = useAsync(() => events.list());
  const catalog = eventsState.data?.items ?? [];

  const [form, setForm] = useState({ name: '', targetUrl: '', secret: '' });
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestWebhookResult>>({});

  function toggleEvent(type: string) {
    setSelectedEvents((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]);
  }

  async function submit() {
    if (!selectedEvents.length) {
      setFormError('Select at least 1 event');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await webhooks.create({
        name: form.name,
        targetUrl: form.targetUrl,
        eventTypes: selectedEvents,
        ...(form.secret ? { secret: form.secret } : {}),
      });
      setForm({ name: '', targetUrl: '', secret: '' });
      setSelectedEvents([]);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(id: string, active: boolean) {
    setBusyId(id);
    try {
      await webhooks.update(id, { active: !active });
      reload();
    } finally {
      setBusyId(null);
    }
  }

  async function test(id: string) {
    setBusyId(id);
    try {
      const result = await webhooks.test(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Webhooks"
        subtitle="Subscribe an endpoint to receive platform events as they happen."
      />

      {/* Create webhook form */}
      <div className="mb-6">
        <FormPanel
          title="Create a new webhook"
          icon="add_circle"
          description="Subscribe to events and receive HTTP notifications"
          cols={1}
          error={formError}
          submitLabel={submitting ? 'Creating…' : '+ Create webhook'}
          busy={submitting}
          onSubmit={submit}
        >
        <Field label="Name" hint="e.g., Order sync worker">
          <Input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g., Order sync worker"
          />
        </Field>
        <Field label="Target URL" hint="Your webhook receiver endpoint">
          <Input
            required
            type="url"
            value={form.targetUrl}
            onChange={(e) => setForm({ ...form, targetUrl: e.target.value })}
            placeholder="https://example.com/webhooks/josh"
          />
        </Field>
        <Field label="Secret (optional)" hint="For HMAC signature verification">
          <Input
            value={form.secret}
            onChange={(e) => setForm({ ...form, secret: e.target.value })}
            placeholder="for HMAC signature"
          />
        </Field>

        {/* Event selection */}
        <Span>
          <div>
            <label className="block text-xs font-medium text-on-surface mb-2">Events</label>
            <div className="space-y-2">
              {catalog.map((ev) => (
                <label key={ev.type} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(ev.type)}
                    onChange={() => toggleEvent(ev.type)}
                    className="w-4 h-4"
                  />
                  <span className="text-xs text-on-surface font-mono">{ev.type}</span>
                  <span className="text-[11px] text-on-surface-variant">— {ev.description}</span>
                </label>
              ))}
            </div>
          </div>
        </Span>
        </FormPanel>
      </div>

      {/* Webhooks table */}
      <Panel>
        <PanelHead title="Your Webhooks" />
        {error ? (
          <ErrorText error={error} />
        ) : loading ? (
          <Loading />
        ) : !data?.length ? (
          <div className="p-6"><p className="text-xs text-on-surface-variant">No webhooks yet. Create one to get started.</p></div>
        ) : (
          <Table>
            <THead>
                <TH>Name</TH>
                <TH>Target URL</TH>
                <TH>Events</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </THead>
            <TBody>
              {data.map((w) => (
                <TR key={w.id}>
                  <TD>
                    <span className="font-medium text-on-surface">{w.name}</span>
                  </TD>
                  <TD>
                    <code className="font-mono text-xs text-on-surface-variant truncate">{w.targetUrl}</code>
                  </TD>
                  <TD>
                    <div className="text-xs text-on-surface-variant">
                      {w.eventTypes.length} event{w.eventTypes.length !== 1 ? 's' : ''}
                    </div>
                  </TD>
                  <TD>
                    <label className="inline-flex items-center gap-2 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={w.active}
                        disabled={busyId === w.id}
                        onChange={() => toggleActive(w.id, w.active)}
                        className="w-4 h-4"
                      />
                      <span className="text-on-surface-variant">
                        {w.active ? 'Active' : 'Inactive'}
                      </span>
                    </label>
                  </TD>
                  <TD className="text-right">
                    <button
                      className="text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
                      disabled={busyId === w.id}
                      onClick={() => test(w.id)}
                    >
                      {busyId === w.id ? '…' : 'Test'}
                    </button>
                    {testResults[w.id] && (
                      <div className="text-[11px] mt-1">
                        {testResults[w.id].ok ? (
                          <span className="text-primary font-medium">✓ OK · {testResults[w.id].status}</span>
                        ) : (
                          <span className="text-error font-medium">
                            ✗ Failed {testResults[w.id].status ? `· ${testResults[w.id].status}` : ''}
                            {testResults[w.id].error ? ` · ${testResults[w.id].error}` : ''}
                          </span>
                        )}
                      </div>
                    )}
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
