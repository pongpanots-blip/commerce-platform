// ui-caption-migration: literal captions only
import { FormEvent, Fragment, useState } from 'react';
import { joshErpLogApi } from '../../lib/api';
import { useAsync } from '../hooks';
import { Page, PageHeader, Panel, PanelHead, Table, THead, TH, TBody, TR, TD, ExpandRow, ExpandToggle, Pager, ErrorText, Empty, Loading, CodeBlock, StatusChip, fmt, Field, Input, DetailSection, Button } from '@cp/ui';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const ENDPOINTS = ['products/qty', 'products/price', 'products/moq', 'products', 'products/bulk', 'products/image', 'customers', 'companies',
  'orders/status', 'invoices/status', 'quotations', 'quotations/status', 'order-periods'];
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
      <PageHeader title={__uiText("ERP log ของ josh")} subtitle={__uiText("สิ่งที่ ERP ส่งเข้า josh (/api/erp/*) และ josh รับได้หรือไม่ · ค่าเริ่มต้น 24 ชม. ล่าสุด ค้นได้ทีละไม่เกิน 7 วัน · josh เก็บไว้ 14 วัน")} actions={<Button icon="refresh" onClick={reload}>{__uiText("Refresh")}</Button>} />

      <Panel>
        <PanelHead title={__uiText("Filters")} />
        <form className="space-y-3 px-4 py-3" onSubmit={(e: FormEvent) => { e.preventDefault(); setPage(1); setF(draft); }}>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <select value={draft.endpoint} onChange={set('endpoint')} className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60">
              <option value="">{__uiText("ทั้งหมด (Endpoint)")}</option>
              {ENDPOINTS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <select value={draft.status} onChange={set('status')} className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60">
              <option value="all">{__uiText("ทั้งหมด (ผล)")}</option><option value="ok">{__uiText("สำเร็จ")}</option><option value="fail">{__uiText("ไม่สำเร็จ")}</option>
            </select>
            <input type="datetime-local" value={draft.from} onChange={set('from')} className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60" placeholder={__uiText("ตั้งแต่")} />
            <input type="datetime-local" value={draft.to} onChange={set('to')} className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60" placeholder={__uiText("ถึง")} />
            <input value={draft.q} onChange={set('q')} placeholder={__uiText("ค้นหา: รหัสสินค้า / เลข order / รหัสลูกค้า")} className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60 md:col-span-2" />
            <Button variant="primary" type="submit">{__uiText("ค้นหา")}</Button>
          </div>
        </form>
      </Panel>

      <ErrorText error={error} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Panel>
            <PanelHead title={__uiText("Results")} sub={__uiText("{0} รายการ",{'0':data.total.toLocaleString('th-TH')})} />
            {data.items.length ? (
              <Table>
                <THead>
                  <TH>{__uiText("เวลา")}</TH><TH>{__uiText("Endpoint")}</TH><TH>{__uiText("ผล")}</TH><TH right>{__uiText("ms")}</TH><TH>{__uiText("สรุป")}</TH><TH></TH>
                </THead>
                <TBody>
                  {data.items.map((r) => (
                    <Fragment key={r.id}>
                      <TR>
                        <TD kind="time">{fmt.when(r.createdAt)}</TD>
                        <TD kind="mono">{r.method} {r.endpoint}</TD>
                        <TD><StatusChip status={r.isSuccess ? 'ok' : 'error'} /></TD>
                        <TD kind="num">{r.durationMs}</TD>
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
            ) : <Empty>{__uiText("ไม่มีรายการในช่วงนี้")}</Empty>}
            <Pager page={page} pageSize={LIMIT} total={data.total} onPage={setPage} />
          </Panel>
        </>
      )}
    </Page>
  );
}
