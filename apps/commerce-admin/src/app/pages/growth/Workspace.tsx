// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-caption-migration: literal captions only
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GrowthPlanPage, GrowthWorkspace as WorkspaceData } from '@cp/growth';
import { Alert, ArrowLink, Button, ButtonLink, Chip, Empty, Field, Icon, Input, Page, PageHeader, Panel, PanelHead, RowLink, StatGrid, StatTile, Table, TBody, TD, TH, THead, TR, TitleBadge, fmt } from '@cp/ui';
import { api } from '../../../lib/api';
import { useAsync } from '../../hooks';
import { Evidence, LoadState, PlanStatus, Readiness, templateLabels } from './shared';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function GrowthWorkspace() {
  __useUiLocale();
  const state = useAsync(() => api.get<WorkspaceData>('/growth/workspace'));
  const reviewQueue = useAsync(() => api.get<GrowthPlanPage>('/growth/plans?status=review&limit=5'));
  const [companyId, setCompanyId] = useState('');
  const navigate = useNavigate();
  const data = state.data;
  return <Page>
    <PageHeader crumbs={[__uiText("Marketing"), __uiText("Growth")]} title={__uiText("Growth Workspace")} badge={<TitleBadge icon="insights">{__uiText("ข้อมูล → แผน → ตรวจ → ผลลัพธ์")}</TitleBadge>}
      subtitle={__uiText("เลือกโอกาสที่มีหลักฐาน แล้วเตรียมแผนให้ทีมตรวจและลงมือทำ")}
      actions={<><Button onClick={state.reload} icon="refresh">{__uiText("Refresh")}</Button><ButtonLink to="/marketing/growth/plans" icon="calendar_month">{__uiText("แผนและปฏิทิน")}</ButtonLink><ButtonLink to="/marketing/growth/plans/new" variant="primary" icon="add">{__uiText("สร้างแผน")}</ButtonLink></>} />
    <LoadState state={state} />
    {!state.loading && !state.error && data && <>
      <div className="flex flex-wrap gap-2 items-center text-xs text-on-surface-variant">
        <Chip tone={data.availability === 'ready' ? 'ok' : 'warn'}>{data.availability === 'ready' ? __uiText("ข้อมูลพร้อม") : data.availability === 'partial' ? __uiText("ข้อมูลบางส่วน") : __uiText("ข้อมูลยังไม่พร้อม")}</Chip>
        <span>{fmt.date(data.period.from)} – {fmt.date(data.period.to)}</span><span>{__uiText("อัปเดต ")}{fmt.when(data.generatedAt)}</span>
      </div>
      {data.limitations.length > 0 && <Alert tone="warn" title={__uiText("ข้อจำกัดของข้อมูล")}><ul className="list-disc pl-4 space-y-1">{data.limitations.map((item) => <li key={item}>{growthCopy(item)}</li>)}</ul></Alert>}
      <StatGrid>{data.metrics.map((metric) => <StatTile key={metric.key} label={__uiText(metric.label)}
        value={metric.value === null ? __uiText('ยังไม่มีข้อมูล') : metric.unit === 'THB' ? fmt.baht(metric.value) : `${fmt.num(metric.value)}${metric.unit === 'percent' ? '%' : metric.unit === 'hours' ? __uiText(' ชม.') : ''}`}
        foot={__uiText(metric.note)} icon={metric.unit === 'THB' ? 'payments' : 'monitoring'} />)}</StatGrid>
      <Panel><PanelHead title={__uiText("โอกาสที่ควรตรวจวันนี้")} icon="lightbulb" sub={__uiText("{0} รายการ",{'0':data.opportunities.length})} actions={<ArrowLink to="/marketing/research">{__uiText("เปิด Research")}</ArrowLink>} />
        {!data.opportunities.length ? <Empty icon="lightbulb">{__uiText("ยังไม่มีโอกาสที่มีหลักฐานเพียงพอ · สร้างแผนเองหรือเริ่มจาก Research")}</Empty> : <div className="grid gap-3 p-4 md:grid-cols-2">
          {data.opportunities.map((opportunity) => <article key={opportunity.id} className="rounded-lg border border-secondary-container p-4 min-w-0 space-y-3">
            <div className="flex items-center gap-2"><Icon name="trending_up" className="text-primary" /><Chip tone={opportunity.priority === 'high' ? 'primary' : 'muted'}>{opportunity.priority === 'high' ? __uiText("ตรวจเป็นลำดับแรก") : __uiText("โอกาสเพิ่มเติม")}</Chip><Chip>{templateLabels[opportunity.template]}</Chip></div>
            <h2 className="text-sm font-semibold">{opportunity.title}</h2><p className="text-xs text-on-surface-variant">{opportunity.reason}</p>
            <p className="text-[11px] text-outline">{__uiText("หลักฐาน ")}{opportunity.evidenceIds.length} {__uiText(" รายการ")}</p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink to={`/marketing/growth/plans/new?${new URLSearchParams({ template: opportunity.template, title: opportunity.title, goal: opportunity.reason })}`} variant="primary" icon="edit_note">{__uiText("ร่างแผนจากโอกาสนี้")}</ButtonLink>
              {opportunity.href?.startsWith('/') && !opportunity.href.startsWith('//') && <ArrowLink to={opportunity.href}>{__uiText("ตรวจข้อมูลต้นทาง")}</ArrowLink>}
            </div>
          </article>)}
        </div>}
      </Panel>
      <Panel><PanelHead title={__uiText("ข้อมูลที่ใช้ประกอบโอกาส")} icon="fact_check" /><div className="p-4"><Evidence items={data.evidence} /></div></Panel>
    </>}
    <Panel><PanelHead title={__uiText("แผนที่รอตรวจ")} icon="rate_review"
      badge={reviewQueue.data && !reviewQueue.loading && !reviewQueue.error ? <Chip tone="warn">{fmt.num(reviewQueue.data.totalCount)} {__uiText(" แผน")}</Chip> : undefined}
      sub={reviewQueue.data && !reviewQueue.loading && !reviewQueue.error ? __uiText("แสดง {0} จาก {1} แผน · เรียงตามการแก้ไขล่าสุด",{'0':fmt.num(reviewQueue.data.items.length),'1':fmt.num(reviewQueue.data.totalCount)}) : undefined}
      actions={<><Button size="sm" icon="refresh" onClick={reviewQueue.reload}>{__uiText("Refresh แผนรอตรวจ")}</Button><ArrowLink to="/marketing/growth/plans?status=review">{__uiText("เปิดแผนรอตรวจทั้งหมด")}</ArrowLink></>} />
      {(reviewQueue.loading || reviewQueue.error) && <div className="p-4"><LoadState state={reviewQueue} /></div>}
      {!reviewQueue.loading && !reviewQueue.error && reviewQueue.data && (!reviewQueue.data.items.length ? <Empty icon="rate_review">{__uiText("ยังไม่มีแผนที่รอตรวจ")}</Empty> :
        <Table><THead><TH>{__uiText("แผน")}</TH><TH>{__uiText("เจ้าของงาน")}</TH><TH>{__uiText("กำหนดวัน (ไทย)")}</TH><TH>{__uiText("สถานะ")}</TH></THead><TBody>{reviewQueue.data.items.map((item) => <TR key={item.id}>
          <TD><RowLink to={`/marketing/growth/plans/${encodeURIComponent(item.id)}`} mono={false}>{item.title}</RowLink></TD><TD>{item.owner || __uiText("ยังไม่ระบุ")}</TD>
          <TD kind="time">{item.scheduleAt ? new Date(item.scheduleAt).toLocaleString((__dateLocale() === 'th' ? "th-TH-u-ca-gregory" : 'en-GB'), { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : __uiText("ยังไม่กำหนด")}</TD><TD><PlanStatus status={item.status} /></TD>
        </TR>)}</TBody></Table>)}
    </Panel>
    <div className="grid gap-4 lg:grid-cols-2"><Readiness />
      <Panel><PanelHead title={__uiText("ส่งต่องานให้ทีมขาย")} icon="support_agent" />
        <div className="p-4 space-y-4"><p className="text-xs text-on-surface-variant">{__uiText("ตรวจประวัติของบริษัทก่อนวางแผนการติดต่อ หรือต่อจากคิว Winback เดิม")}</p>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (companyId.trim()) navigate(`/marketing/growth/companies/${encodeURIComponent(companyId.trim())}`); }}>
            <Field label={__uiText("Company ID")}><Input required value={companyId} onChange={(event) => setCompanyId(event.target.value)} placeholder={__uiText("รหัสบริษัทจากรายงานลูกค้า")} /></Field><Button type="submit" icon="history">{__uiText("ดูประวัติ")}</Button>
          </form><ArrowLink to="/reports/winback">{__uiText("เปิดงาน Winback ของฝ่ายขาย")}</ArrowLink>
        </div>
      </Panel>
    </div>
  </Page>;
}

// The API supplies system descriptions. Interpolate its timestamp without changing it.
function growthCopy(source: string) {
  const window = /^ยอดขายและตะกร้าใช้ช่วงถึง (.+) \(สิ้นชั่วโมงที่ครบแล้ว\)$/.exec(source);
  return window ? __uiText('ยอดขายและตะกร้าใช้ช่วงถึง {0} (สิ้นชั่วโมงที่ครบแล้ว)', { '0': window[1] }) : __uiText(source);
}
