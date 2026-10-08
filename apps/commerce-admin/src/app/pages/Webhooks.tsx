import { Fragment, useState } from 'react';
import { api, WebhookEvent } from '../../lib/api';
import { useAsync } from '../hooks';
import { Page, PageHeader, Panel, PanelHead, Table, THead, TH, TBody, TR, TD, ExpandRow, ExpandToggle, ErrorText, Empty, Loading, CodeBlock, StatusChip, fmt, DetailSection, Button } from '@cp/ui';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function Webhooks() {
  __useUiLocale();
  const { data, loading, error, reload } = useAsync(() => api.get<WebhookEvent[]>('/webhooks'));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function replay(id: string) {
    setBusy(id);
    try {
      await api.post(`/webhooks/replay/${id}`, {});
      reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page>
      <PageHeader title={__uiText("Webhook events")} subtitle={__uiText("Inbound webhooks — stored raw, processed asynchronously, replayable.")} actions={<Button icon="refresh" onClick={reload}>{__uiText("Refresh")}</Button>} />

      <Panel>
        <PanelHead title={__uiText("Recent events")} />
        <ErrorText error={error} />
        {loading ? <Loading /> : !data?.length ? (
          <Empty>{__uiText("No webhook events yet.")}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText("Received")}</TH><TH>{__uiText("Integration")}</TH><TH>{__uiText("Signature")}</TH><TH>{__uiText("Status")}</TH><TH>{__uiText("Attempts")}</TH><TH></TH>
            </THead>
            <TBody>
              {data.map((w) => (
                <Fragment key={w.id}>
                  <TR>
                    <TD kind="time">{fmt.when(w.createdAt)}</TD>
                    <TD kind="mono">{w.integrationId.slice(0, 8)}…</TD>
                    <TD><StatusChip status={w.signatureValid ? 'valid' : 'invalid'} /></TD>
                    <TD><StatusChip status={w.status} /></TD>
                    <TD>{w.attempts}</TD>
                    <TD kind="actions"><ExpandToggle open={expandedId === w.id} onClick={() => setExpandedId(cur => cur === w.id ? null : w.id)} /> <Button variant="primary" disabled={busy === w.id || !w.signatureValid} onClick={() => replay(w.id)}>{busy === w.id ? '…' : __uiText("Replay")}</Button></TD>
                  </TR>
                  {expandedId === w.id && (
                    <ExpandRow colSpan={6}>
                      <DetailSection title={__uiText("Payload")}>
                        <CodeBlock title="" value={w.payload} maxHeight={400} />
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
