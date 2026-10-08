// ui-caption-migration: literal captions only
// ui-metadata-migration: static labels and UI notices only
import { Fragment, useState } from 'react';
import { webhookApi, WebhookSubscription, EVENT_TYPES } from '../../lib/api';
import { useAsync } from '../hooks';
import { Page, PageHeader, Panel, PanelHead, Table, THead, TH, TBody, TR, TD, ExpandRow, ExpandToggle, Alert, Empty, Loading, StatusChip, fmt, FormPanel, Field, Checkbox, DetailSection, KeyValueGrid, Span, Button } from '@cp/ui';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function WebhookPlatforms() {
  __useUiLocale();
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
    if (!confirm(__uiText("Delete this subscription?"))) return;
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
      <PageHeader title={__uiText("Webhook Platforms")} subtitle={__uiText("Manage webhook subscriptions and platform integrations.")} actions={<Button icon="refresh" onClick={reload}>{__uiText("Refresh")}</Button>} />

      {message && <Alert tone="ok">{message}</Alert>}
      {error && <Alert tone="danger">{(typeof error === 'string' ? __uiText(error) : error)}</Alert>}
      {actionError && <Alert tone="danger">{(typeof (actionError) === 'string' ? __uiText(actionError) : actionError)}</Alert>}

      {showForm && (
        <FormPanel
          title={__uiText("New Webhook Subscription")}
          icon="webhook"
          description={__uiText("Configure a new webhook to receive platform events.")}
          cols={2}
          error={actionError || null}
          submitLabel={__uiText("Create")}
          busy={busy === 'create'}
          onSubmit={createSubscription}
          onCancel={() => setShowForm(false)}
        >
          <Field label={__uiText("Name")} hint={__uiText("e.g., Production Webhook")}>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={__uiText("Subscription name")} className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60" />
          </Field>
          <Field label={__uiText("Target URL")} hint={__uiText("HTTPS endpoint to receive webhooks")}>
            <input type="url" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://your-server.com/webhooks" className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60" />
          </Field>
          <Field label={__uiText("Description")} hint={__uiText("Optional notes")}>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={__uiText("What is this webhook for?")} className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60" />
          </Field>
          <Span>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant mb-2">{__uiText("Event Types")}</div>
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
          <Button variant="primary" icon="add" onClick={() => setShowForm(true)}>{__uiText("New Subscription")}</Button>
        </div>
      )}

      <Panel>
        <PanelHead title={__uiText("Active Subscriptions")} sub={subscriptions?.length ? __uiText("{0}",{'0':subscriptions.length}) : ''} />
        {loading ? (
          <Loading />
        ) : !subscriptions?.length ? (
          <Empty>{__uiText("No webhook subscriptions configured.")}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText("Name")}</TH>
              <TH>{__uiText("Target URL")}</TH>
              <TH>{__uiText("Events")}</TH>
              <TH>{__uiText("Status")}</TH>
              <TH></TH>
            </THead>
            <TBody>
              {subscriptions.map((sub: WebhookSubscription) => (
                <Fragment key={sub.id}>
                  <TR>
                    <TD>{sub.name}</TD>
                    <TD kind="mono">{sub.targetUrl}</TD>
                    <TD>{sub.eventTypes.length} {__uiText(" events")}</TD>
                    <TD><StatusChip status={sub.active ? 'active' : 'inactive'} /></TD>
                    <TD kind="actions"><ExpandToggle open={expandedId === sub.id} onClick={() => setExpandedId((cur) => (cur === sub.id ? null : sub.id))} /> <Button disabled={busy === `toggle-${sub.id}`} onClick={() => toggleSubscription(sub.id, sub.active)}>{busy === `toggle-${sub.id}` ? '…' : sub.active ? __uiText("Disable") : __uiText("Enable")}</Button> <Button disabled={busy === `delete-${sub.id}`} onClick={() => deleteSubscription(sub.id)}>{busy === `delete-${sub.id}` ? '…' : __uiText("Delete")}</Button></TD>
                  </TR>
                  {expandedId === sub.id && (
                    <ExpandRow colSpan={5}>
                      <DetailSection title={__uiText("Details")}>
                        <KeyValueGrid items={[
                          { label: 'Name', value: sub.name },
                          { label: 'Status', value: <StatusChip status={sub.active ? 'active' : 'inactive'} /> },
                          { label: 'Events', value: `${sub.eventTypes.length} subscriptions`, wide: true },
                          { label: 'Created', value: fmt.when(sub.createdAt) },
                        ]} />
                      </DetailSection>
                      {sub.description && (
                        <DetailSection title={__uiText("Description")}>
                          <p className="text-xs text-on-surface">{sub.description}</p>
                        </DetailSection>
                      )}
                      <DetailSection title={__uiText("Event Types")}>
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

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data
