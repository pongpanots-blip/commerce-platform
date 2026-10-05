import { winbackApi } from '../../lib/api';
import { useAsync } from '../hooks';

const baht = (n: number | null | undefined) => (n == null ? '—' : '฿' + Math.round(Number(n)).toLocaleString('th-TH'));
const STAGE: Record<string, string> = {
  prospect: 'prospect', inactivePool: 'inactive pool', inactive_pool: 'inactive pool', contacted: 'ติดต่อแล้ว', appointment: 'นัดหมาย', negotiate: 'เจรจา',
  interested: 'สนใจ', signed: 'เซ็นแล้ว', won: 'ปิดได้', reactivated: 'กลับมาสั่ง', orderingAgain: 'สั่งซ้ำ', ordering_again: 'สั่งซ้ำ', rejected: 'ปฏิเสธ', lost: 'เสีย',
};
/** josh camelCases every key, map keys included: stage `inactive_pool` is keyed `inactivePool` in stageMedianDays. */
const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const days = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

/** josh winback (sales win-back CRM), manager view — read from josh's replica by josh's own report code. Reps keep using the sales app on josh. */
export function Winback() {
  const overview = useAsync(() => winbackApi.overview(), []);
  const team = useAsync(() => winbackApi.teamStats(), []);
  const dash = useAsync(() => winbackApi.dashboard(), []);
  const score = useAsync(() => winbackApi.scorecard(), []);
  const signals = useAsync(() => winbackApi.leadSignals(), []);
  const o = overview.data?.data;
  const d = dash.data?.data;
  const s = score.data?.data;
  const gmvBy = new Map((d?.byPerson ?? []).map((p) => [p.salesUserId, p]));
  const err = overview.error || team.error || dash.error || score.error || signals.error;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Win-back (ฝ่ายขาย)</h1>
          <p>ลูกค้าที่หยุดสั่ง / เสี่ยงหาย และผลงานทีมขาย เดือนนี้ · มุมหัวหน้า · อ่านจาก replica ของ josh ด้วยโค้ดรายงานของ josh เอง (ตัวเลขตรงกับแอปเซลล์)</p>
        </div>
        <button className="btn ghost" onClick={() => { overview.reload(); team.reload(); dash.reload(); score.reload(); signals.reload(); }}>Refresh</button>
      </div>
      {err && <div className="err">{err}</div>}

      {o && (
        <div className="stat-grid">
          <div className="stat"><div className="label">ลูกค้าใน pool</div><div className="value">{o.counts.total}</div>
            <div className="hint">dormant {o.counts.byHealth.dormant ?? 0} · watch {o.counts.byHealth.watch ?? 0} · กลับมาแล้ว {o.counts.byHealth.activeAgain ?? 0}</div></div>
          <div className="stat"><div className="label">ยังไม่มีคนดูแล</div><div className={`value${o.counts.unassigned ? ' attn' : ''}`}>{o.counts.unassigned}</div>
            <div className="hint">+ ร้านจาก Market Explorer {o.counts.placeCandidates}</div></div>
          <div className="stat"><div className="label">รายได้/เดือนที่เสี่ยงหาย</div><div className="value">{baht(o.revenueRisk.revenueAtRisk)}</div><div className="hint">กลุ่ม watch</div></div>
          <div className="stat"><div className="label">กู้คืนได้ (ประมาณ)</div><div className="value">{baht(o.revenueRisk.recoverableRevenue)}</div>
            <div className="hint">dormant {baht(o.revenueRisk.dormantMonthlyRevenue)} × {Math.round(o.revenueRisk.recoveryProbability * 100)}%</div></div>
          {d && <div className="stat"><div className="label">GMV เดือนนี้ / เป้า</div><div className="value">{baht(d.gmv)}</div>
            <div className="hint">{d.target.set ? `เป้า ${baht(d.target.baht)} · ${d.achievement.pct ?? 0}%` : 'ยังไม่ตั้งเป้า'}</div></div>}
          {s && <div className="stat"><div className="label">ดึงกลับสำเร็จ</div><div className="value">{s.reactivation.rate}%</div>
            <div className="hint">{s.reactivation.won}/{s.reactivation.total} · ติดต่อครั้งแรกเฉลี่ย {s.timing.avgDaysToFirstContact ?? '—'} วัน</div></div>}
        </div>
      )}

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">ทีมขาย</div>
        {team.data?.data.reps.length ? (
          <table>
            <thead><tr><th>เซลล์</th><th>ลีด</th><th>เปิดอยู่</th><th>ปิดได้</th><th>ปฏิเสธ</th><th>เข้าพบ</th><th>โทร</th><th>กิจกรรม</th><th>GMV</th><th>เป้า</th></tr></thead>
            <tbody>
              {team.data.data.reps.map((r) => {
                const g = gmvBy.get(r.salesUserId);
                return (
                  <tr key={r.salesUserId}>
                    <td>{r.name ?? r.email}</td><td>{r.leadCount}</td><td>{r.openCount}</td><td>{r.signedCount}</td><td>{r.rejectedCount}</td>
                    <td>{r.visits}</td><td>{r.calls}</td><td>{r.activities}</td><td>{baht(g?.gmv)}</td>
                    <td>{g?.target ? `${g.achievementPct ?? 0}%` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <div className="empty">{team.loading ? 'Loading…' : 'ไม่มีข้อมูล'}</div>}
      </div>

      <div className="panel">
        <div className="panel-head">ลีดที่ต้องตาม (เงียบนานสุดก่อน)</div>
        {signals.data?.data.leads.length ? (
          <table>
            <thead><tr><th>ร้าน</th><th>เซลล์</th><th>stage</th><th>อยู่ใน stage</th><th>ติดต่อล่าสุด</th><th>นัดที่ไม่ได้บันทึก</th></tr></thead>
            <tbody>
              {signals.data.data.leads.map((l) => (
                <tr key={l.accountId}>
                  <td>{l.displayName}</td>
                  <td>{l.assignedSalesUserName ?? <span className="badge warn">ไม่มีคนดูแล</span>}</td>
                  <td>{STAGE[l.stage] ?? l.stage}</td>
                  <td>{days(l.stageEnteredAt)} วัน{signals.data!.data.stageMedianDays[camel(l.stage)] != null && <span className="hint"> (ปกติ {signals.data!.data.stageMedianDays[camel(l.stage)]})</span>}</td>
                  <td>{l.lastActivityAt ? `${days(l.lastActivityAt)} วันก่อน · ${l.lastActivityType}` : <span className="badge danger">ยังไม่เคยติดต่อ</span>}</td>
                  <td>{l.unloggedAppointments.length ? <span className="badge warn">{l.unloggedAppointments.length}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">{signals.loading ? 'Loading…' : 'ไม่มีลีดค้าง'}</div>}
      </div>
    </div>
  );
}
