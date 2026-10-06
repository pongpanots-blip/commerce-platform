import { Fragment, useState } from 'react';
import { webhookApi, WebhookDeliveryFull } from '../../lib/api';
import { useAsync } from '../hooks';
import { Page, PageHeader, Panel, PanelHead, Table, THead, TH, TBody, TR, TD, ExpandRow, ExpandToggle, Alert, Empty, Loading, CodeBlock, StatusChip, fmt, DetailSection } from '@cp/ui';

export function WebhookDeadLetter() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');

  const { data: deliveries, loading, error, reload } = useAsync(() => webhookApi.deliveries(), []);

  async function retryDelivery(id: string) {
    setBusy(`retry-${id}`);
    setActionError('');
    try {
      await webhookApi.retryDelivery(id);
      setMessage('Retry queued');
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const failedDeliveries = deliveries?.filter((d: WebhookDeliveryFull) => d.status === 'failed') || [];

  return (
    <Page>
      <PageHeader crumbs={['Webhooks', 'Dead Letter']} title="Webhook Dead Letter" subtitle="View and retry failed webhook deliveries." actions={<button className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1 px-3 py-1.5 text-xs border border-secondary-container bg-surface-container-lowest hover:bg-surface-container-low text-on-surface" onClick={reload}>Refresh</button>} />

      {message && <Alert tone="ok">{message}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {actionError && <Alert tone="danger">{actionError}</Alert>}

      <Panel>
        <PanelHead title="Failed Deliveries" sub={`${failedDeliveries.length}`} />
        {loading ? (
          <Loading />
        ) : !failedDeliveries.length ? (
          <Empty>No failed webhook deliveries.</Empty>
        ) : (
          <Table>
            <THead>
              <TH>Event Type</TH>
              <TH>Target URL</TH>
              <TH>Status Code</TH>
              <TH>Attempts</TH>
              <TH>Error</TH>
              <TH>Created</TH>
              <TH></TH>
            </THead>
            <TBody>
              {failedDeliveries.map((delivery: WebhookDeliveryFull) => (
                <Fragment key={delivery.id}>
                  <TR>
                    <TD>{delivery.eventType}</TD>
                    <TD kind="mono">{delivery.targetUrl}</TD>
                    <TD>{delivery.statusCode || '—'}</TD>
                    <TD>{delivery.attempts}</TD>
                    <TD className="text-on-surface-variant text-xs">{delivery.error ? delivery.error.substring(0, 40) + '…' : '—'}</TD>
                    <TD kind="time">{fmt.when(delivery.createdAt)}</TD>
                    <TD kind="actions"><ExpandToggle open={expandedId === delivery.id} onClick={() => setExpandedId((cur) => (cur === delivery.id ? null : delivery.id))} /> <button className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1 px-3 py-1.5 text-xs bg-primary text-on-primary hover:bg-primary-dim border border-primary shadow-xs" disabled={busy === `retry-${delivery.id}`} onClick={() => retryDelivery(delivery.id)}>{busy === `retry-${delivery.id}` ? '…' : 'Retry'}</button></TD>
                  </TR>
                  {expandedId === delivery.id && (
                    <ExpandRow colSpan={7}>
                      {delivery.error && (
                        <DetailSection title="Error">
                          <CodeBlock title="" value={delivery.error} maxHeight={300} />
                        </DetailSection>
                      )}
                      {delivery.payload !== undefined && (
                        <DetailSection title="Payload">
                          <CodeBlock title="" value={delivery.payload} maxHeight={300} />
                        </DetailSection>
                      )}
                    </ExpandRow>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      {deliveries && deliveries.length > failedDeliveries.length && (
        <Panel>
          <PanelHead title="Summary" />
          <Table>
            <THead>
              <TH>Status</TH>
              <TH>Count</TH>
            </THead>
            <TBody>
              {['pending', 'success', 'failed'].map((status) => {
                const count = deliveries.filter((d: WebhookDeliveryFull) => d.status === status).length;
                return count > 0 ? (
                  <TR key={status}>
                    <TD><StatusChip status={status} /></TD>
                    <TD>{count}</TD>
                  </TR>
                ) : null;
              })}
            </TBody>
          </Table>
        </Panel>
      )}
    </Page>
  );
}
