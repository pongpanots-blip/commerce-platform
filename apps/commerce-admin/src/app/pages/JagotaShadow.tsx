// ui-metadata-migration: static labels and UI notices only
import { Fragment, useState } from 'react';
import {
  Button, Chip, CodeBlock, Empty, ErrorText, ExpandRow, ExpandToggle, Hint, Icon, Input, Loading, Page, PageHeader, Panel, PanelHead, SectionTitle, Segmented, Select, StatGrid, StatTile, StatusChip, Table, Tone, TBody, TD, TH, THead, TR, fmt,
} from '@cp/ui';
import { jagotaGatewayApi, jagotaHistoryApi, jagotaShadowApi } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const show = (v: unknown) => (v === undefined ? '—' : JSON.stringify(v));
/** Send states the shared status chip has no label for. Filter values stay the raw codes. */
const SEND_STATUS: Record<string, [Tone, string]> = { sent: ['ok', 'ส่งแล้ว'], sending: ['warn', 'กำลังส่ง'] };
const sendStatusLabel = (st: string) => (SEND_STATUS[st] ? __uiText(SEND_STATUS[st][1]) : st);
function SendStatus({ status }: { status: string | null | undefined }) {
  const known = status ? SEND_STATUS[status] : undefined;
  return known ? <Chip tone={known[0]} dot>{__uiText(known[1])}</Chip> : <StatusChip status={status} />;
}

/**
 * Step 1 of "orders reach Jagota through commerce": josh keeps sending as today; commerce rebuilds
 * each request josh sent and records whether its own would have been identical. Nothing is sent.
 */
