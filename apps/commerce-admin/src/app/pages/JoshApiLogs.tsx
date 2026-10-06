import { Fragment, useState } from 'react';
import { apiLogsApi } from '../../lib/api';
import { useAsync } from '../hooks';
import { Page, PageHeader, Panel, PanelHead, Table, THead, TH, TBody, TR, TD, ExpandRow, ExpandToggle, Pager, ErrorText, Empty, Loading, CodeBlock, StatusChip, fmt, StackedBars, DetailSection } from '@cp/ui';

const SELECTS = {
  status: ['all', '2xx', '4xx', '5xx'], source: ['all', 'internal', 'jagota', 'kbank', 'erp_webhook'],
  method: ['all', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'], sort: ['newest', 'slowest'],
} as const;

export function JoshApiLogs() {
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
      <PageHeader crumbs={['Josh', 'API Logs']} title="API log ของ josh" subtitle="อ่านอย่างเดียวจาก Mongo ของ josh (24 ชม. ล่าสุด, ย้อนได้สูงสุด 7 วัน) · ERP ที่ยิงเข้า josh ดูที่ &#34;ERP log ของ josh&#34;" actions={<button className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1 px-3 py-1.5 text-xs border border-secondary-container bg-surface-container-lowest hover:bg-surface-container-low text-on-surface" onClick={() => { stats.reload(); list.reload(); }}>Refresh</button>} />

      <Panel as="form">
        <PanelHead title="Filters" />
        <form className="space-y-3 px-4 py-3" onSubmit={(e) => { e.preventDefault(); set('q', draft.trim()); }}>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {Object.entries(SELECTS).map(([k, opts]) => (
              <select key={k} value={f[k]} onChange={(e) => set(k, e.target.value)} className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60">
                <option value="">{k}</option>
                {opts.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ))}
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="ค้นใน URL / message" className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60 lg:col-span-2" />
            <button className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1 px-3 py-1.5 text-xs bg-primary text-on-primary hover:bg-primary-dim border border-primary shadow-xs">ค้นหา</button>
          </div>
        </form>
      </Panel>

      <ErrorText error={stats.error || list.error} />

      {s && (
        <div className="grid md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <Panel>
              <PanelHead title="Requests per hour" sub={`${fmt.when(s.from)} – ${fmt.when(s.to)}`} />
              <div className="px-4 py-3">
                <StackedBars bars={s.buckets.map((b) => ({ label: new Date(b.start).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }), ok: b.count - b.errors, err: b.errors }))} height={120} />
              </div>
            </Panel>
          </div>

          <div>
            <Panel>
              <PanelHead title="Slowest routes" />
              {s.topEndpoints.length ? (
                <Table maxHeight="400px">
                  <THead>
                    <TH>Route</TH><TH right>ms</TH>
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
              ) : <Empty icon="trending_flat">No data</Empty>}
            </Panel>
          </div>
        </div>
      )}

      {list.data && (
        <Panel>
          <PanelHead title="Log entries" sub={`${list.data.total.toLocaleString()} requests`} />
          {list.data.items.length ? (
            <Table>
              <THead>
                <TH>เวลา</TH><TH>Method</TH><TH>URL</TH><TH>Status</TH><TH right>ms</TH><TH>ที่มา</TH><TH></TH>
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
                            {detail.data.errorMessage && <DetailSection title="Error"><ErrorText error={detail.data.errorMessage} /></DetailSection>}
                            {!!detail.data.steps.length && (
                              <DetailSection title="Timeline">
                                <div className="space-y-1">
                                  {detail.data.steps.map((st, i) => (
                                    <div key={i} className="text-[11px] text-on-surface flex justify-between">
                                      <span>{st.label}</span>
                                      <span className="font-mono text-on-surface-variant">{st.ms}ms</span>
                                    </div>
                                  ))}
                                </div>
                              </DetailSection>
                            )}
                            <DetailSection title="Payload">
                              <div className="grid md:grid-cols-2 gap-3">
                                <CodeBlock title="Request" value={{ query: detail.data.query, payload: detail.data.payload }} maxHeight={300} />
                                <CodeBlock title="Response" value={detail.data.response} maxHeight={300} />
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
          ) : <Empty>ไม่มี log ในช่วงนี้</Empty>}
          <Pager page={page} pageSize={list.data.limit} total={list.data.total} onPage={(p) => setF({ ...f, page: String(p) })} />
        </Panel>
      )}
    </Page>
  );
}
