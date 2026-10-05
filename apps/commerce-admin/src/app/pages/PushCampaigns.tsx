import { Fragment, useState } from 'react';
import { pushCampaignApi } from '../../lib/api';
import { statusBadgeClass, useAsync } from '../hooks';

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
    <div>
      <div className="page-head">
        <div>
          <h1>Push campaigns</h1>
          <p>แคมเปญแจ้งเตือนที่ส่งจาก josh และผลการส่งจริงแต่ละช่องทาง · ดูอย่างเดียว — สร้าง/ส่งยังทำที่ josh admin</p>
        </div>
        <button className="btn ghost" onClick={() => { overview.reload(); list.reload(); }}>Refresh</button>
      </div>
      {(overview.error || list.error) && <div className="err">{overview.error || list.error}</div>}
      {o && (
        <div className="stat-grid">
          <div className="stat"><div className="label">แคมเปญ</div><div className="value">{o.campaigns}</div></div>
          <div className="stat"><div className="label">รอส่ง (ตั้งเวลา)</div><div className="value">{o.scheduled}</div></div>
          <div className="stat"><div className="label">ส่งวันนี้</div><div className="value">{o.sentToday}</div></div>
          <div className="stat"><div className="label">ส่งสำเร็จรวม</div><div className="value">{o.totalSent}</div><div className="hint">จาก {o.totalQueued} คน</div></div>
        </div>
      )}
      <div className="panel" style={{ marginTop: 16 }}>
        {list.data?.length ? (
          <table>
            <thead><tr><th>แคมเปญ</th><th>สถานะ</th><th>กลุ่มเป้าหมาย</th><th>ส่ง / ข้าม / พลาด</th><th>เวลา</th><th></th></tr></thead>
            <tbody>
              {list.data.map((c) => (
                <Fragment key={c.id}>
                  <tr>
                    <td>{c.name}<div className="hint">{c.title}{c.ab_enabled ? ' · A/B' : ''}</div></td>
                    <td><span className={statusBadgeClass(c.status === 'sent' ? 'completed' : c.status)}>{STATUS[c.status] ?? c.status}</span>
                      {c.last_error && <div className="hint" style={{ color: 'var(--danger)' }}>{c.last_error}</div>}</td>
                    <td>{audience(c.audience)}</td>
                    <td>{c.stats.sent} / {c.stats.skipped} / {c.stats.failed}</td>
                    <td>{c.status === 'scheduled' ? `จะส่ง ${when(c.scheduled_at)}` : when(c.sent_at ?? c.created_at)}</td>
                    <td>{c.status === 'sent' && <button className="btn ghost sm" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'ซ่อน' : 'ผลการส่ง'}</button>}</td>
                  </tr>
                  {open === c.id && (
                    <tr><td colSpan={6}>
                      {detail.error ? <div className="err">{detail.error}</div> : !detail.data ? 'Loading…' : !detail.data.deliveryStats ? <div className="hint">{detail.data.note}</div> : (
                        <div>
                          <div className="hint">ส่งถึง {pct(detail.data.deliveryStats.totals.deliveryRate)} · คลิก {detail.data.deliveryStats.totals.clicked} ({pct(detail.data.deliveryStats.totals.clickRate)})</div>
                          <table>
                            <thead><tr><th>ช่องทาง</th><th>พยายาม</th><th>สำเร็จ</th><th>ข้าม</th><th>พลาด</th><th>คลิก</th></tr></thead>
                            <tbody>{detail.data.deliveryStats.byTypeChannel.map((r) => (
                              <tr key={r.channel}><td>{r.channel}</td><td>{r.attempted}</td><td>{r.sent}</td><td>{r.skipped}</td><td>{r.failed}</td><td>{r.clicked} ({pct(r.clickRate)})</td></tr>
                            ))}</tbody>
                          </table>
                          {!!detail.data.deliveryStats.topSkipAndFailReasons.length && (
                            <div className="hint" style={{ marginTop: 6 }}>เหตุผลที่ข้าม/พลาด: {detail.data.deliveryStats.topSkipAndFailReasons.map((r) => `${r.reason} (${r.count})`).join(', ')}</div>
                          )}
                        </div>
                      )}
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">{list.loading ? 'Loading…' : 'ยังไม่มีแคมเปญ'}</div>}
      </div>
    </div>
  );
}
