import { Fragment, useState } from 'react';
import { erpIngestApi, ErpIngestRecordRow, Paginated } from '../../lib/api';
import { useAsync } from '../hooks';
import { Page, PageHeader, Panel, PanelHead, Table, THead, TH, TBody, TR, TD, ExpandRow, ExpandToggle, Pager, ErrorText, Empty, Loading, CodeBlock, Chip, Field, Select, StatusChip, Tone, fmt, DetailSection, Button } from '@cp/ui';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const ENTITY_TYPES = ['product_qty', 'product_price', 'product_moq', 'product', 'stock', 'customer', 'sale_order'];
const STATUSES = ['received', 'applied', 'failed', 'skipped', 'stale', 'ignored'];
/** Staff words for each data type and state. Filter values stay the raw codes. */
const ENTITY_LABEL: Record<string, string> = {
  product_qty: 'จำนวนสินค้า',
  product_price: 'ราคาสินค้า',
  product_moq: 'จำนวนสั่งขั้นต่ำ',
  product: 'ข้อมูลสินค้า',
  stock: 'สต็อก',
  customer: 'ลูกค้า',
  sale_order: 'ใบสั่งขาย',
};
const STATUS_LABEL: Record<string, [Tone, string]> = {
  received: ['warn', 'รับแล้ว รอนำไปใช้'],
  applied: ['ok', 'นำไปใช้แล้ว'],
  failed: ['danger', 'ไม่สำเร็จ'],
  skipped: ['muted', 'ข้ามไป'],
  stale: ['muted', 'ข้อมูลเก่ากว่าที่มีอยู่'],
  ignored: ['muted', 'ไม่นำไปใช้'],
};
const entityLabel = (t: string) => (ENTITY_LABEL[t] ? __uiText(ENTITY_LABEL[t]) : t);

export function InboundLog() {
  __useUiLocale();
  const [entityType, setEntityType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync<Paginated<ErpIngestRecordRow>>(
    () => erpIngestApi.list({ entityType: entityType || undefined, status: status || undefined, page, pageSize }),
    [entityType, status, page],
  );

  function changeEntityType(v: string) {
    setEntityType(v);
    setPage(1);
  }

  function changeStatus(v: string) {
    setStatus(v);
    setPage(1);
  }

  async function applyOrRetry(id: string) {
    setBusy(id);
    setActionError(null);
    try {
      await erpIngestApi.apply(id);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const total = data?.total ?? 0;

  return (
    <Page>
      <PageHeader title={__uiText("บันทึกข้อมูลจากระบบหลัก (ERP)")} subtitle={__uiText("บันทึกข้อมูลที่ระบบหลัก (ERP) ส่งเข้ามา")} actions={<Button icon="refresh" onClick={reload}>{__uiText("Refresh")}</Button>} />

      <Panel>
        <PanelHead title={__uiText("รายการที่ได้รับ")} sub={data ? __uiText("{0} รายการ", { 0: total.toLocaleString() }) : undefined} />
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4 border-b border-secondary-container">
          <Field label={__uiText("ประเภทข้อมูล")}>
            <Select value={entityType} onChange={(e) => changeEntityType(e.target.value)}>
              <option value="">{__uiText("ทุกประเภทข้อมูล")}</option>
              {ENTITY_TYPES.map((t) => <option key={t} value={t}>{entityLabel(t)}</option>)}
            </Select>
          </Field>
          <Field label={__uiText("สถานะ")}>
            <Select value={status} onChange={(e) => changeStatus(e.target.value)}>
              <option value="">{__uiText("All statuses")}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{__uiText(STATUS_LABEL[s][1])}</option>)}
            </Select>
          </Field>
        </div>
        <ErrorText error={error} />
        <ErrorText error={actionError} />
        {loading && !data ? <Loading /> : !data?.items.length ? (
          <Empty>{entityType || status ? __uiText("ไม่มีข้อมูลที่ตรงกับตัวกรอง ลองเปลี่ยนประเภทข้อมูลหรือสถานะ") : __uiText("ยังไม่มีข้อมูลจากระบบหลัก (ERP) ข้อมูลจะแสดงที่นี่เมื่อระบบหลักส่งเข้ามา")}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText("Created")}</TH><TH>{__uiText("Entity type")}</TH><TH>{__uiText("External ID")}</TH><TH>{__uiText("Status")}</TH><TH>{__uiText("Error")}</TH><TH></TH>
            </THead>
            <TBody>
              {data.items.map((r) => (
                <Fragment key={r.id}>
                  <TR>
                    <TD kind="time">{fmt.when(r.createdAt)}</TD>
                    <TD>{entityLabel(r.entityType)}</TD>
                    <TD kind="mono">{r.externalId ?? '—'}</TD>
                    <TD>{STATUS_LABEL[r.status] ? <Chip tone={STATUS_LABEL[r.status][0]} dot>{__uiText(STATUS_LABEL[r.status][1])}</Chip> : <StatusChip status={r.status} />}</TD>
                    <TD className="text-on-surface-variant text-xs">{r.error ?? '—'}</TD>
                    <TD kind="actions"><ExpandToggle open={expandedId === r.id} onClick={() => setExpandedId(cur => cur === r.id ? null : r.id)} /> {(r.status === 'received' || r.status === 'failed') && <Button size="sm" disabled={busy === r.id} onClick={() => applyOrRetry(r.id)}>{busy === r.id ? '…' : r.status === 'failed' ? __uiText("Retry") : __uiText("Apply")}</Button>}</TD>
                  </TR>
                  {expandedId === r.id && (
                    <ExpandRow colSpan={6}>
                      <DetailSection title={__uiText("Payloads")}>
                        <div className="grid md:grid-cols-2 gap-3">
                          <CodeBlock title={__uiText("Raw")} value={r.rawPayload} maxHeight={300} />
                          <CodeBlock title={__uiText("Parsed")} value={r.parsedPayload} maxHeight={300} />
                        </div>
                      </DetailSection>
                      {r.error && (
                        <DetailSection title={__uiText("Error")}>
                          <p className="text-xs text-on-surface whitespace-pre-wrap break-words">{r.error}</p>
                        </DetailSection>
                      )}
                    </ExpandRow>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
        )}
        <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
      </Panel>
    </Page>
  );
}