export function JagotaShadow() {
  __useUiLocale();
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
        title={__uiText("ทดลองส่งออเดอร์เข้าระบบหลัก (ERP)")}
        subtitle={__uiText("ทดลองส่งคำสั่งซื้อเข้าระบบหลัก (ERP) ผ่านระบบใหม่ ก่อนเปิดใช้จริง")}
        actions={
          <>
            <Button variant="primary" disabled={!!busy} onClick={() => act('run', jagotaShadowApi.run, (r: { checked: number }) => __uiText('ตรวจเพิ่ม {0} รายการ', { 0: r.checked }))}>{busy === 'run' ? __uiText("กำลังตรวจ…") : __uiText("ตรวจตอนนี้")}</Button>
            <Button icon="refresh" onClick={refresh}>{__uiText("Refresh")}</Button>
          </>
        }
      />

      <Hint>{__uiText("ร้านค้ายังส่งออเดอร์ไป Jagota เหมือนเดิม ระบบใหม่สร้างคำขอของออเดอร์เดียวกันแล้วเทียบกับที่ร้านค้าส่งจริงทีละช่อง ส่วนนี้ไม่ส่งอะไรไปที่ระบบหลัก")}</Hint>
      {msg && <Hint>{(typeof msg === 'string' ? __uiText(msg) : msg)}</Hint>}
      <ErrorText error={summary.error || list.error} />

      {s && (
        <>
          <SectionTitle>{__uiText("ผลการเทียบ {0} วัน", { 0: days })}</SectionTitle>
          <StatGrid cols={4}>
            <StatTile
              label={__uiText("ตรง")}
              value={s.matchRate == null ? '—' : `${s.matchRate}%`}
              foot={__uiText("{0} / {1} รายการ",{'0':s.matched,'1':s.checked})}
              tone="ok"
            />
            <StatTile
              label={__uiText("ไม่ตรง")}
              value={fmt.num(s.mismatched)}
              tone={s.mismatched ? 'warn' : 'ok'}
            />
            <StatTile
              label={__uiText("ระบบใหม่สร้างไม่ได้")}
              value={fmt.num(s.could_not_build)}
              tone={s.could_not_build ? 'danger' : 'ok'}
            />
            <StatTile
              label={__uiText("ช่วงที่ตรวจ")}
              value={
                <Select aria-label={__uiText("ช่วงที่ตรวจ")} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {[1, 7, 30].map((d) => <option key={d} value={d}>{d} {__uiText(" วัน")}</option>)}
                </Select>
              }
              foot={__uiText("{0} – {1}",{'0':fmt.date(s.first_at),'1':fmt.date(s.last_at)})}
            />
          </StatGrid>

          {!!s?.topFields.length && (
            <Hint>{__uiText("ช่องที่ต่างบ่อย: ")}{s.topFields.map((f) => `${f.field} (${f.n})`).join(' · ')}</Hint>
          )}
        </>
      )}

      <div className="space-y-3">
        <Segmented
          options={[
            { value: 'mismatched', label: __uiText("ไม่ตรง / สร้างไม่ได้") },
            { value: 'matched', label: __uiText("ตรง") },
            { value: 'all', label: __uiText("ทั้งหมด") },
          ]}
          value={filter}
          onChange={(v) => { setFilter(v); setPage(1); }}
        />

        <Panel className="overflow-hidden">
          {list.loading && !list.data ? (
            <Loading />
          ) : !list.data?.items.length ? (
            <Empty>{filter === 'mismatched' ? __uiText("ไม่มีรายการที่ไม่ตรง") : __uiText("ยังไม่มีรายการ")}</Empty>
          ) : (
            <Table>
              <THead>
                <TH>{__uiText("เลขออเดอร์หรือการจัดส่ง")}</TH>
                <TH>{__uiText("ร้านค้าส่งเมื่อ")}</TH>
                <TH>{__uiText("ผลที่ร้านค้าได้")}</TH>
                <TH>{__uiText("เทียบ")}</TH>
                <TH>{__uiText("ช่องที่ต่าง")}</TH>
                <TH></TH>
              </THead>
              <TBody>
                {list.data.items.map((c) => (
                  <Fragment key={c.id}>
                    <TR>
                      <TD kind="mono">{c.orderReference ?? '—'}</TD>
                      <TD kind="time">{fmt.when(c.joshSentAt)}</TD>
                      <TD><SendStatus status={c.joshSyncStatus} /></TD>
                      <TD>{c.matched ? <Chip tone="ok" dot>{__uiText('ตรง')}</Chip> : <Chip tone="warn" dot>{__uiText('ไม่ตรง')}</Chip>}</TD>
                      <TD className="font-mono text-[11px]">
                        {c.diffs.map((d) => d.path).join(', ') || c.note || '—'}
                        {c.note && c.diffs.length > 0 && <div className="text-[10px] text-on-surface-variant">{c.note}</div>}
                      </TD>
                      <TD kind="actions" className="space-x-1">
                        <ExpandToggle open={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)} label={open === c.id ? __uiText("ซ่อน") : __uiText("ดู")} />
                        <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => act(c.joshSyncId, () => jagotaShadowApi.recheck(c.joshSyncId), (r: { matched: boolean }) => __uiText(r.matched ? 'ตรวจซ้ำแล้ว: ตรง' : 'ตรวจซ้ำแล้ว: ยังไม่ตรง'))}>{__uiText("ตรวจซ้ำ")}</Button>
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
                                <p className="text-xs font-semibold text-on-surface-variant mb-2">{__uiText("ช่องที่ต่าง")}</p>
                                <Table maxHeight="240px">
                                  <THead>
                                    <TH>{__uiText("ช่อง")}</TH>
                                    <TH>{__uiText("ร้านค้าส่ง")}</TH>
                                    <TH>{__uiText("ระบบใหม่จะส่ง")}</TH>
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
                              <CodeBlock title={__uiText("ร้านค้าส่งไป Jagota")} value={detail.data.joshRequest} maxHeight={280} />
                              <CodeBlock title={__uiText("ระบบใหม่จะส่ง")} value={detail.data.commerceRequest} maxHeight={280} />
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
  __useUiLocale();
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const summary = useAsync(() => jagotaGatewayApi.summary(7), []);
  const list = useAsync(() => jagotaGatewayApi.list(status, 1), [status]);
  const detail = useAsync(() => (open ? jagotaGatewayApi.detail(open) : Promise.resolve(null)), [open]);
  const s = summary.data;
  return (
    <div className="pt-6">
      <SectionTitle>{__uiText("ส่งจริงผ่านระบบใหม่")}</SectionTitle>

      <ErrorText error={summary.error || list.error} />

      {s && (
        <>
          <StatGrid cols={4}>
            <StatTile
              label={__uiText("ส่งสำเร็จ (7 วัน)")}
              value={fmt.num(s.sent)}
              foot={__uiText("จาก {0} รายการ",{'0':fmt.num(s.total)})}
              tone={s.failed ? 'warn' : 'ok'}
            />
            <StatTile
              label={__uiText("ล้มเหลว")}
              value={fmt.num(s.failed)}
              foot={__uiText("ร้านค้าจะลองส่งใหม่เอง")}
              tone={s.failed ? 'danger' : 'ok'}
            />
            <StatTile
              label={__uiText("ส่งมากกว่า 1 ครั้ง")}
              value={fmt.num(s.retried)}
            />
            <StatTile
              label={__uiText("เวลาเฉลี่ย")}
              value={s.avg_ms == null ? '—' : `${(s.avg_ms / 1000).toFixed(1)}s`}
              foot={__uiText("ล่าสุด {0}",{'0':fmt.ago(s.last_at)})}
            />
          </StatGrid>
        </>
      )}

      <div className="space-y-3">
        <Segmented
          options={[
            { value: '', label: __uiText("ทั้งหมด") },
            { value: 'failed', label: __uiText("ล้มเหลว") },
            { value: 'sent', label: __uiText("สำเร็จ") },
            { value: 'sending', label: __uiText("กำลังส่ง") },
          ]}
          value={status}
          onChange={setStatus}
        />

        <Panel className="overflow-hidden">
          {list.loading && !list.data ? (
            <Loading />
          ) : !list.data?.items.length ? (
            <Empty>{__uiText("ยังไม่มีออเดอร์ที่ส่งผ่านระบบใหม่ รายการจะแสดงเมื่อเปิดให้สาขาส่งผ่านระบบใหม่")}</Empty>
          ) : (
            <Table>
              <THead>
                <TH>{__uiText("เลขออเดอร์หรือการจัดส่ง")}</TH>
                <TH>{__uiText("สถานะ")}</TH>
                <TH right>{__uiText("ครั้ง")}</TH>
                <TH kind="mono">{__uiText("เลขเอกสาร")}</TH>
                <TH right>{__uiText("เวลาที่ใช้")}</TH>
                <TH right>{__uiText("ล่าสุด")}</TH>
                <TH>{__uiText("ข้อผิดพลาด")}</TH>
                <TH></TH>
              </THead>
              <TBody>
                {list.data.items.map((r) => (
                  <Fragment key={r.id}>
                    <TR>
                      <TD kind="mono">{r.orderReference}</TD>
                      <TD><SendStatus status={r.status} /></TD>
                      <TD kind="num">{fmt.num(r.attempts)}</TD>
                      <TD kind="mono">{r.docNo ? `${r.docBook}/${r.docNo}` : '—'}</TD>
                      <TD kind="num">{r.durationMs == null ? '—' : __uiText("{0}s", {"0": (r.durationMs / 1000).toFixed(1)})}</TD>
                      <TD kind="time">{fmt.when(r.updatedAt)}</TD>
                      <TD>{r.lastError ?? '—'}</TD>
                      <TD kind="actions">
                        <ExpandToggle open={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)} label={open === r.id ? __uiText("ซ่อน") : __uiText("ดู")} />
                      </TD>
                    </TR>
                    {open === r.id && (
                      <ExpandRow colSpan={8}>
                        <ErrorText error={detail.error} />
                        {detail.loading ? (
                          <Loading />
                        ) : detail.data ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <CodeBlock title={__uiText("ส่งไป Jagota")} value={detail.data.request} maxHeight={280} />
                            <CodeBlock title={__uiText("Jagota ตอบ")} value={detail.data.response} maxHeight={280} />
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
  __useUiLocale();
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
    try { const r = await jagotaHistoryApi.run(); setMsg(__uiMessage("ดึงใหม่ {0} รายการ · อัปเดต {1} รายการล่าสุด", {"0": r.added, "1": r.refreshed})); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="pt-6">
      <div className="flex items-center justify-between mb-3">
        <SectionTitle>{__uiText("ประวัติการส่งเข้าระบบหลัก (ERP) ที่คัดลอกจากร้านค้า")}</SectionTitle>
        <Button size="sm" variant="secondary" disabled={busy} onClick={importNow}>{busy ? __uiText("กำลังดึง…") : __uiText("ดึงจากร้านค้าตอนนี้")}</Button>
      </div>

      {msg && <Hint>{(typeof msg === 'string' ? __uiText(msg) : msg)}</Hint>}
      <ErrorText error={summary.error || list.error} />

      {s && s.byStatus.length > 0 && (
        <StatGrid cols={Math.min(4, s.byStatus.length)}>
          {s.byStatus.map((b) => (
            <StatTile
              key={b.sync_status}
              label={__uiText("{0} (7 วัน)", {"0": sendStatusLabel(b.sync_status)})}
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
              { value: '', label: __uiText("ทั้งหมด") },
              { value: 'failed', label: __uiText("ล้มเหลว") },
              { value: 'sent', label: __uiText("ส่งแล้ว") },
              { value: 'pending', label: __uiText("รอส่ง") },
            ]}
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
          />
          <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); setPage(1); }}>
            <div className="flex-1">
              <Input
                aria-label={__uiText("ค้นหาเลขออเดอร์หรือเลขเอกสารระบบหลัก")}
                placeholder={__uiText("เลขออเดอร์หรือเลขเอกสาร")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Button size="sm" variant="secondary" type="submit">{__uiText("ค้นหา")}</Button>
          </form>
        </div>

        <Panel className="overflow-hidden">
          {list.loading && !list.data ? (
            <Loading />
          ) : !list.data?.items.length ? (
            <Empty>{s?.total ? __uiText("ไม่พบรายการ") : __uiText("ยังไม่ได้ดึงประวัติจากร้านค้า กด “ดึงจากร้านค้าตอนนี้” เพื่อเริ่ม")}</Empty>
          ) : (
            <Table>
              <THead>
                <TH>{__uiText("เลขออเดอร์")}</TH>
                <TH>{__uiText("สถานะ")}</TH>
                <TH>{__uiText("ชำระ")}</TH>
                <TH kind="mono">{__uiText("เลขเอกสาร")}</TH>
                <TH>{__uiText("ส่งเมื่อ")}</TH>
                <TH>{__uiText("ข้อผิดพลาด")}</TH>
                <TH></TH>
              </THead>
              <TBody>
                {list.data.items.map((r) => (
                  <Fragment key={r.id}>
                    <TR>
                      <TD kind="mono">
                        {r.orderNumber ?? r.orderId}
                        {r.shipmentId && <div className="text-[10px] text-on-surface-variant">{__uiText("การจัดส่ง")}</div>}
                      </TD>
                      <TD><SendStatus status={r.syncStatus} /></TD>
                      <TD><span className="font-mono text-[11px]">{r.paymentMethod}</span>{r.paymentSuccess && <Chip tone="ok" className="ml-1">{__uiText('ชำระแล้ว')}</Chip>}</TD>
                      <TD kind="mono">{r.docNo ? `${r.docBook}/${r.docNo}` : '—'}</TD>
                      <TD kind="time">{fmt.when(r.createdAt)}</TD>
                      <TD>{r.errorMessage ?? '—'}</TD>
                      <TD kind="actions">
                        <ExpandToggle open={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)} label={open === r.id ? __uiText("ซ่อน") : __uiText("ดู")} />
                      </TD>
                    </TR>
                    {open === r.id && (
                      <ExpandRow colSpan={7}>
                        <ErrorText error={detail.error} />
                        {detail.loading ? (
                          <Loading />
                        ) : detail.data ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <CodeBlock title={__uiText("ร้านค้าส่ง")} value={detail.data.requestJson} maxHeight={280} />
                            <CodeBlock title={__uiText("Jagota ตอบ")} value={detail.data.jagotaResponseJson} maxHeight={280} />
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
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{__uiText("ก่อนหน้า")}</Button>
            <Hint>{__uiText("หน้า ")}{page} / {pages}</Hint>
            <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>{__uiText("ถัดไป")}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
