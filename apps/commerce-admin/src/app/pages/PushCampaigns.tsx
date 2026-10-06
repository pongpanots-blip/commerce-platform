import { Fragment, useState } from 'react';
import { Button, Empty, ErrorText, ExpandRow, ExpandToggle, Loading, Page, PageHeader, Panel, PanelHead, StatGrid, StatTile, Table, TBody, TD, TH, THead, TR, fmt } from '@cp/ui';
import { pushCampaignApi } from '../../lib/api';
import { useAsync } from '../hooks';

const STATUS: Record<string, string> = { draft: 'ร่าง', scheduled: 'ตั้งเวลาแล้ว', sending: 'กำลังส่ง', sent: 'ส่งแล้ว', failed: 'ล้มเหลว', cancelled: 'ยกเลิก' };
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const when = (v: string | null) => (v ? new Date(v).toLocaleString('th-TH') : '—');
const audience = (a: { include: Record<string, string[]> }) =>
  Object.entries(a.include ?? {}).filter(([, v]) => v?.length).map(([k, v]) => `${{ userIds: 'ผู้ใช้', companyIds: 'บริษัท', segmentIds: 'segment' }[k] ?? k} ${v.length}`).join(' · ') || '—';

/** josh push campaigns, read-only: what was sent and how it landed. Creating and sending stay in josh admin. */
export function PushCampaigns() {
  const overview = useAsync(() => pushCampaignApi.overview(), []);
  const list = useAsync(() => pushCampaignApi.list(), []);
  const [open, setOpen] = useState<string | null>(null);
  const detail = useAsync(() => (open ? pushCampaignApi.delivery(open) : Promise.resolve(null)), [open]);
  const o = overview.data;

  return (
    <Page>
      <PageHeader
        title="Push campaigns"
        subtitle="แคมเปญแจ้งเตือนที่ส่งจาก josh และผลการส่งจริงแต่ละช่องทาง · ดูอย่างเดียว — สร้าง/ส่งยังทำที่ josh admin"
        actions={<Button icon="refresh" onClick={() => { overview.reload(); list.reload(); }}>Refresh</Button>}
      />

      <ErrorText error={overview.error || list.error} />

      {o && (
        <StatGrid>
          <StatTile label="แคมเปญ" value={fmt.num(o.campaigns)} tone="info" />
          <StatTile label="รอส่ง (ตั้งเวลา)" value={fmt.num(o.scheduled)} tone="warn" />
          <StatTile label="ส่งวันนี้" value={fmt.num(o.sentToday)} tone="info" />
          <StatTile label="ส่งสำเร็จรวม" value={fmt.num(o.totalSent)} tone="ok" foot={`จาก ${fmt.num(o.totalQueued)} คน`} />
        </StatGrid>
      )}

      <Panel className="overflow-hidden">
        {list.data?.length ? (
          <Table>
            <THead>
              <TH>แคมเปญ</TH>
              <TH>สถานะ</TH>
              <TH>กลุ่มเป้าหมาย</TH>
              <TH right>ส่ง / ข้าม / พลาด</TH>
              <TH>เวลา</TH>
              <TH className="w-12" />
            </THead>
            <TBody>
              {list.data.map((c) => (
                <Fragment key={c.id}>
                  <TR>
                    <TD>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-[10px] text-on-surface-variant">{c.title}{c.ab_enabled ? ' · A/B' : ''}</div>
                    </TD>
                    <TD>
                      <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#e7f5ec] text-[#157347]">{STATUS[c.status] ?? c.status}</div>
                      {c.last_error && <div className="text-[10px] text-[#c2333f] mt-1">{c.last_error}</div>}
                    </TD>
                    <TD kind="muted">{audience(c.audience)}</TD>
                    <TD kind="num">{c.stats.sent} / {c.stats.skipped} / {c.stats.failed}</TD>
                    <TD kind="time">{c.status === 'scheduled' ? `จะส่ง ${when(c.scheduled_at)}` : when(c.sent_at ?? c.created_at)}</TD>
                    <TD className="text-right">
                      {c.status === 'sent' && (
                        <ExpandToggle open={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)} label="ผลการส่ง" />
                      )}
                    </TD>
                  </TR>
                  {open === c.id && (
                    <ExpandRow colSpan={6}>
                      {detail.error ? (
                        <div className="text-sm text-red-600">{detail.error}</div>
                      ) : !detail.data ? (
                        <Loading />
                      ) : !detail.data.deliveryStats ? (
                        <div className="text-xs text-on-surface-variant">{detail.data.note}</div>
                      ) : (
                        <div className="space-y-3">
                          <div className="text-xs text-on-surface-variant">
                            ส่งถึง {pct(detail.data.deliveryStats.totals.deliveryRate)} · คลิก {detail.data.deliveryStats.totals.clicked} ({pct(detail.data.deliveryStats.totals.clickRate)})
                          </div>
                          <Table>
                            <THead>
                              <TH>ช่องทาง</TH>
                              <TH right>พยายาม</TH>
                              <TH right>สำเร็จ</TH>
                              <TH right>ข้าม</TH>
                              <TH right>พลาด</TH>
                              <TH right>คลิก</TH>
                            </THead>
                            <TBody>
                              {detail.data.deliveryStats.byTypeChannel.map((r) => (
                                <TR key={r.channel}>
                                  <TD kind="muted">{r.channel}</TD>
                                  <TD kind="num">{r.attempted}</TD>
                                  <TD kind="num">{r.sent}</TD>
                                  <TD kind="num">{r.skipped}</TD>
                                  <TD kind="num">{r.failed}</TD>
                                  <TD kind="num">{r.clicked} ({pct(r.clickRate)})</TD>
                                </TR>
                              ))}
                            </TBody>
                          </Table>
                          {!!detail.data.deliveryStats.topSkipAndFailReasons.length && (
                            <div className="text-xs text-on-surface-variant">
                              เหตุผลที่ข้าม/พลาด: {detail.data.deliveryStats.topSkipAndFailReasons.map((r) => `${r.reason} (${r.count})`).join(', ')}
                            </div>
                          )}
                        </div>
                      )}
                    </ExpandRow>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
        ) : (
          <div className="px-4 py-8">{list.loading ? <Loading /> : <Empty icon="mail">ยังไม่มีแคมเปญ</Empty>}</div>
        )}
      </Panel>
    </Page>
  );
}
