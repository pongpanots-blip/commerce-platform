import { Button, Empty, ErrorText, Loading, Page, PageHeader, Panel, PanelHead, SectionTitle, StatGrid, StatTile, Table, TBody, TD, TH, THead, TR, fmt, toneOf } from '@cp/ui';
import { winbackApi } from '../../lib/api';
import { useAsync } from '../hooks';

const STAGE: Record<string, string> = {
  prospect: 'prospect', inactivePool: 'inactive pool', inactive_pool: 'inactive pool', contacted: 'ติดต่อแล้ว', appointment: 'นัดหมาย', negotiate: 'เจรจา',
  interested: 'สนใจ', signed: 'เซ็นแล้ว', won: 'ปิดได้', reactivated: 'กลับมาสั่ง', orderingAgain: 'สั่งซ้ำ', ordering_again: 'สั่งซ้ำ', rejected: 'ปฏิเสธ', lost: 'เสีย',
};
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
    <Page>
      <PageHeader
        title="Win-back (ฝ่ายขาย)"
        subtitle="ลูกค้าที่หยุดสั่ง / เสี่ยงหาย และผลงานทีมขาย เดือนนี้ · มุมหัวหน้า · อ่านจาก replica ของ josh ด้วยโค้ดรายงานของ josh เอง (ตัวเลขตรงกับแอปเซลล์)"
        actions={<Button icon="refresh" onClick={() => { overview.reload(); team.reload(); dash.reload(); score.reload(); signals.reload(); }}>Refresh</Button>}
      />

      <ErrorText error={err} />

      {o && (
        <StatGrid cols={3}>
          <StatTile
            label="ลูกค้าใน pool"
            value={fmt.num(o.counts.total)}
            tone="info"
            foot={`dormant ${o.counts.byHealth.dormant ?? 0} · watch ${o.counts.byHealth.watch ?? 0} · กลับมาแล้ว ${o.counts.byHealth.activeAgain ?? 0}`}
          />
          <StatTile
            accent
            tone={o.counts.unassigned ? 'warn' : 'info'}
            label="ยังไม่มีคนดูแล"
            value={fmt.num(o.counts.unassigned)}
            foot={`+ ร้านจาก Market Explorer ${o.counts.placeCandidates}`}
          />
          <StatTile
            label="รายได้/เดือนที่เสี่ยงหาย"
            value={fmt.baht(o.revenueRisk.revenueAtRisk)}
            tone="warn"
            foot="กลุ่ม watch"
          />
          <StatTile
            label="กู้คืนได้ (ประมาณ)"
            value={fmt.baht(o.revenueRisk.recoverableRevenue)}
            tone="ok"
            foot={`dormant ${fmt.baht(o.revenueRisk.dormantMonthlyRevenue)} × ${Math.round(o.revenueRisk.recoveryProbability * 100)}%`}
          />
          {d && <StatTile
            label="GMV เดือนนี้ / เป้า"
            value={fmt.baht(d.gmv)}
            tone="info"
            foot={d.target.set ? `เป้า ${fmt.baht(d.target.baht)} · ${d.achievement.pct ?? 0}%` : 'ยังไม่ตั้งเป้า'}
          />}
          {s && <StatTile
            label="ดึงกลับสำเร็จ"
            value={`${s.reactivation.rate}%`}
            tone="ok"
            foot={`${s.reactivation.won}/${s.reactivation.total} · ติดต่อครั้งแรกเฉลี่ย ${s.timing.avgDaysToFirstContact ?? '—'} วัน`}
          />}
        </StatGrid>
      )}

      <Panel className="overflow-hidden">
        <PanelHead title="ทีมขาย" />
        {team.data?.data.reps.length ? (
          <Table>
            <THead>
              <TH>เซลล์</TH>
              <TH right>ลีด</TH>
              <TH right>เปิดอยู่</TH>
              <TH right>ปิดได้</TH>
              <TH right>ปฏิเสธ</TH>
              <TH right>เข้าพบ</TH>
              <TH right>โทร</TH>
              <TH right>กิจกรรม</TH>
              <TH right>GMV</TH>
              <TH right>เป้า</TH>
            </THead>
            <TBody>
              {team.data.data.reps.map((r) => {
                const g = gmvBy.get(r.salesUserId);
                return (
                  <TR key={r.salesUserId}>
                    <TD>{r.name ?? r.email}</TD>
                    <TD kind="num">{r.leadCount}</TD>
                    <TD kind="num">{r.openCount}</TD>
                    <TD kind="num">{r.signedCount}</TD>
                    <TD kind="num">{r.rejectedCount}</TD>
                    <TD kind="num">{r.visits}</TD>
                    <TD kind="num">{r.calls}</TD>
                    <TD kind="num">{r.activities}</TD>
                    <TD kind="money">{fmt.baht(g?.gmv)}</TD>
                    <TD kind="muted">{g?.target ? `${g.achievementPct ?? 0}%` : '—'}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : (
          <div className="px-4 py-8">{team.loading ? <Loading /> : <Empty icon="group">ไม่มีข้อมูล</Empty>}</div>
        )}
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHead title="ลีดที่ต้องตาม (เงียบนานสุดก่อน)" />
        {signals.data?.data.leads.length ? (
          <Table>
            <THead>
              <TH>ร้าน</TH>
              <TH>เซลล์</TH>
              <TH>stage</TH>
              <TH>อยู่ใน stage</TH>
              <TH>ติดต่อล่าสุด</TH>
              <TH>นัดที่ไม่ได้บันทึก</TH>
            </THead>
            <TBody>
              {signals.data.data.leads.map((l) => (
                <TR key={l.accountId}>
                  <TD>{l.displayName}</TD>
                  <TD>{l.assignedSalesUserName ?? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fef7e0] text-[#b08900]">ไม่มีคนดูแล</span>}</TD>
                  <TD kind="muted">{STAGE[l.stage] ?? l.stage}</TD>
                  <TD kind="muted">
                    {days(l.stageEnteredAt)} วัน
                    {signals.data!.data.stageMedianDays[camel(l.stage)] != null && <div className="text-[10px] text-outline">(ปกติ {signals.data!.data.stageMedianDays[camel(l.stage)]})</div>}
                  </TD>
                  <TD kind="time">
                    {l.lastActivityAt ? (
                      <>{days(l.lastActivityAt)} วันก่อน<div className="text-[10px] text-outline">{l.lastActivityType}</div></>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fdecee] text-[#c2333f]">ยังไม่เคยติดต่อ</span>
                    )}
                  </TD>
                  <TD kind="muted">{l.unloggedAppointments.length ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fef7e0] text-[#b08900]">{l.unloggedAppointments.length}</span> : '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <div className="px-4 py-8">{signals.loading ? <Loading /> : <Empty icon="trending_up">ไม่มีลีดค้าง</Empty>}</div>
        )}
      </Panel>
    </Page>
  );
}
