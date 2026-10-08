// ui-metadata-migration: static labels and UI notices only
import { Button, Empty, ErrorText, Loading, Page, PageHeader, Panel, PanelHead, SectionTitle, StatGrid, StatTile, Table, TBody, TD, TH, THead, TR, fmt, toneOf } from '@cp/ui';
import { winbackApi } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const STAGE: Record<string, string> = {
  prospect: 'prospect', inactivePool: 'inactive pool', inactive_pool: 'inactive pool', contacted: 'ติดต่อแล้ว', appointment: 'นัดหมาย', negotiate: 'เจรจา',
  interested: 'สนใจ', signed: 'เซ็นแล้ว', won: 'ปิดได้', reactivated: 'กลับมาสั่ง', orderingAgain: 'สั่งซ้ำ', ordering_again: 'สั่งซ้ำ', rejected: 'ปฏิเสธ', lost: 'เสีย',
};
const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const days = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

/** winback (sales win-back CRM), manager view. Backend WINBACK_REPORTS_SOURCE: josh's replica (default) or commerce's winback tables — same answers. */
export function Winback() {
  __useUiLocale();
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
        title={__uiText("Win-back (ฝ่ายขาย)")}
        subtitle={__uiText("ลูกค้าที่หยุดสั่ง / เสี่ยงหาย และผลงานทีมขาย เดือนนี้ · มุมหัวหน้า · ตัวเลขชุดเดียวกับแอปเซลล์")}
        actions={<Button icon="refresh" onClick={() => { overview.reload(); team.reload(); dash.reload(); score.reload(); signals.reload(); }}>{__uiText("Refresh")}</Button>}
      />

      <ErrorText error={err} />

      {o && (
        <StatGrid cols={3}>
          <StatTile
            label={__uiText("ลูกค้าใน pool")}
            value={fmt.num(o.counts.total)}
            tone="info"
            foot={__uiText("dormant {0} · watch {1} · กลับมาแล้ว {2}",{'0':o.counts.byHealth.dormant ?? 0,'1':o.counts.byHealth.watch ?? 0,'2':o.counts.byHealth.activeAgain ?? 0})}
          />
          <StatTile
            accent
            tone={o.counts.unassigned ? 'warn' : 'info'}
            label={__uiText("ยังไม่มีคนดูแล")}
            value={fmt.num(o.counts.unassigned)}
            foot={__uiText("+ ร้านจาก Market Explorer {0}",{'0':o.counts.placeCandidates})}
          />
          <StatTile
            label={__uiText("รายได้/เดือนที่เสี่ยงหาย")}
            value={fmt.baht(o.revenueRisk.revenueAtRisk)}
            tone="warn"
            foot={__uiText("กลุ่ม watch")}
          />
          <StatTile
            label={__uiText("กู้คืนได้ (ประมาณ)")}
            value={fmt.baht(o.revenueRisk.recoverableRevenue)}
            tone="ok"
            foot={__uiText("dormant {0} × {1}%",{'0':fmt.baht(o.revenueRisk.dormantMonthlyRevenue),'1':Math.round(o.revenueRisk.recoveryProbability * 100)})}
          />
          {d && <StatTile
            label={__uiText("GMV เดือนนี้ / เป้า")}
            value={fmt.baht(d.gmv)}
            tone="info"
            foot={d.target.set ? __uiText("เป้า {0} · {1}%",{'0':fmt.baht(d.target.baht),'1':d.achievement.pct ?? 0}) : __uiText("ยังไม่ตั้งเป้า")}
          />}
          {s && <StatTile
            label={__uiText("ดึงกลับสำเร็จ")}
            value={`${s.reactivation.rate}%`}
            tone="ok"
            foot={__uiText("{0}/{1} · ติดต่อครั้งแรกเฉลี่ย {2} วัน",{'0':s.reactivation.won,'1':s.reactivation.total,'2':s.timing.avgDaysToFirstContact ?? '—'})}
          />}
        </StatGrid>
      )}

      <Panel className="overflow-hidden">
        <PanelHead title={__uiText("ทีมขาย")} />
        {team.data?.data.reps.length ? (
          <Table>
            <THead>
              <TH>{__uiText("เซลล์")}</TH>
              <TH right>{__uiText("ลีด")}</TH>
              <TH right>{__uiText("เปิดอยู่")}</TH>
              <TH right>{__uiText("ปิดได้")}</TH>
              <TH right>{__uiText("ปฏิเสธ")}</TH>
              <TH right>{__uiText("เข้าพบ")}</TH>
              <TH right>{__uiText("โทร")}</TH>
              <TH right>{__uiText("กิจกรรม")}</TH>
              <TH right>{__uiText("GMV")}</TH>
              <TH right>{__uiText("เป้า")}</TH>
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
          <div className="px-4 py-8">{team.loading ? <Loading /> : <Empty icon="group">{__uiText("ไม่มีข้อมูล")}</Empty>}</div>
        )}
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHead title={__uiText("ลีดที่ต้องตาม (เงียบนานสุดก่อน)")} />
        {signals.data?.data.leads.length ? (
          <Table>
            <THead>
              <TH>{__uiText("ร้าน")}</TH>
              <TH>{__uiText("เซลล์")}</TH>
              <TH>{__uiText("stage")}</TH>
              <TH>{__uiText("อยู่ใน stage")}</TH>
              <TH>{__uiText("ติดต่อล่าสุด")}</TH>
              <TH>{__uiText("นัดที่ไม่ได้บันทึก")}</TH>
            </THead>
            <TBody>
              {signals.data.data.leads.map((l) => (
                <TR key={l.accountId}>
                  <TD>{l.displayName}</TD>
                  <TD>{l.assignedSalesUserName ?? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fef7e0] text-[#b08900]">{__uiText("ไม่มีคนดูแล")}</span>}</TD>
                  <TD kind="muted">{STAGE[l.stage] ?? l.stage}</TD>
                  <TD kind="muted">
                    {days(l.stageEnteredAt)} {__uiText(" วัน")}{signals.data!.data.stageMedianDays[camel(l.stage)] != null && <div className="text-[10px] text-outline">{__uiText("(ปกติ ")}{signals.data!.data.stageMedianDays[camel(l.stage)]})</div>}
                  </TD>
                  <TD kind="time">
                    {l.lastActivityAt ? (
                      <>{days(l.lastActivityAt)} {__uiText(" วันก่อน")}<div className="text-[10px] text-outline">{l.lastActivityType}</div></>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fdecee] text-[#c2333f]">{__uiText("ยังไม่เคยติดต่อ")}</span>
                    )}
                  </TD>
                  <TD kind="muted">{l.unloggedAppointments.length ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fef7e0] text-[#b08900]">{l.unloggedAppointments.length}</span> : '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <div className="px-4 py-8">{signals.loading ? <Loading /> : <Empty icon="trending_up">{__uiText("ไม่มีลีดค้าง")}</Empty>}</div>
        )}
      </Panel>
    </Page>
  );
}
