import { useState } from 'react';
import { Button, Chip, Empty, ErrorText, Field, FormPanel, Input, Loading, Page, PageHeader, Panel, PanelHead, Span, StatusChip, TBody, TD, TH, THead, TR, Table, TogglePill, fmt } from '@cp/ui';
import { api, EVENT_TYPES, webhookApi, WebhookDelivery, WebhookSubscription } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function Subscriptions() {
  __useUiLocale();
  const subs = useAsync(() => api.get<WebhookSubscription[]>('/webhook-subscriptions'));
  const deliveries = useAsync(() => api.get<WebhookDelivery[]>('/webhook-subscriptions/deliveries'));
  const [form, setForm] = useState({ name: '', targetUrl: '', secret: '', description: '' });
  const [events, setEvents] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function toggle(evt: string) {
    setEvents((cur) => (cur.includes(evt) ? cur.filter((e) => e !== evt) : [...cur, evt]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!events.length) {
      setFormError(__uiMessage("Choose at least one event to subscribe to."));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post('/webhook-subscriptions', {
        name: form.name,
        targetUrl: form.targetUrl,
        eventTypes: events,
        ...(form.secret ? { secret: form.secret } : {}),
        ...(form.description ? { description: form.description } : {}),
      });
      setForm({ name: '', targetUrl: '', secret: '', description: '' });
      setEvents([]);
      subs.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  /** Enable/disable or delete (was its own page, /erp/webhook-platforms). */
  async function act(key: string, run: () => Promise<unknown>) {
    setBusy(key);
    setActionError(null);
    try {
      await run();
      subs.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function remove(s: WebhookSubscription) {
    if (window.confirm(__uiText("Delete this subscription?"))) void act(`delete-${s.id}`, () => webhookApi.deleteSubscription(s.id));
  }

  function reloadAll() {
    subs.reload();
    deliveries.reload();
  }

  return (
    <Page>
      <PageHeader
        title={__uiText("Outgoing webhooks")}
        subtitle={__uiText("Notify external systems when platform events happen — they subscribe, we deliver (signed).")}
        actions={<Button icon="refresh" variant="secondary" onClick={reloadAll}>{__uiText("Refresh")}</Button>}
      />

      <FormPanel
        title={__uiText("New subscription")}
        icon="mail"
        cols={2}
        error={formError}
        submitLabel={__uiText("Create subscription")}
        busy={submitting}
        onSubmit={submit}
      >
        <Field label={__uiText("Name")}>
          <Input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={__uiText("e.g. Our e-commerce store")}
          />
        </Field>
        <Field label={__uiText("Target URL")}>
          <Input
            required
            value={form.targetUrl}
            onChange={(e) => setForm({ ...form, targetUrl: e.target.value })}
            placeholder="https://shop.example.com/hooks/platform"
          />
        </Field>
        <Field label={__uiText("Signing secret")}>
          <Input
            value={form.secret}
            onChange={(e) => setForm({ ...form, secret: e.target.value })}
            placeholder={__uiText("we HMAC-sign each delivery")}
          />
        </Field>
        <Field label={__uiText("Description")}>
          <Input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder={__uiText("optional notes")}
          />
        </Field>
        <Span>
          <div className="text-xs font-medium text-on-surface-variant mb-2">{__uiText("Events to send")}</div>
          <div className="flex flex-wrap gap-2">
            {EVENT_TYPES.map((evt) => (
              <TogglePill key={evt} on={events.includes(evt)} onClick={() => toggle(evt)}>
                {evt}
              </TogglePill>
            ))}
          </div>
        </Span>
      </FormPanel>

      <Panel>
        <PanelHead title={__uiText("Subscriptions")} />
        <ErrorText error={actionError} />
        {subs.loading && !subs.data ? (
          <Loading />
        ) : !subs.data?.length ? (
          <Empty>{__uiText("No subscriptions yet.")}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText("Name")}</TH>
              <TH>{__uiText("Target URL")}</TH>
              <TH>{__uiText("Events")}</TH>
              <TH>{__uiText("Secret")}</TH>
              <TH>{__uiText("Status")}</TH>
              <TH />
            </THead>
            <TBody>
              {subs.data.map((s) => (
                <TR key={s.id}>
                  <TD>{s.name}</TD>
                  <TD kind="mono">{s.targetUrl}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {s.eventTypes.map((e) => (
                        <Chip key={e} tone="muted">{e}</Chip>
                      ))}
                    </div>
                  </TD>
                  <TD>{s.secret ? <Chip tone="muted">{__uiText("set")}</Chip> : '—'}</TD>
                  <TD><StatusChip status={s.active ? 'active' : 'disabled'} /></TD>
                  <TD kind="actions">
                    <Button size="sm" disabled={busy !== null} onClick={() => void act(`toggle-${s.id}`, () => webhookApi.updateSubscription(s.id, { active: !s.active }))}>
                      {busy === `toggle-${s.id}` ? '…' : s.active ? __uiText("Disable") : __uiText("Enable")}
                    </Button>{' '}
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => remove(s)}>
                      {busy === `delete-${s.id}` ? '…' : __uiText("Delete")}
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      <Panel>
        <PanelHead title={__uiText("Delivery log")} actions={<Button variant="ghost" size="sm" onClick={deliveries.reload}>{__uiText("Reload")}</Button>} />
        {deliveries.loading && !deliveries.data ? (
          <Loading />
        ) : !deliveries.data?.length ? (
          <Empty>{__uiText("No deliveries yet — trigger an event (e.g. update a customer).")}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText("When")}</TH>
              <TH>{__uiText("Event")}</TH>
              <TH>{__uiText("Target")}</TH>
              <TH>{__uiText("Status")}</TH>
              <TH>{__uiText("HTTP")}</TH>
              <TH right>{__uiText("Tries")}</TH>
            </THead>
            <TBody>
              {deliveries.data.map((d) => (
                <TR key={d.id}>
                  <TD kind="time">{fmt.when(d.createdAt)}</TD>
                  <TD kind="mono">{d.eventType}</TD>
                  <TD kind="mono">{d.targetUrl}</TD>
                  <TD><StatusChip status={d.status} /></TD>
                  <TD>{d.statusCode ?? '—'}</TD>
                  <TD kind="num">{d.attempts}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </Page>
  );
}
