import { Fragment, useState } from 'react';
import { api, WebhookEvent } from '../../lib/api';
import { useAsync } from '../hooks';
import { commerceText as text } from '../commerce-copy';
import { Page, PageHeader, Panel, PanelHead, Table, THead, TH, TBody, TR, TD, ExpandRow, ExpandToggle, ErrorText, Empty, Loading, CodeBlock, Chip, StatusChip, Tone, fmt, DetailSection, Button } from '@cp/ui';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
/** Inbound event states the shared status chip has no label for. Others fall back to StatusChip. */
const EVENT_STATUS: Record<string, [Tone, string]> = {
  received: ['warn', 'รอประมวลผล'],
  processed: ['ok', 'ประมวลผลแล้ว'],
};

export function Webhooks() {
  __useUiLocale();
  const { data, loading, error, reload } = useAsync(() => api.get<WebhookEvent[]>('/webhooks'));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);

  async function replay(id: string) {
    if (busy || !window.confirm(text('ประมวลผลเหตุการณ์นี้อีกครั้ง? ระบบอาจเปลี่ยนข้อมูลตามเหตุการณ์นี้', 'Process this event again? This may change data associated with the event.'))) return;
    setBusy(id);
    setReplayError(null);
    try {
      await api.post(`/webhooks/replay/${id}`, {});
      reload();
    } catch (err) {
      setReplayError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page>
      <PageHeader title={__uiText("เหตุการณ์ขาเข้า")} subtitle={__uiText("เหตุการณ์ที่ระบบภายนอกส่งเข้ามา")} actions={<Button icon="refresh" onClick={reload}>{__uiText("Refresh")}</Button>} />

      <Panel>
        <PanelHead title={__uiText("Recent events")} />
        <ErrorText error={error} />
        <ErrorText error={replayError} />
        {loading ? <Loading /> : error && !data ? null : !data?.length ? (
          <Empty>{__uiText("ยังไม่มีเหตุการณ์ขาเข้า เหตุการณ์จะแสดงที่นี่เมื่อระบบภายนอกส่งเข้ามา")}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText("Received")}</TH><TH>{__uiText("Integration")}</TH><TH>{__uiText("Signature")}</TH><TH>{__uiText("Status")}</TH><TH right>{__uiText("Attempts")}</TH><TH></TH>
            </THead>
            <TBody>
              {data.map((w) => (
                <Fragment key={w.id}>
                  <TR>
                    <TD kind="time">{fmt.when(w.createdAt)}</TD>
                    <TD kind="mono">{w.integrationId.slice(0, 8)}…</TD>
                    <TD>{w.signatureValid ? <Chip tone="ok" dot>{__uiText("ลายเซ็นถูกต้อง")}</Chip> : <Chip tone="danger" dot>{__uiText("ลายเซ็นไม่ถูกต้อง")}</Chip>}</TD>
                    <TD>{EVENT_STATUS[w.status] ? <Chip tone={EVENT_STATUS[w.status][0]} dot>{__uiText(EVENT_STATUS[w.status][1])}</Chip> : <StatusChip status={w.status} />}</TD>
                    <TD kind="num">{w.attempts}</TD>
                    <TD kind="actions"><ExpandToggle open={expandedId === w.id} onClick={() => setExpandedId(cur => cur === w.id ? null : w.id)} /> <Button size="sm" disabled={busy !== null || !w.signatureValid} onClick={() => replay(w.id)}>{busy === w.id ? '…' : __uiText("Replay")}</Button></TD>
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
