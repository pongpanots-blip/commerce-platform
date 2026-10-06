import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GrowthPlanPage, GrowthWorkspace as WorkspaceData } from '@cp/growth';
import { Alert, ArrowLink, Button, ButtonLink, Chip, Empty, Field, Icon, Input, Page, PageHeader, Panel, PanelHead, RowLink, StatGrid, StatTile, Table, TBody, TD, TH, THead, TR, TitleBadge, fmt } from '@cp/ui';
import { api } from '../../../lib/api';
import { useAsync } from '../../hooks';
import { Evidence, LoadState, PlanStatus, Readiness, templateLabels } from './shared';

export function GrowthWorkspace() {
  const state = useAsync(() => api.get<WorkspaceData>('/growth/workspace'));
  const reviewQueue = useAsync(() => api.get<GrowthPlanPage>('/growth/plans?status=review&limit=5'));
  const [companyId, setCompanyId] = useState('');
  const navigate = useNavigate();
  const data = state.data;
  return <Page>
    <PageHeader crumbs={['Marketing', 'Growth']} title="Growth Workspace" badge={<TitleBadge icon="insights">ข้อมูล → แผน → ตรวจ → ผลลัพธ์</TitleBadge>}
      subtitle="เลือกโอกาสที่มีหลักฐาน แล้วเตรียมแผนให้ทีมตรวจและลงมือทำ"
      actions={<><Button onClick={state.reload} icon="refresh">Refresh</Button><ButtonLink to="/marketing/growth/plans" icon="calendar_month">แผนและปฏิทิน</ButtonLink><ButtonLink to="/marketing/growth/plans/new" variant="primary" icon="add">สร้างแผน</ButtonLink></>} />
    <LoadState state={state} />
    {!state.loading && !state.error && data && <>
      <div className="flex flex-wrap gap-2 items-center text-xs text-on-surface-variant">
        <Chip tone={data.availability === 'ready' ? 'ok' : 'warn'}>{data.availability === 'ready' ? 'ข้อมูลพร้อม' : data.availability === 'partial' ? 'ข้อมูลบางส่วน' : 'ข้อมูลยังไม่พร้อม'}</Chip>
        <span>{fmt.date(data.period.from)} – {fmt.date(data.period.to)}</span><span>อัปเดต {fmt.when(data.generatedAt)}</span>
      </div>
      {data.limitations.length > 0 && <Alert tone="warn" title="ข้อจำกัดของข้อมูล"><ul className="list-disc pl-4 space-y-1">{data.limitations.map((item) => <li key={item}>{item}</li>)}</ul></Alert>}
      <StatGrid>{data.metrics.map((metric) => <StatTile key={metric.key} label={metric.label}
        value={metric.value === null ? 'ยังไม่มีข้อมูล' : metric.unit === 'THB' ? fmt.baht(metric.value) : `${fmt.num(metric.value)}${metric.unit === 'percent' ? '%' : metric.unit === 'hours' ? ' ชม.' : ''}`}
        foot={metric.note} icon={metric.unit === 'THB' ? 'payments' : 'monitoring'} />)}</StatGrid>
      <Panel><PanelHead title="โอกาสที่ควรตรวจวันนี้" icon="lightbulb" sub={`${data.opportunities.length} รายการ`} actions={<ArrowLink to="/marketing/research">เปิด Research</ArrowLink>} />
        {!data.opportunities.length ? <Empty icon="lightbulb">ยังไม่มีโอกาสที่มีหลักฐานเพียงพอ · สร้างแผนเองหรือเริ่มจาก Research</Empty> : <div className="grid gap-3 p-4 md:grid-cols-2">
          {data.opportunities.map((opportunity) => <article key={opportunity.id} className="rounded-lg border border-secondary-container p-4 min-w-0 space-y-3">
            <div className="flex items-center gap-2"><Icon name="trending_up" className="text-primary" /><Chip tone={opportunity.priority === 'high' ? 'primary' : 'muted'}>{opportunity.priority === 'high' ? 'ตรวจเป็นลำดับแรก' : 'โอกาสเพิ่มเติม'}</Chip><Chip>{templateLabels[opportunity.template]}</Chip></div>
            <h2 className="text-sm font-semibold">{opportunity.title}</h2><p className="text-xs text-on-surface-variant">{opportunity.reason}</p>
            <p className="text-[11px] text-outline">หลักฐาน {opportunity.evidenceIds.length} รายการ</p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink to={`/marketing/growth/plans/new?${new URLSearchParams({ template: opportunity.template, title: opportunity.title, goal: opportunity.reason })}`} variant="primary" icon="edit_note">ร่างแผนจากโอกาสนี้</ButtonLink>
              {opportunity.href?.startsWith('/') && !opportunity.href.startsWith('//') && <ArrowLink to={opportunity.href}>ตรวจข้อมูลต้นทาง</ArrowLink>}
            </div>
          </article>)}
        </div>}
      </Panel>
      <Panel><PanelHead title="ข้อมูลที่ใช้ประกอบโอกาส" icon="fact_check" /><div className="p-4"><Evidence items={data.evidence} /></div></Panel>
    </>}
    <Panel><PanelHead title="แผนที่รอตรวจ" icon="rate_review"
      badge={reviewQueue.data && !reviewQueue.loading && !reviewQueue.error ? <Chip tone="warn">{fmt.num(reviewQueue.data.totalCount)} แผน</Chip> : undefined}
      sub={reviewQueue.data && !reviewQueue.loading && !reviewQueue.error ? `แสดง ${fmt.num(reviewQueue.data.items.length)} จาก ${fmt.num(reviewQueue.data.totalCount)} แผน · เรียงตามการแก้ไขล่าสุด` : undefined}
      actions={<><Button size="sm" icon="refresh" onClick={reviewQueue.reload}>Refresh แผนรอตรวจ</Button><ArrowLink to="/marketing/growth/plans?status=review">เปิดแผนรอตรวจทั้งหมด</ArrowLink></>} />
      {(reviewQueue.loading || reviewQueue.error) && <div className="p-4"><LoadState state={reviewQueue} /></div>}
      {!reviewQueue.loading && !reviewQueue.error && reviewQueue.data && (!reviewQueue.data.items.length ? <Empty icon="rate_review">ยังไม่มีแผนที่รอตรวจ</Empty> :
        <Table><THead><TH>แผน</TH><TH>เจ้าของงาน</TH><TH>กำหนดวัน (ไทย)</TH><TH>สถานะ</TH></THead><TBody>{reviewQueue.data.items.map((item) => <TR key={item.id}>
          <TD><RowLink to={`/marketing/growth/plans/${encodeURIComponent(item.id)}`} mono={false}>{item.title}</RowLink></TD><TD>{item.owner || 'ยังไม่ระบุ'}</TD>
          <TD kind="time">{item.scheduleAt ? new Date(item.scheduleAt).toLocaleString('th-TH-u-ca-gregory', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'ยังไม่กำหนด'}</TD><TD><PlanStatus status={item.status} /></TD>
        </TR>)}</TBody></Table>)}
    </Panel>
    <div className="grid gap-4 lg:grid-cols-2"><Readiness />
      <Panel><PanelHead title="ส่งต่องานให้ทีมขาย" icon="support_agent" />
        <div className="p-4 space-y-4"><p className="text-xs text-on-surface-variant">ตรวจประวัติของบริษัทก่อนวางแผนการติดต่อ หรือต่อจากคิว Winback เดิม</p>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (companyId.trim()) navigate(`/marketing/growth/companies/${encodeURIComponent(companyId.trim())}`); }}>
            <Field label="Company ID"><Input required value={companyId} onChange={(event) => setCompanyId(event.target.value)} placeholder="รหัสบริษัทจากรายงานลูกค้า" /></Field><Button type="submit" icon="history">ดูประวัติ</Button>
          </form><ArrowLink to="/reports/winback">เปิดงาน Winback ของฝ่ายขาย</ArrowLink>
        </div>
      </Panel>
    </div>
  </Page>;
}
