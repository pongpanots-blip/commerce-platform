import { Fragment, useState } from 'react';
import {
  Button, CodeBlock, Empty, ErrorText, ExpandRow, ExpandToggle, Hint, Icon, Loading, Page, PageHeader, Panel, PanelHead, SectionTitle, Segmented, StatGrid, StatTile, StatusChip, Table, TBody, TD, TH, THead, TR, fmt,
} from '@cp/ui';
import { jagotaGatewayApi, jagotaHistoryApi, jagotaShadowApi } from '../../lib/api';
import { useAsync } from '../hooks';

const show = (v: unknown) => (v === undefined ? '—' : JSON.stringify(v));

/**
 * Step 1 of "orders reach Jagota through commerce": josh keeps sending as today; commerce rebuilds
 * each request josh sent and records whether its own would have been identical. Nothing is sent.
 */
export function JagotaShadow() {
  const [days, setDays] = useState(7);
  const [filter, setFilter] = useState('mismatched');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const summary = useAsync(() => jagotaShadowApi.summary(days), [days]);
  const list = useAsync(() => jagotaShadowApi.list(filter, page), [filter, page]);
  const detail = useAsync(() => (open ? jagotaShadowApi.detail(open) : Promise.resolve(null)), [open]);
  const s = summary.data;
  const refresh = () => { summary.reload(); list.reload(); };

  async function act(label: string, fn: () => Promise<unknown>, done: (r: never) => string) {
    setBusy(label); setMsg('');
    try { setMsg(done((await fn()) as never)); refresh(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  return (
    <Page>
      <PageHeader
        title="ส่ง order ผ่าน commerce · ทดลองคู่กัน"
        subtitle="josh ยังส่ง order ไป Jagota เหมือนเดิม · commerce สร้าง request ของ order เดียวกันแล้วเทียบกับที่ josh ส่งจริงทีละช่อง · ไม่ส่งอะไรไป ERP"
        actions={
          <>
            <Button variant="primary" disabled={!!busy} onClick={() => act('run', jagotaShadowApi.run, (r: { checked: number }) => `ตรวจเพิ่ม ${r.checked} รายการ`)}>{busy === 'run' ? 'กำลังตรวจ…' : 'ตรวจตอนนี้'}</Button>
            <Button icon="refresh" onClick={refresh}>Refresh</Button>
          </>
        }
      />

      {msg && <Hint>{msg}</Hint>}
      <ErrorText error={summary.error || list.error} />

      {s && (
        <>
          <SectionTitle>ตรวจ ({days} วัน)</SectionTitle>
          <StatGrid cols={4}>
            <StatTile
              label="ตรง"
              value={s.matchRate == null ? '—' : `${s.matchRate}%`}
              foot={`${s.matched} / ${s.checked} รายการ`}
              tone="ok"
            />
            <StatTile
              label="ไม่ตรง"
              value={fmt.num(s.mismatched)}
              tone={s.mismatched ? 'warn' : 'ok'}
            />
            <StatTile
              label="commerce สร้างไม่ได้"
              value={fmt.num(s.could_not_build)}
              tone={s.could_not_build ? 'danger' : 'ok'}
            />
            <StatTile
              label="ช่วงที่ตรวจ"
              value={
                <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface border border-secondary-container rounded-lg text-xs">
                  {[1, 7, 30].map((d) => <option key={d} value={d}>{d} วัน</option>)}
                </select>
              }
              foot={`${fmt.date(s.first_at)} – ${fmt.date(s.last_at)}`}
            />
          </StatGrid>

          {!!s?.topFields.length && (
            <Hint>ช่องที่ต่างบ่อย: {s.topFields.map((f) => `${f.field} (${f.n})`).join(' · ')}</Hint>
          )}
        </>
      )}

      <div className="space-y-3">
        <Segmented
          options={[
            { value: 'mismatched', label: 'ไม่ตรง / สร้างไม่ได้' },
            { value: 'matched', label: 'ตรง' },
            { value: 'all', label: 'ทั้งหมด' },
          ]}
          value={filter}
          onChange={(v) => { setFilter(v); setPage(1); }}
        />

        <Panel className="overflow-hidden">
          {list.loading && !list.data ? (
            <Loading />
          ) : !list.data?.items.length ? (
            <Empty>{filter === 'mismatched' ? 'ไม่มีรายการที่ไม่ตรง' : 'ยังไม่มีรายการ'}</Empty>
          ) : (
            <Table>
              <THead>
                <TH>Shipment / order</TH>
                <TH>josh ส่งเมื่อ</TH>
                <TH>ผล josh</TH>
                <TH>เทียบ</TH>
                <TH>ช่องที่ต่าง</TH>
                <TH></TH>
              </THead>
              <TBody>
                {list.data.items.map((c) => (
                  <Fragment key={c.id}>
                    <TR>
                      <TD kind="mono">{c.orderReference ?? '—'}</TD>
                      <TD kind="time">{fmt.when(c.joshSentAt)}</TD>
                      <TD>{c.joshSyncStatus}</TD>
                      <TD><StatusChip status={c.matched ? 'ok' : 'error'} /></TD>
                      <TD>
                        {c.diffs.map((d) => d.path).join(', ') || c.note || '—'}
                        {c.note && c.diffs.length > 0 && <div className="text-[10px] text-on-surface-variant">{c.note}</div>}
                      </TD>
                      <TD kind="actions" className="space-x-1">
                        <ExpandToggle open={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)} label={open === c.id ? 'ซ่อน' : 'ดู'} />
                        <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => act(c.joshSyncId, () => jagotaShadowApi.recheck(c.joshSyncId), (r: { matched: boolean }) => `ตรวจซ้ำ: ${r.matched ? 'ตรง' : 'ยังไม่ตรง'}`)}>ตรวจซ้ำ</Button>
                      </TD>
                    </TR>
                    {open === c.id && (
                      <ExpandRow colSpan={6}>
                        <ErrorText error={detail.error} />
                        {detail.loading ? (
                          <Loading />
                        ) : detail.data ? (
                          <div className="space-y-3">
                            {!!detail.data.diffs.length && (
                              <div>
                                <p className="text-xs font-semibold text-on-surface-variant mb-2">ช่องที่ต่าง</p>
                                <Table maxHeight="240px">
                                  <THead>
                                    <TH>ช่อง</TH>
                                    <TH>josh ส่ง</TH>
                                    <TH>commerce จะส่ง</TH>
                                  </THead>
                                  <TBody>
                                    {detail.data.diffs.map((d) => (
                                      <TR key={d.path}>
                                        <TD kind="mono">{d.path}</TD>
                                        <TD kind="mono" className="bg-error-container/20">{show(d.josh)}</TD>
                                        <TD kind="mono" className="bg-ok-container/20">{show(d.commerce)}</TD>
                                      </TR>
                                    ))}
                                  </TBody>
                                </Table>
                              </div>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <CodeBlock title="josh ส่งไป Jagota" value={detail.data.joshRequest} maxHeight={280} />
                              <CodeBlock title="commerce จะส่ง" value={detail.data.commerceRequest} maxHeight={280} />
                            </div>
                          </div>
                        ) : null}
                      </ExpandRow>
                    )}
                  </Fragment>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>
      </div>

      <GatewaySends />
      <SyncHistory />
    </Page>
  );
}

/**
 * Step 2: orders josh routes through commerce (josh JAGOTA_VIA_COMMERCE_BRANCHES) — what commerce
 * sent to Jagota, one row per order reference. Empty until josh routes a branch here.
 */
function GatewaySends() {
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const summary = useAsync(() => jagotaGatewayApi.summary(7), []);
  const list = useAsync(() => jagotaGatewayApi.list(status, 1), [status]);
  const detail = useAsync(() => (open ? jagotaGatewayApi.detail(open) : Promise.resolve(null)), [open]);
  const s = summary.data;
  return (
    <div className="pt-6">
      <SectionTitle>ส่งจริงผ่าน commerce</SectionTitle>

      <ErrorText error={summary.error || list.error} />

      {s && (
        <>
          <StatGrid cols={4}>
            <StatTile
              label="ส่งสำเร็จ (7 วัน)"
              value={fmt.num(s.sent)}
              foot={`จาก ${fmt.num(s.total)} รายการ`}
              tone={s.failed ? 'warn' : 'ok'}
            />
            <StatTile
              label="ล้มเหลว"
              value={fmt.num(s.failed)}
              foot="josh จะลองใหม่เอง"
              tone={s.failed ? 'danger' : 'ok'}
            />
            <StatTile
              label="ส่งมากกว่า 1 ครั้ง"
              value={fmt.num(s.retried)}
            />
            <StatTile
              label="เวลาเฉลี่ย"
              value={s.avg_ms == null ? '—' : `${(s.avg_ms / 1000).toFixed(1)}s`}
              foot={`ล่าสุด ${fmt.ago(s.last_at)}`}
            />
          </StatGrid>
        </>
      )}

      <div className="space-y-3">
        <Segmented
          options={[
            { value: '', label: 'ทั้งหมด' },
            { value: 'failed', label: 'ล้มเหลว' },
            { value: 'sent', label: 'สำเร็จ' },
            { value: 'sending', label: 'กำลังส่ง' },
          ]}
          value={status}
          onChange={setStatus}
        />

        <Panel className="overflow-hidden">
          {list.loading && !list.data ? (
            <Loading />
          ) : !list.data?.items.length ? (
            <Empty>ยังไม่มี order ที่ส่งผ่าน commerce</Empty>
          ) : (
            <Table>
              <THead>
                <TH>Shipment / order</TH>
                <TH>สถานะ</TH>
                <TH>ครั้ง</TH>
                <TH kind="mono">DOC</TH>
                <TH right>เวลา</TH>
                <TH right>ล่าสุด</TH>
                <TH>ข้อผิดพลาด</TH>
                <TH></TH>
              </THead>
              <TBody>
                {list.data.items.map((r) => (
                  <Fragment key={r.id}>
                    <TR>
                      <TD kind="mono">{r.orderReference}</TD>
                      <TD><StatusChip status={r.status} /></TD>
                      <TD>{r.attempts}</TD>
                      <TD kind="mono">{r.docNo ? `${r.docBook}/${r.docNo}` : '—'}</TD>
                      <TD kind="num">{r.durationMs == null ? '—' : `${(r.durationMs / 1000).toFixed(1)}s`}</TD>
                      <TD kind="time">{fmt.when(r.updatedAt)}</TD>
                      <TD>{r.lastError ?? '—'}</TD>
                      <TD kind="actions">
                        <ExpandToggle open={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)} label={open === r.id ? 'ซ่อน' : 'ดู'} />
                      </TD>
                    </TR>
                    {open === r.id && (
                      <ExpandRow colSpan={8}>
                        <ErrorText error={detail.error} />
                        {detail.loading ? (
                          <Loading />
                        ) : detail.data ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <CodeBlock title="ส่งไป Jagota" value={detail.data.request} maxHeight={280} />
                            <CodeBlock title="Jagota ตอบ" value={detail.data.response} maxHeight={280} />
                          </div>
                        ) : null}
                      </ExpandRow>
                    )}
                  </Fragment>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>
      </div>
    </div>
  );
}

/**
 * Step 3: josh's ERP send history (`jagota_order_sync`) copied into commerce, so it survives josh
 * being down. Filled by CRON_JAGOTA_SYNC_IMPORT_ENABLED or the import button; reads josh only.
 */
function SyncHistory() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const summary = useAsync(() => jagotaHistoryApi.summary(7), [msg]);
  const list = useAsync(() => jagotaHistoryApi.list({ status, q: search, page }), [status, search, page, msg]);
  const detail = useAsync(() => (open ? jagotaHistoryApi.detail(open) : Promise.resolve(null)), [open]);
  const s = summary.data;
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / 50)) : 1;

  async function importNow() {
    setBusy(true);
    try { const r = await jagotaHistoryApi.run(); setMsg(`ดึงใหม่ ${r.added} รายการ · อัปเดต ${r.refreshed} รายการล่าสุด`); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="pt-6">
      <div className="flex items-center justify-between mb-3">
        <SectionTitle>ประวัติส่ง ERP (สำเนาจาก josh)</SectionTitle>
        <Button size="sm" variant="secondary" disabled={busy} onClick={importNow}>{busy ? 'กำลังดึง…' : 'ดึงจาก josh ตอนนี้'}</Button>
      </div>

      {msg && <Hint>{msg}</Hint>}
      <ErrorText error={summary.error || list.error} />

      {s && s.byStatus.length > 0 && (
        <StatGrid cols={Math.min(4, s.byStatus.length)}>
          {s.byStatus.map((b) => (
            <StatTile
              key={b.sync_status}
              label={`${b.sync_status} (7 วัน)`}
              value={fmt.num(b.n)}
              tone={b.sync_status === 'failed' && b.n ? 'danger' : 'ok'}
            />
          ))}
        </StatGrid>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            options={[
              { value: '', label: 'ทั้งหมด' },
              { value: 'failed', label: 'ล้มเหลว' },
              { value: 'sent', label: 'ส่งแล้ว' },
              { value: 'pending', label: 'รอส่ง' },
            ]}
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
          />
          <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); setPage(1); }}>
            <div className="flex-1">
              <input
                aria-label="ค้นหาเลข order หรือเลขเอกสาร ERP"
                placeholder="เลข order / DOC no."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs"
              />
            </div>
            <Button size="sm" variant="secondary" type="submit">ค้นหา</Button>
          </form>
        </div>

        <Panel className="overflow-hidden">
          {list.loading && !list.data ? (
            <Loading />
          ) : !list.data?.items.length ? (
            <Empty>{s?.total ? 'ไม่พบรายการ' : 'ยังไม่ได้ดึงประวัติจาก josh'}</Empty>
          ) : (
            <Table>
              <THead>
                <TH>Order</TH>
                <TH>สถานะ</TH>
                <TH>ชำระ</TH>
                <TH kind="mono">DOC</TH>
                <TH>ส่งเมื่อ</TH>
                <TH>ข้อผิดพลาด</TH>
                <TH></TH>
              </THead>
              <TBody>
                {list.data.items.map((r) => (
                  <Fragment key={r.id}>
                    <TR>
                      <TD kind="mono">
                        {r.orderNumber ?? r.orderId}
                        {r.shipmentId && <div className="text-[10px] text-on-surface-variant">shipment</div>}
                      </TD>
                      <TD><StatusChip status={r.syncStatus} /></TD>
                      <TD>{r.paymentMethod}{r.paymentSuccess ? ' ✓' : ''}</TD>
                      <TD kind="mono">{r.docNo ? `${r.docBook}/${r.docNo}` : '—'}</TD>
                      <TD kind="time">{fmt.when(r.createdAt)}</TD>
                      <TD>{r.errorMessage ?? '—'}</TD>
                      <TD kind="actions">
                        <ExpandToggle open={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)} label={open === r.id ? 'ซ่อน' : 'ดู'} />
                      </TD>
                    </TR>
                    {open === r.id && (
                      <ExpandRow colSpan={7}>
                        <ErrorText error={detail.error} />
                        {detail.loading ? (
                          <Loading />
                        ) : detail.data ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <CodeBlock title="josh ส่ง" value={detail.data.requestJson} maxHeight={280} />
                            <CodeBlock title="Jagota ตอบ" value={detail.data.jagotaResponseJson} maxHeight={280} />
                          </div>
                        ) : null}
                      </ExpandRow>
                    )}
                  </Fragment>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>

        {pages > 1 && (
          <div className="flex items-center gap-3 justify-center py-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</Button>
            <Hint>หน้า {page} / {pages}</Hint>
            <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>ถัดไป</Button>
          </div>
        )}
      </div>
    </div>
  );
}
