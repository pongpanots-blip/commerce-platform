// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-caption-migration: literal captions only
import { Fragment, useState } from 'react';
import { apiLogsApi } from '../../lib/api';
import { useAsync } from '../hooks';
import { Page, PageHeader, Panel, PanelHead, Table, THead, TH, TBody, TR, TD, ExpandRow, ExpandToggle, Pager, ErrorText, Empty, Loading, CodeBlock, StatusChip, fmt, StackedBars, DetailSection, Button } from '@cp/ui';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const SELECTS = {
  status: ['all', '2xx', '4xx', '5xx'], source: ['all', 'internal', 'jagota', 'kbank', 'erp_webhook'],
  method: ['all', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'], sort: ['newest', 'slowest'],
} as const;

export function JoshApiLogs() {
  __useUiLocale();
  const [f, setF] = useState<Record<string, string>>({ status: 'all', source: 'all', method: 'all', sort: 'newest', q: '', page: '1' });
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const query = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v !== 'all'));
  const stats = useAsync(() => apiLogsApi.stats(query), [JSON.stringify(query)]);
  const list = useAsync(() => apiLogsApi.list(query), [JSON.stringify(query)]);
  const detail = useAsync(() => (open ? apiLogsApi.detail(open) : Promise.resolve(null)), [open]);
  const set = (k: string, v: string) => setF({ ...f, [k]: v, page: '1' });
  const page = Number(f.page);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.limit)) : 1;
  const s = stats.data;

  return (
    <Page>
      <PageHeader title={__uiText("API log ของ josh")} subtitle={__uiText("อ่านอย่างเดียวจาก Mongo ของ josh (24 ชม. ล่าสุด, ย้อนได้สูงสุด 7 วัน) · ERP ที่ยิงเข้า josh ดูที่ &#34;ERP log ของ josh&#34;")} actions={<Button icon="refresh" onClick={() => { stats.reload(); list.reload(); }}>{__uiText("Refresh")}</Button>} />

      <Panel>
        <PanelHead title={__uiText("Filters")} />
        <form className="space-y-3 px-4 py-3" onSubmit={(e) => { e.preventDefault(); set('q', draft.trim()); }}>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {Object.entries(SELECTS).map(([k, opts]) => (
              <select key={k} value={f[k]} onChange={(e) => set(k, e.target.value)} className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60">
                <option value="">{k}</option>
                {opts.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ))}
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={__uiText("ค้นใน URL / message")} className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60 lg:col-span-2" />
            <Button variant="primary">{__uiText("ค้นหา")}</Button>
          </div>
        </form>
      </Panel>

      <ErrorText error={stats.error || list.error} />

      {s && (
        <div className="grid md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <Panel>
              <PanelHead title={__uiText("Requests per hour")} sub={__uiText("{0} – {1}",{'0':fmt.when(s.from),'1':fmt.when(s.to)})} />
              <div className="px-4 py-3">
                <StackedBars bars={s.buckets.map((b) => ({ label: new Date(b.start).toLocaleTimeString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), { hour: '2-digit', minute: '2-digit' }), ok: b.count - b.errors, err: b.errors }))} height={120} />
              </div>
            </Panel>
          </div>

          <div>
            <Panel>
              <PanelHead title={__uiText("Slowest routes")} />
              {s.topEndpoints.length ? (
                <Table maxHeight="400px">
                  <THead>
                    <TH>{__uiText("Route")}</TH><TH right>{__uiText("ms")}</TH>
                  </THead>
                  <TBody>
                    {s.topEndpoints.slice(0, 10).map((t) => (
                      <TR key={t.method + t.route}>
                        <TD kind="mono" className="text-[10px]">{t.method} {t.route}</TD>
                        <TD kind="num" className="text-[10px]">{t.avgMs}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : <Empty icon="trending_flat">{__uiText("No data")}</Empty>}
            </Panel>
          </div>
        </div>
      )}

      {list.data && (
        <Panel>
          <PanelHead title={__uiText("Log entries")} sub={__uiText("{0} requests",{'0':list.data.total.toLocaleString()})} />
          {list.data.items.length ? (
            <Table>
              <THead>
                <TH>{__uiText("เวลา")}</TH><TH>{__uiText("Method")}</TH><TH>{__uiText("URL")}</TH><TH>{__uiText("Status")}</TH><TH right>{__uiText("ms")}</TH><TH>{__uiText("ที่มา")}</TH><TH></TH>
              </THead>
              <TBody>
                {list.data.items.map((r) => (
                  <Fragment key={r.id}>
                    <TR>
                      <TD kind="time">{fmt.when(r.createdAt)}</TD><TD kind="mono">{r.method}</TD><TD kind="mono" className="text-[11px]">{r.url}</TD>
                      <TD><StatusChip status={r.isSuccess ? 'ok' : 'error'} /></TD><TD kind="num">{r.durationMs}</TD><TD className="text-on-surface-variant text-xs">{r.source}</TD>
                      <TD kind="actions"><ExpandToggle open={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)} /></TD>
                    </TR>
                    {open === r.id && (
                      <ExpandRow colSpan={7}>
                        {detail.error ? <ErrorText error={detail.error} /> : !detail.data ? <Loading /> : (
                          <>
                            {detail.data.errorMessage && <DetailSection title={__uiText("Error")}><ErrorText error={detail.data.errorMessage} /></DetailSection>}
                            {!!detail.data.steps.length && (
                              <DetailSection title={__uiText("Timeline")}>
                                <div className="space-y-1">
                                  {detail.data.steps.map((st, i) => (
                                    <div key={i} className="text-[11px] text-on-surface flex justify-between">
                                      <span>{st.label}</span>
                                      <span className="font-mono text-on-surface-variant">{st.ms}{__uiText("ms")}</span>
                                    </div>
                                  ))}
                                </div>
                              </DetailSection>
                            )}
                            <DetailSection title={__uiText("Payload")}>
                              <div className="grid md:grid-cols-2 gap-3">
                                <CodeBlock title={__uiText("Request")} value={{ query: detail.data.query, payload: detail.data.payload }} maxHeight={300} />
                                <CodeBlock title={__uiText("Response")} value={detail.data.response} maxHeight={300} />
                              </div>
                            </DetailSection>
                          </>
                        )}
                      </ExpandRow>
                    )}
                  </Fragment>
                ))}
              </TBody>
            </Table>
          ) : <Empty>{__uiText("ไม่มี log ในช่วงนี้")}</Empty>}
          <Pager page={page} pageSize={list.data.limit} total={list.data.total} onPage={(p) => setF({ ...f, page: String(p) })} />
        </Panel>
      )}
    </Page>
  );
}
