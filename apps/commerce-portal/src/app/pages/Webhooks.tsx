import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Checkbox, ErrorText, Field, FormPanel, Icon, Input, Loading, Modal, Page, PageHeader, Panel, PanelHead, Span, TBody, TD, TH, THead, TR, Table, fmt } from '@cp/ui';
import { webhooks, events, TestWebhookResult } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function Webhooks() {
  __useUiLocale();
  const { data, loading, error, reload } = useAsync(() => webhooks.list());
  const eventsState = useAsync(() => events.list());
  const catalog = eventsState.data?.items ?? [];

  const [form, setForm] = useState({ name: '', targetUrl: '', secret: '' });
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestWebhookResult>>({});
  const [search, setSearch] = useSearchParams();
  const creating = search.get('create') === '1';
  function closeCreate() { const next = new URLSearchParams(search); next.delete('create'); setSearch(next, { replace: true }); }

  function toggleEvent(type: string) {
    setSelectedEvents((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]);
  }

  async function submit() {
    if (!selectedEvents.length) {
      setFormError(__uiMessage("Select at least 1 event"));
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
      closeCreate();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(id: string, active: boolean) {
    setBusyId(id);
    setActionError(null);
    try {
      await webhooks.update(id, { active: !active });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function test(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      const result = await webhooks.test(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Page>
      <PageHeader
        title={__uiText("Webhooks")}
        subtitle={__uiText("Subscribe an endpoint to receive platform events as they happen.")}
        actions={<Button variant="primary" icon="add" onClick={() => setSearch({ create: '1' })}>{__uiText("Create webhook")}</Button>}
      />

      {/* Create webhook form */}
      {creating && <Modal title={__uiText("Create webhook")} onClose={() => { if (!submitting) closeCreate(); }} width={640}>
        <FormPanel
          title={__uiText("Create a new webhook")}
          icon="add_circle"
          description={__uiText("Subscribe to events and receive HTTP notifications")}
          cols={1}
          error={formError}
          submitLabel={submitting ? __uiText("Creating…") : __uiText("+ Create webhook")}
          busy={submitting}
          onSubmit={submit}
          onCancel={closeCreate}
        >
        <Field label={__uiText("Name")} hint={__uiText("e.g., Order sync worker")}>
          <Input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={__uiText("e.g., Order sync worker")}
          />
        </Field>
        <Field label={__uiText("Target URL")} hint={__uiText("Your webhook receiver endpoint")}>
          <Input
            required
            type="url"
            value={form.targetUrl}
            onChange={(e) => setForm({ ...form, targetUrl: e.target.value })}
            placeholder="https://example.com/webhooks/josh"
          />
        </Field>
        <Field label={__uiText("Secret (optional)")} hint={__uiText("For HMAC signature verification")}>
          <Input
            value={form.secret}
            onChange={(e) => setForm({ ...form, secret: e.target.value })}
            placeholder={__uiText("for HMAC signature")}
          />
        </Field>

        {/* Event selection */}
        <ErrorText error={eventsState.error} />
        <Span>
          <div>
            <label className="block text-xs font-medium text-on-surface mb-2">{__uiText("Events")}</label>
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
      </Modal>}

      {/* Webhooks table */}
      <ErrorText error={actionError} />
      <Panel>
        <PanelHead title={__uiText("Your Webhooks")} />
        {error ? (
          <ErrorText error={error} />
        ) : loading ? (
          <Loading />
        ) : !data?.length ? (
          <div className="p-6"><p className="text-xs text-on-surface-variant">{__uiText("No webhooks yet. Create one to get started.")}</p></div>
        ) : (
          <Table>
            <THead>
                <TH>{__uiText("Name")}</TH>
                <TH>{__uiText("Target URL")}</TH>
                <TH>{__uiText("Events")}</TH>
                <TH>{__uiText("Status")}</TH>
                <TH className="text-right">{__uiText("Actions")}</TH>
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
                      {__uiText(w.eventTypes.length === 1 ? '{0} event' : '{0} events', { '0': w.eventTypes.length })}
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
                        {w.active ? __uiText("Active") : __uiText("Inactive")}
                      </span>
                    </label>
                  </TD>
                  <TD className="text-right">
                    <button
                      className="text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
                      disabled={busyId === w.id}
                      onClick={() => test(w.id)}
                    >
                      {busyId === w.id ? '…' : __uiText("Test")}
                    </button>
                    {testResults[w.id] && (
                      <div className="text-[11px] mt-1">
                        {testResults[w.id].ok ? (
                          <span className="text-primary font-medium">{__uiText("✓ OK · ")}{testResults[w.id].status}</span>
                        ) : (
                          <span className="text-error font-medium">
                            {__uiText("✗ Failed ")}{testResults[w.id].status ? `· ${testResults[w.id].status}` : ''}
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
