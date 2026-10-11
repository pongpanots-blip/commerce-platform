// ui-caption-migration: literal captions only
import { FormEvent, Fragment, useState } from 'react';
import { joshErpLogApi } from '../../lib/api';
import { useAsync } from '../hooks';
import { Page, PageHeader, Panel, PanelHead, Table, THead, TH, TBody, TR, TD, ExpandRow, ExpandToggle, Pager, ErrorText, Empty, Loading, CodeBlock, Chip, Hint, Select, fmt, Field, Input, DetailSection, Button } from '@cp/ui';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const ENDPOINTS = ['products/qty', 'products/price', 'products/moq', 'products', 'products/bulk', 'products/image', 'customers', 'companies',
  'orders/status', 'invoices/status', 'quotations', 'quotations/status', 'order-periods'];
/** What each ERP call carries, in staff words. Filter values stay the raw endpoint paths. */
const ENDPOINT_LABEL: Record<string, string> = {
  'products/qty': 'จำนวนสินค้า',
  'products/price': 'ราคาสินค้า',
  'products/moq': 'จำนวนสั่งขั้นต่ำ',
  products: 'ข้อมูลสินค้า',
  'products/bulk': 'ข้อมูลสินค้าหลายรายการ',
  'products/image': 'รูปสินค้า',
  customers: 'ลูกค้า',
  companies: 'บริษัท',
  'orders/status': 'สถานะออเดอร์',
  'invoices/status': 'สถานะใบแจ้งหนี้',
  quotations: 'ใบเสนอราคา',
  'quotations/status': 'สถานะใบเสนอราคา',
  'order-periods': 'รอบการสั่งซื้อ',
};
const endpointLabel = (e: string) => (ENDPOINT_LABEL[e] ? __uiText(ENDPOINT_LABEL[e]) : e);
const LIMIT = 50;
const iso = (v: string) => (v ? new Date(v).toISOString() : undefined);

export function JoshErpLogs() {
  __useUiLocale();
  const [draft, setDraft] = useState({ endpoint: '', status: 'all', from: '', to: '', q: '' });
  const [f, setF] = useState(draft);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync(
    () => joshErpLogApi.list({ endpoint: f.endpoint || undefined, status: f.status, from: iso(f.from), to: iso(f.to), q: f.q || undefined, page, limit: LIMIT }),
    [f, page],
  );
  const detail = useAsync(() => (open ? joshErpLogApi.get(open) : Promise.resolve(null)), [open]);
  const set = (k: keyof typeof draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });

  return (
    <Page>
      <PageHeader title={__uiText("บันทึกการเรียกระบบหลัก (ERP)")} subtitle={__uiText("บันทึกการเรียกระบบหลัก (ERP) จากระบบร้านค้า")} actions={<Button icon="refresh" onClick={reload}>{__uiText("Refresh")}</Button>} />

      <Panel>
        <PanelHead title={__uiText("ตัวกรอง")} />
        <form className="space-y-3 px-4 py-3" onSubmit={(e: FormEvent) => { e.preventDefault(); setPage(1); setF(draft); }}>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Field label={__uiText("ประเภทข้อมูล")}>
              <Select value={draft.endpoint} onChange={set('endpoint')}>
                <option value="">{__uiText("ทุกประเภทข้อมูล")}</option>
                {ENDPOINTS.map((e) => <option key={e} value={e}>{endpointLabel(e)}</option>)}
              </Select>
            </Field>
            <Field label={__uiText("ผล")}>
              <Select value={draft.status} onChange={set('status')}>
                <option value="all">{__uiText("ทั้งหมด")}</option><option value="ok">{__uiText("สำเร็จ")}</option><option value="fail">{__uiText("ไม่สำเร็จ")}</option>
              </Select>
            </Field>
            <Field label={__uiText("ตั้งแต่")}><Input type="datetime-local" value={draft.from} onChange={set('from')} /></Field>
            <Field label={__uiText("ถึง")}><Input type="datetime-local" value={draft.to} onChange={set('to')} /></Field>
            <Field label={__uiText("ค้นหา")} className="md:col-span-2"><Input value={draft.q} onChange={set('q')} placeholder={__uiText("ค้นหา: รหัสสินค้า / เลข order / รหัสลูกค้า")} /></Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Hint>{__uiText("ค่าเริ่มต้นแสดง 24 ชั่วโมงล่าสุด ค้นได้ครั้งละไม่เกิน 7 วัน และระบบร้านค้าเก็บบันทึกไว้ 14 วัน")}</Hint>
            <Button variant="primary" type="submit">{__uiText("ค้นหา")}</Button>
          </div>
        </form>
      </Panel>

      <ErrorText error={error} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Panel>
            <PanelHead title={__uiText("ผลการค้นหา")} sub={__uiText("{0} รายการ",{'0':data.total.toLocaleString('th-TH')})} />
            {data.items.length ? (
              <Table>
                <THead>
                  <TH>{__uiText("เวลา")}</TH><TH>{__uiText("ประเภทข้อมูล")}</TH><TH>{__uiText("ผล")}</TH><TH right>{__uiText("เวลาที่ใช้ (มิลลิวินาที)")}</TH><TH>{__uiText("สรุป")}</TH><TH></TH>
                </THead>
                <TBody>
                  {data.items.map((r) => (
                    <Fragment key={r.id}>
                      <TR>
                        <TD kind="time">{fmt.when(r.createdAt)}</TD>
                        <TD><div>{endpointLabel(r.endpoint.replace(/^\/?(api\/)?erp\//, ''))}</div><div className="font-mono text-[11px] text-on-surface-variant">{r.method} {r.endpoint}</div></TD>
                        <TD>{r.isSuccess ? <Chip tone="ok" dot>{__uiText("สำเร็จ")}</Chip> : <Chip tone="danger" dot>{__uiText("ไม่สำเร็จ")}</Chip>}</TD>
                        <TD kind="num">{fmt.num(r.durationMs)}</TD>
                        <TD className="text-on-surface-variant text-xs">{r.summary ?? '—'}</TD>
                        <TD kind="actions"><ExpandToggle open={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)} /></TD>
                      </TR>
                      {open === r.id && (
                        <ExpandRow colSpan={6}>
                          {detail.error ? <ErrorText error={detail.error} /> : detail.data ? (
                            <DetailSection title={__uiText("Payload")}>
                              <CodeBlock title="" value={detail.data} maxHeight={400} />
                            </DetailSection>
                          ) : <Loading />}
                        </ExpandRow>
                      )}
                    </Fragment>
                  ))}
                </TBody>
              </Table>
            ) : <Empty>{__uiText("ไม่มีรายการในช่วงนี้ ลองขยายช่วงเวลาหรือล้างคำค้นหา")}</Empty>}
            <Pager page={page} pageSize={LIMIT} total={data.total} onPage={setPage} />
          </Panel>
        </>
      )}
    </Page>
  );
}
