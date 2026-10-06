import { Fragment, useState } from 'react';
import { webhookApi, WebhookSubscription, EVENT_TYPES } from '../../lib/api';
import { useAsync } from '../hooks';
import { Page, PageHeader, Panel, PanelHead, Table, THead, TH, TBody, TR, TD, ExpandRow, ExpandToggle, Alert, Empty, Loading, StatusChip, fmt, FormPanel, Field, Checkbox, DetailSection, KeyValueGrid, Span, Button } from '@cp/ui';

export function WebhookPlatforms() {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: subscriptions, loading, error, reload } = useAsync(() => webhookApi.subscriptions(), []);

  function toggleEvent(eventType: string) {
    setSelectedEvents((cur) =>
      cur.includes(eventType) ? cur.filter((e) => e !== eventType) : [...cur, eventType],
    );
  }

  async function createSubscription() {
    if (!name.trim() || !targetUrl.trim() || selectedEvents.length === 0) return;
    setBusy('create');
    setActionError('');
    try {
      await webhookApi.createSubscription({
        name,
        targetUrl,
        eventTypes: selectedEvents,
        description: description || undefined,
      });
      setName('');
      setTargetUrl('');
      setSelectedEvents([]);
      setDescription('');
      setShowForm(false);
      setMessage('Subscription created');
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function toggleSubscription(id: string, active: boolean) {
    setBusy(`toggle-${id}`);
    setActionError('');
    try {
      await webhookApi.updateSubscription(id, { active: !active });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteSubscription(id: string) {
    if (!confirm('Delete this subscription?')) return;
    setBusy(`delete-${id}`);
    setActionError('');
    try {
      await webhookApi.deleteSubscription(id);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page>
      <PageHeader crumbs={['Webhooks', 'Platforms']} title="Webhook Platforms" subtitle="Manage webhook subscriptions and platform integrations." actions={<button className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1 px-3 py-1.5 text-xs border border-secondary-container bg-surface-container-lowest hover:bg-surface-container-low text-on-surface" onClick={reload}>Refresh</button>} />

      {message && <Alert tone="ok">{message}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {actionError && <Alert tone="danger">{actionError}</Alert>}

      {showForm && (
        <FormPanel
          title="New Webhook Subscription"
          icon="webhook"
          description="Configure a new webhook to receive platform events."
          cols={2}
          error={actionError || null}
          submitLabel="Create"
          busy={busy === 'create'}
          onSubmit={createSubscription}
          onCancel={() => setShowForm(false)}
        >
          <Field label="Name" hint="e.g., Production Webhook">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Subscription name" className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60" />
          </Field>
          <Field label="Target URL" hint="HTTPS endpoint to receive webhooks">
            <input type="url" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://your-server.com/webhooks" className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60" />
          </Field>
          <Field label="Description" hint="Optional notes">
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this webhook for?" className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60" />
          </Field>
          <Span>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant mb-2">Event Types</div>
            <div className="grid grid-cols-2 gap-2">
              {EVENT_TYPES.map((et) => (
                <Checkbox
                  key={et}
                  label={et}
                  checked={selectedEvents.includes(et)}
                  onChange={() => toggleEvent(et)}
                />
              ))}
            </div>
          </Span>
        </FormPanel>
      )}

      {!showForm && (
        <div className="mb-4">
          <Button variant="primary" icon="add" onClick={() => setShowForm(true)}>New Subscription</Button>
        </div>
      )}

      <Panel>
        <PanelHead title="Active Subscriptions" sub={subscriptions?.length ? `${subscriptions.length}` : ''} />
        {loading ? (
          <Loading />
        ) : !subscriptions?.length ? (
          <Empty>No webhook subscriptions configured.</Empty>
        ) : (
          <Table>
            <THead>
              <TH>Name</TH>
              <TH>Target URL</TH>
              <TH>Events</TH>
              <TH>Status</TH>
              <TH></TH>
            </THead>
            <TBody>
              {subscriptions.map((sub: WebhookSubscription) => (
                <Fragment key={sub.id}>
                  <TR>
                    <TD>{sub.name}</TD>
                    <TD kind="mono">{sub.targetUrl}</TD>
                    <TD>{sub.eventTypes.length} events</TD>
                    <TD><StatusChip status={sub.active ? 'active' : 'inactive'} /></TD>
                    <TD kind="actions"><ExpandToggle open={expandedId === sub.id} onClick={() => setExpandedId((cur) => (cur === sub.id ? null : sub.id))} /> <button className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1 px-3 py-1.5 text-xs border border-secondary-container bg-surface-container-lowest hover:bg-surface-container-low text-on-surface" disabled={busy === `toggle-${sub.id}`} onClick={() => toggleSubscription(sub.id, sub.active)}>{busy === `toggle-${sub.id}` ? '…' : sub.active ? 'Disable' : 'Enable'}</button> <button className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1 px-3 py-1.5 text-xs border border-secondary-container bg-surface-container-lowest hover:bg-surface-container-low text-on-surface" disabled={busy === `delete-${sub.id}`} onClick={() => deleteSubscription(sub.id)}>{busy === `delete-${sub.id}` ? '…' : 'Delete'}</button></TD>
                  </TR>
                  {expandedId === sub.id && (
                    <ExpandRow colSpan={5}>
                      <DetailSection title="Details">
                        <KeyValueGrid items={[
                          { label: 'Name', value: sub.name },
                          { label: 'Status', value: <StatusChip status={sub.active ? 'active' : 'inactive'} /> },
                          { label: 'Events', value: `${sub.eventTypes.length} subscriptions`, wide: true },
                          { label: 'Created', value: fmt.when(sub.createdAt) },
                        ]} />
                      </DetailSection>
                      {sub.description && (
                        <DetailSection title="Description">
                          <p className="text-xs text-on-surface">{sub.description}</p>
                        </DetailSection>
                      )}
                      <DetailSection title="Event Types">
                        <div className="text-xs text-on-surface-variant font-mono space-y-1">
                          {sub.eventTypes.map((et) => <div key={et}>{et}</div>)}
                        </div>
                      </DetailSection>
                    </ExpandRow>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </Page>
  );
}
