// ui-caption-migration: literal captions only
// ui-metadata-migration: static labels and UI notices only
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { GrowthPlanPage as PlanPageData, GrowthStatus } from '@cp/growth';
import { Button, ButtonLink, Chip, Empty, Field, Input, Page, PageHeader, Pager, Panel, PanelHead, RowLink, SearchInput, Segmented, Select, Table, TBody, TD, TH, THead, TR, fmt } from '@cp/ui';
import { api } from '../../../lib/api';
import { useAsync } from '../../hooks';
import { LoadState, PlanStatus, templateLabels } from './shared';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function GrowthPlans() {
  __useUiLocale();
  const [params, setParams] = useSearchParams();
  const [refresh, setRefresh] = useState(0);
  const view = params.get('view') === 'calendar' ? 'calendar' : 'list';
  const search = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('month') ?? '') ? params.get('month')! : bangkokDate.format(new Date()).slice(0, 7);
  const page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (search) query.set('search', search);
  if (status) query.set('status', status);
  if (view === 'calendar') query.set('month', month);
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }
  const statusOptions: GrowthStatus[] = ['draft', 'review', 'approved', 'ready', 'exporting', 'export_unknown'];
  return <Page>
    <PageHeader crumbs={[__uiText("Marketing"), __uiText("Growth"), __uiText("แผน")]} back={{ to: '/marketing/growth', label: 'Growth Workspace' }} title={__uiText("แผนและปฏิทิน")}
      subtitle={__uiText("เตรียมข้อความ กำหนดวัน และติดตามการตรวจของทีม")}
      actions={<><Button onClick={() => setRefresh((value) => value + 1)} icon="refresh">{__uiText("Refresh")}</Button><ButtonLink to="/marketing/growth/plans/new" variant="primary" icon="add">{__uiText("สร้างแผน")}</ButtonLink></>} />
    <Panel className="p-4"><div className="flex flex-wrap items-end gap-3">
      <Field label={__uiText("ค้นแผน")}><SearchInput aria-label={__uiText("ค้นแผน")} value={search} onChange={(event) => filter('q', event.target.value)} placeholder={__uiText("ชื่อแผนหรือเจ้าของงาน")} /></Field>
      <Field label={__uiText("สถานะ")}><Select aria-label={__uiText("สถานะ")} value={status} onChange={(event) => filter('status', event.target.value)}><option value="">{__uiText("ทั้งหมด")}</option>{statusOptions.map((value) => <option key={value} value={value}>{({ draft: 'ร่าง', review: 'รอตรวจ', approved: 'อนุมัติแล้ว', ready: 'สร้างร่าง workflow แล้ว', exporting: 'กำลังสร้างร่าง workflow', export_unknown: 'ต้องตรวจ workflow' })[value]}</option>)}</Select></Field>
      <Segmented options={[{ value: 'list', label: __uiText("รายการ") }, { value: 'calendar', label: __uiText("ปฏิทิน") }]} value={view} onChange={(value) => filter('view', value)} />
      {view === 'calendar' && <Field label={__uiText("เดือน")}><Input type="month" value={month} min="2020-01" max="2100-12" onChange={(event) => filter('month', event.target.value)} /></Field>}
    </div></Panel>
    <PlanItems key={`${query}-${refresh}`} query={query.toString()} view={view} month={month} onPage={(value) => filter('page', String(value))} />
  </Page>;
}

const bangkokDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' });
const bangkokWhen = new Intl.DateTimeFormat('th-TH-u-ca-gregory', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function PlanItems({ query, view, month, onPage }: { query: string; view: string; month: string; onPage: (value: number) => void }) {
  __useUiLocale();
  const state = useAsync(() => api.get<PlanPageData>(`/growth/plans?${query}`));
  const { items = [], totalCount = 0, page = 1, limit = 20 } = state.data ?? {};
  const [year, monthNumber] = month.split('-').map(Number);
  const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return <>
    <LoadState state={state} />
    {!state.loading && !state.error && <Panel className="overflow-hidden">
      <PanelHead title={view === 'list' ? __uiText("แผนทั้งหมด") : __uiText("วันที่วางแผนทำงาน")} icon={view === 'list' ? 'view_list' : 'calendar_month'} badge={<Chip>{fmt.num(totalCount)} {__uiText(" แผน")}</Chip>} sub={view === 'calendar' ? __uiText("แสดง {0} จาก {1} แผนในเดือนนี้ · วันที่ตามเวลาไทย · ยังไม่มีการส่งข้อความ",{'0':fmt.num(items.length),'1':fmt.num(totalCount)}) : undefined} />
      {!items.length ? <Empty icon="edit_calendar">{__uiText("ยังไม่มีแผนที่ตรงกับตัวกรอง")}</Empty> : view === 'list' ? <>
        <Table><THead><TH>{__uiText("แผน")}</TH><TH>{__uiText("ประเภท")}</TH><TH>{__uiText("เจ้าของงาน")}</TH><TH>{__uiText("กำหนดวัน (ไทย)")}</TH><TH kind="money">{__uiText("งบ")}</TH><TH>{__uiText("สถานะ")}</TH></THead><TBody>
          {items.map((item) => <TR key={item.id}>
            <TD><RowLink to={`/marketing/growth/plans/${encodeURIComponent(item.id)}`} mono={false}>{item.title}</RowLink><div className="text-[10px] text-outline">{__uiText("revision ")}{item.version}</div></TD>
            <TD kind="muted">{templateLabels[item.template]}</TD><TD>{item.owner || __uiText("ยังไม่ระบุ")}</TD><TD kind="time">{item.scheduleAt ? bangkokWhen.format(new Date(item.scheduleAt)) : __uiText("ยังไม่กำหนด")}</TD><TD kind="money">{fmt.baht(item.budgetThb)}</TD><TD><PlanStatus status={item.status} /></TD>
          </TR>)}
        </TBody></Table>
      </> : <div className="p-4 space-y-4">
        <div className="hidden md:block space-y-4">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-outline">{['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'].map((day) => <div key={day}>{day}</div>)}</div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstDay }, (_, index) => <div key={`blank-${index}`} />)}
          {Array.from({ length: days }, (_, index) => {
            const day = index + 1;
            const plans = items.filter((item) => item.scheduleAt && bangkokDate.format(new Date(item.scheduleAt)) === `${month}-${String(day).padStart(2, '0')}`);
            return <div key={day} className="min-w-0 min-h-20 md:min-h-28 rounded-md border border-secondary-container bg-surface-container-low/40 p-1.5 md:p-2 space-y-1">
              <span className="text-[11px] text-outline">{day}</span>
              {plans.map((item) => <div key={item.id} className="rounded bg-primary-container/60 p-1 break-words text-[10px]"><RowLink to={`/marketing/growth/plans/${encodeURIComponent(item.id)}`} mono={false}>{item.title}</RowLink></div>)}
            </div>;
          })}
        </div>
        </div>
        <div className="md:hidden space-y-2">{items.map((item) => <div key={item.id} className="rounded-md border border-secondary-container bg-surface-container-low/40 p-3 space-y-1 break-words text-xs">
          <div className="text-[11px] text-outline">{item.scheduleAt ? bangkokWhen.format(new Date(item.scheduleAt)) : __uiText("ยังไม่กำหนดวัน")}</div>
          <RowLink to={`/marketing/growth/plans/${encodeURIComponent(item.id)}`} mono={false}>{item.title}</RowLink>
        </div>)}</div>
        <p className="text-[11px] text-outline">{__uiText("เลือกชื่อแผนเพื่อดูเนื้อหาและการอนุมัติ · แผนที่ยังไม่กำหนดวันอยู่ในมุมมองรายการ")}</p>
      </div>}
      <Pager page={page} pageSize={limit} total={totalCount} onPage={onPage} />
    </Panel>}
  </>;
}
