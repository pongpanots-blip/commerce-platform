import { useState } from 'react';
import { Button, Chip, Empty, ErrorText, Field, FormPanel, Input, Loading, Page, PageHeader, Panel, PanelHead, Span, StatusChip, TBody, TD, TH, THead, TR, Table, TogglePill, fmt } from '@cp/ui';
import { api, EVENT_TYPES, WebhookDelivery, WebhookSubscription } from '../../lib/api';
import { useAsync } from '../hooks';

export function Subscriptions() {
  const subs = useAsync(() => api.get<WebhookSubscription[]>('/webhook-subscriptions'));
  const deliveries = useAsync(() => api.get<WebhookDelivery[]>('/webhook-subscriptions/deliveries'));
  const [form, setForm] = useState({ name: '', targetUrl: '', secret: '', description: '' });
  const [events, setEvents] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function toggle(evt: string) {
    setEvents((cur) => (cur.includes(evt) ? cur.filter((e) => e !== evt) : [...cur, evt]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!events.length) {
      setFormError('Choose at least one event to subscribe to.');
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

  function reloadAll() {
    subs.reload();
    deliveries.reload();
  }

  return (
    <Page>
      <PageHeader
        crumbs={['Subscriptions']}
        title="Outgoing webhooks"
        subtitle="Notify external systems when platform events happen — they subscribe, we deliver (signed)."
        actions={<Button icon="refresh" variant="secondary" onClick={reloadAll}>Refresh</Button>}
      />

      <FormPanel
        title="New subscription"
        icon="mail"
        cols={2}
        error={formError}
        submitLabel="Create subscription"
        busy={submitting}
        onSubmit={submit}
      >
        <Field label="Name">
          <Input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Our e-commerce store"
          />
        </Field>
        <Field label="Target URL">
          <Input
            required
            value={form.targetUrl}
            onChange={(e) => setForm({ ...form, targetUrl: e.target.value })}
            placeholder="https://shop.example.com/hooks/platform"
          />
        </Field>
        <Field label="Signing secret">
          <Input
            value={form.secret}
            onChange={(e) => setForm({ ...form, secret: e.target.value })}
            placeholder="we HMAC-sign each delivery"
          />
        </Field>
        <Field label="Description">
          <Input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="optional notes"
          />
        </Field>
        <Span>
          <div className="text-xs font-medium text-on-surface-variant mb-2">Events to send</div>
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
        <PanelHead title="Subscriptions" />
        {subs.loading && !subs.data ? (
          <Loading />
        ) : !subs.data?.length ? (
          <Empty>No subscriptions yet.</Empty>
        ) : (
          <Table>
            <THead>
              <TH>Name</TH>
              <TH>Target URL</TH>
              <TH>Events</TH>
              <TH>Secret</TH>
              <TH>Status</TH>
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
                  <TD>{s.secret ? <Chip tone="muted">set</Chip> : '—'}</TD>
                  <TD><StatusChip status={s.active ? 'active' : 'disabled'} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      <Panel>
        <PanelHead title="Delivery log" actions={<Button variant="ghost" size="sm" onClick={deliveries.reload}>Reload</Button>} />
        {deliveries.loading && !deliveries.data ? (
          <Loading />
        ) : !deliveries.data?.length ? (
          <Empty>No deliveries yet — trigger an event (e.g. update a customer).</Empty>
        ) : (
          <Table>
            <THead>
              <TH>When</TH>
              <TH>Event</TH>
              <TH>Target</TH>
              <TH>Status</TH>
              <TH>HTTP</TH>
              <TH right>Tries</TH>
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
