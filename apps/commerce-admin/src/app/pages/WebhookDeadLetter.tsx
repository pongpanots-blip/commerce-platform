// ui-caption-migration: literal captions only
// ui-metadata-migration: static labels and UI notices only
import { Fragment, useState } from 'react';
import { webhookApi, WebhookDeliveryFull } from '../../lib/api';
import { useAsync } from '../hooks';
import { Page, PageHeader, Panel, PanelHead, Table, THead, TH, TBody, TR, TD, ExpandRow, ExpandToggle, Alert, Chip, Empty, Loading, CodeBlock, StatusChip, fmt, DetailSection, Button } from '@cp/ui';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function WebhookDeadLetter() {
  __useUiLocale();
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
      setMessage(__uiText('สั่งส่งใหม่แล้ว ระบบจะส่งอีกครั้งในไม่ช้า'));
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
      <PageHeader title={__uiText("รายการส่งไม่สำเร็จ")} subtitle={__uiText("ข้อมูลที่ส่งไม่สำเร็จ ตรวจสอบและส่งใหม่")} actions={<Button icon="refresh" onClick={reload}>{__uiText("Refresh")}</Button>} />

      {message && <Alert tone="ok">{message}</Alert>}
      {error && <Alert tone="danger">{(typeof error === 'string' ? __uiText(error) : error)}</Alert>}
      {actionError && <Alert tone="danger">{(typeof (actionError) === 'string' ? __uiText(actionError) : actionError)}</Alert>}

      <Panel>
        <PanelHead title={__uiText("Failed Deliveries")} sub={__uiText("{0}",{'0':failedDeliveries.length})} />
        {loading ? (
          <Loading />
        ) : !failedDeliveries.length ? (
          <Empty icon="task_alt">{__uiText("ไม่มีรายการที่ส่งไม่สำเร็จ")}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText("Event Type")}</TH>
              <TH>{__uiText("Target URL")}</TH>
              <TH right>{__uiText("Status Code")}</TH>
              <TH right>{__uiText("Attempts")}</TH>
              <TH>{__uiText("Error")}</TH>
              <TH>{__uiText("Created")}</TH>
              <TH></TH>
            </THead>
            <TBody>
              {failedDeliveries.map((delivery: WebhookDeliveryFull) => (
                <Fragment key={delivery.id}>
                  <TR>
                    <TD><Chip className="font-mono">{delivery.eventType}</Chip></TD>
                    <TD kind="mono">{delivery.targetUrl}</TD>
                    <TD kind="num">{delivery.statusCode || '—'}</TD>
                    <TD kind="num">{delivery.attempts}</TD>
                    <TD className="text-on-surface-variant text-xs">{delivery.error ? delivery.error.substring(0, 40) + '…' : '—'}</TD>
                    <TD kind="time">{fmt.when(delivery.createdAt)}</TD>
                    <TD kind="actions"><ExpandToggle open={expandedId === delivery.id} onClick={() => setExpandedId((cur) => (cur === delivery.id ? null : delivery.id))} /> <Button size="sm" disabled={busy === `retry-${delivery.id}`} onClick={() => retryDelivery(delivery.id)}>{busy === `retry-${delivery.id}` ? '…' : __uiText("Retry")}</Button></TD>
                  </TR>
                  {expandedId === delivery.id && (
                    <ExpandRow colSpan={7}>
                      {delivery.error && (
                        <DetailSection title={__uiText("Error")}>
                          <CodeBlock title="" value={delivery.error} maxHeight={300} />
                        </DetailSection>
                      )}
                      {delivery.payload !== undefined && (
                        <DetailSection title={__uiText("Payload")}>
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
          <PanelHead title={__uiText("Summary")} />
          <Table>
            <THead>
              <TH>{__uiText("Status")}</TH>
              <TH right>{__uiText("Count")}</TH>
            </THead>
            <TBody>
              {['pending', 'success', 'failed'].map((status) => {
                const count = deliveries.filter((d: WebhookDeliveryFull) => d.status === status).length;
                return count > 0 ? (
                  <TR key={status}>
                    <TD><StatusChip status={status} /></TD>
                    <TD kind="num">{fmt.num(count)}</TD>
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

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data
