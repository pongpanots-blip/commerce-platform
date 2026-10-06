import { useState } from 'react';
import {
  ArrowLink, Chip, CodeBlock, ErrorText, Icon, Loading, Page, PageHeader, Panel, PanelHead,
  StatusChip, TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { keys, webhooks, deliveries, ApiKeyRow, WebhookRow, WebhookDelivery } from '../../lib/api';
import { useAsync } from '../hooks';

export function Dashboard() {
  const keysState = useAsync(() => keys.list());
  const webhooksState = useAsync(() => webhooks.list());
  const deliveriesState = useAsync(() => deliveries.recent(6));
  const [checklist, setChecklist] = useState(true);

  const keysList = keysState.data ?? [];
  const webhooksList = webhooksState.data ?? [];
  const deliveriesList = deliveriesState.data ?? [];

  const activeKeys = keysList.filter((k) => k.active);
  const activeWebhooks = webhooksList.filter((w) => w.active);
  const latestKey = keysList[0] ?? null;
  const successfulDeliveries = deliveriesList.filter((d) => d.status === 'success');
  const lastDelivery = deliveriesList[0];

  // Checklist items
  const hasKey = keysList.length > 0;
  const hasWebhook = webhooksList.length > 0;
  const hasSuccessfulDelivery = successfulDeliveries.length > 0;
  const completedItems = [hasKey, hasWebhook, hasSuccessfulDelivery].filter(Boolean).length;

  return (
    <Page>
      <PageHeader
        title="Dashboard"
        subtitle="Your API keys and webhook subscriptions at a glance."
      />

      {/* Getting started checklist */}
      {checklist && (
        <Panel className="mb-6 p-5">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-outline-variant/20">
            <div className="flex items-center gap-2.5">
              <Icon name="task_alt" className="text-primary" />
              <h2 className="font-headline font-semibold text-sm text-on-surface">Getting started checklist</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-surface-container-low text-primary font-medium num-tabular">
                {completedItems} of 3 completed
              </span>
            </div>
            <button
              className="text-on-surface-variant hover:text-on-surface p-1 rounded transition-colors"
              onClick={() => setChecklist(false)}
              title="Dismiss checklist"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Item 1: Create API key */}
            <div className={`flex items-start gap-3 p-3 rounded-lg border ${hasKey ? 'bg-surface-container-low/50 border-outline-variant/20' : 'bg-surface-container-lowest border-primary/40'}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${hasKey ? 'bg-primary text-on-primary' : 'border-2 border-primary text-primary text-[11px] font-semibold'}`}>
                {hasKey ? <Icon name="check" size={12} /> : '1'}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-medium ${hasKey ? 'text-on-surface line-through opacity-85' : 'text-on-surface font-semibold'}`}>
                  Create an API key
                </div>
                <p className="text-[11px] text-on-surface-variant mt-0.5">
                  {hasKey ? 'Active production key initialized' : 'Start by creating your first API key'}
                </p>
              </div>
              {hasKey && <span className="text-[10px] font-medium text-primary px-1.5 py-0.5 rounded bg-surface-container-lowest">Done</span>}
            </div>

            {/* Item 2: Subscribe to webhook */}
            <div className={`flex items-start gap-3 p-3 rounded-lg border ${hasWebhook ? 'bg-surface-container-low/50 border-outline-variant/20' : 'bg-surface-container-lowest border-primary/40'}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${hasWebhook ? 'bg-primary text-on-primary' : 'border-2 border-primary text-primary text-[11px] font-semibold'}`}>
                {hasWebhook ? <Icon name="check" size={12} /> : '2'}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-medium ${hasWebhook ? 'text-on-surface line-through opacity-85' : 'text-on-surface font-semibold'}`}>
                  Subscribe a webhook
                </div>
                <p className="text-[11px] text-on-surface-variant mt-0.5">
                  {hasWebhook ? 'Listening to order.* events' : 'Set up a webhook endpoint'}
                </p>
              </div>
              {hasWebhook && <span className="text-[10px] font-medium text-primary px-1.5 py-0.5 rounded bg-surface-container-lowest">Done</span>}
            </div>

            {/* Item 3: Send test event */}
            <div className={`flex items-start gap-3 p-3 rounded-lg border ${hasSuccessfulDelivery ? 'bg-surface-container-low/50 border-outline-variant/20' : 'bg-surface-container-lowest border-primary/40'}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${hasSuccessfulDelivery ? 'bg-primary text-on-primary' : 'border-2 border-primary text-primary text-[11px] font-semibold'}`}>
                {hasSuccessfulDelivery ? <Icon name="check" size={12} /> : '3'}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-medium ${hasSuccessfulDelivery ? 'text-on-surface line-through opacity-85' : 'text-on-surface font-semibold'}`}>
                  Send a test event
                </div>
                <p className="text-[11px] text-on-surface-variant mt-0.5">
                  {hasSuccessfulDelivery ? 'Verify signature & receiver handler' : 'Test your webhook setup'}
                </p>
              </div>
              {hasSuccessfulDelivery && <span className="text-[10px] font-medium text-primary px-1.5 py-0.5 rounded bg-surface-container-lowest">Done</span>}
              {!hasSuccessfulDelivery && webhooksList.length > 0 && (
                <button className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary text-on-primary hover:bg-primary-dim rounded text-xs font-medium transition-colors flex-shrink-0">
                  Send test
                  <Icon name="bolt" size={14} />
                </button>
              )}
            </div>
          </div>
        </Panel>
      )}

      {/* Summary cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* API Keys card */}
        <Panel className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-surface-container-low text-primary flex items-center justify-center">
                <Icon name="key" size={18} />
              </div>
              <span className="font-headline font-semibold text-sm text-on-surface">API keys</span>
            </div>
            <ArrowLink to="/keys">Manage</ArrowLink>
          </div>
          <div className="flex items-baseline gap-3 mb-4">
            <span className="font-headline text-3xl font-semibold text-on-surface num-tabular">{keysList.length}</span>
            <span className="text-xs text-on-surface-variant">total keys</span>
            {activeKeys.length > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-surface-container-low text-primary border border-outline-variant/30">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                {activeKeys.length} active
              </span>
            )}
          </div>
          {latestKey && (
            <div className="pt-3 border-t border-outline-variant/20 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 overflow-hidden">
                <code className="font-mono bg-surface-container-low text-on-surface px-2 py-0.5 rounded text-[11px] border border-outline-variant/30 truncate">
                  {latestKey.keyPrefix}…
                </code>
                <button className="text-on-surface-variant hover:text-on-surface" title="Copy key token">
                  <Icon name="content_copy" size={14} />
                </button>
              </div>
              <span className="text-on-surface-variant text-[11px] whitespace-nowrap">
                {latestKey.createdAt ? `Created ${fmt.ago(latestKey.createdAt)}` : '—'}
              </span>
            </div>
          )}
        </Panel>

        {/* Webhooks card */}
        <Panel className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-surface-container-low text-primary flex items-center justify-center">
                <Icon name="webhook" size={18} />
              </div>
              <span className="font-headline font-semibold text-sm text-on-surface">Webhooks</span>
            </div>
            <ArrowLink to="/webhooks">Manage</ArrowLink>
          </div>
          <div className="flex items-baseline gap-3 mb-4">
            <span className="font-headline text-3xl font-semibold text-on-surface num-tabular">{webhooksList.length}</span>
            <span className="text-xs text-on-surface-variant">subscriptions</span>
            {activeWebhooks.length > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-surface-container-low text-primary border border-outline-variant/30">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                {activeWebhooks.length} active
              </span>
            )}
          </div>
          {lastDelivery && (
            <div className="pt-3 border-t border-outline-variant/20 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${lastDelivery.status === 'success' ? 'bg-primary' : lastDelivery.status === 'pending' ? 'bg-amber-500' : 'bg-error'}`} />
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${lastDelivery.status === 'success' ? 'bg-primary' : lastDelivery.status === 'pending' ? 'bg-amber-500' : 'bg-error'}`} />
                </span>
                <span className="text-on-surface font-medium text-[11px]">{lastDelivery.status}{lastDelivery.statusCode ? ` · HTTP ${lastDelivery.statusCode}` : ''}</span>
                <span className="text-on-surface-variant text-[11px]">· {fmt.ago(lastDelivery.createdAt)}</span>
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* Main content grid: recent deliveries + docs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Recent deliveries table */}
        <div className="lg:col-span-2">
          <Panel className="overflow-hidden">
            <PanelHead
              title="Recent webhook deliveries"
              sub={`(Last ${deliveriesList.length} events)`}
              actions={
                <>
                  <button className="p-1 text-on-surface-variant hover:text-on-surface rounded hover:bg-surface-container-low transition-colors" title="Filter logs">
                    <Icon name="filter_list" size={18} />
                  </button>
                  <button className="p-1 text-on-surface-variant hover:text-on-surface rounded hover:bg-surface-container-low transition-colors" title="Refresh logs">
                    <Icon name="autorenew" size={18} />
                  </button>
                </>
              }
            />
            {deliveriesState.error ? (
              <ErrorText error={deliveriesState.error} />
            ) : deliveriesState.loading ? (
              <Loading />
            ) : deliveriesList.length === 0 ? (
              <div className="p-6"><p className="text-xs text-on-surface-variant">No webhook deliveries yet.</p></div>
            ) : (
              <Table>
                <THead>
                    <TH>Event</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Attempts</TH>
                    <TH className="text-right">Time</TH>
                    <TH className="text-right">Actions</TH>
                  </THead>
                <TBody>
                  {deliveriesList.map((d) => (
                    <TR key={d.id}>
                      <TD><code className="font-mono text-primary text-[12px]">{d.eventType}</code></TD>
                      <TD>
                        <StatusChip status={d.status} />
                        {d.statusCode && <span className="ml-1.5 font-mono text-[10px] text-on-surface-variant">HTTP {d.statusCode}</span>}
                      </TD>
                      <TD kind="text" className="text-right num-tabular text-on-surface">{d.attempts}</TD>
                      <TD className="text-right text-on-surface-variant text-[12px] whitespace-nowrap">{fmt.ago(d.createdAt)}</TD>
                      <TD className="text-right">
                        <button className="text-on-surface-variant hover:text-on-surface" title="Inspect payload">
                          <Icon name="open_in_new" size={16} />
                        </button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Panel>
        </div>

        {/* Right sidebar: Docs card + Rate limit info */}
        <div className="space-y-6">
          {/* Docs card */}
          <Panel className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Icon name="menu_book" className="text-primary" />
                <span className="font-headline font-semibold text-xs text-on-surface">Docs & Reference</span>
              </div>
              <Chip tone="primary">Quickstart</Chip>
            </div>
            <h4 className="font-headline font-semibold text-sm text-on-surface mb-2">
              Authenticate with X-Api-Key
            </h4>
            <p className="text-xs text-on-surface-variant mb-3 leading-relaxed">
              Include your live or sandbox partner key inside the HTTP header of every request.
            </p>
            <CodeBlock
              title="cURL request"
              value='curl -H "X-Api-Key: cp_live_..." \\\n  https://api.commerceplatform.io/v1/orders'
              maxHeight={200}
            />
            <div className="pt-3 border-t border-outline-variant/20 space-y-2 mt-4">
              <ArrowLink to="/docs" tone="primary">View API Reference</ArrowLink>
              <ArrowLink to="/docs" tone="primary">Webhook signatures guide</ArrowLink>
            </div>
          </Panel>

          {/* Rate limit info */}
          <div className="bg-surface-container-low/50 rounded-lg border border-outline-variant/30 p-4 text-xs">
            <div className="flex items-start gap-2.5">
              <Icon name="info" className="text-primary mt-0.5" size={18} />
              <div>
                <span className="font-medium text-on-surface">Keep keys server-side</span>
                <p className="text-on-surface-variant text-[11px] mt-0.5 leading-normal">
                  Send the key in the X-Api-Key header from your server only. A revoked key stops working immediately.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}
