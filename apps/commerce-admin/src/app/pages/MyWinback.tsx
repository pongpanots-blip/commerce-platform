import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Alert, Button, Chip, Empty, KeyValueGrid, Loading, PageHeader, Panel, PanelHead, TaskInput, fmt, useUiLocale } from '@cp/ui';
import { api, session } from '../../lib/api';
import { normalizeRole } from '../../lib/role-home';
import { CommercePage } from '../CommercePage';
import { commerceText as text } from '../commerce-copy';
import { useAsync } from '../hooks';
import { WorkspaceLink } from '../WorkspaceParts';
import { friendlyError } from './planning/promotion-contracts';
import { PlanningError } from './planning/PlanningError';
import { parseSalesPage, salesRecordId, salesWorkQuery, type SalesKind } from './sales-work/sales-work';

/** Recorded win-back stages shown by label; unknown stages (e.g. opportunity stages) stay as recorded. */
const STAGE: Record<string, [string, string]> = {
  prospect: ['ลูกค้าเป้าหมาย', 'Prospect'], inactive_pool: ['ลูกค้าที่หยุดสั่ง', 'Inactive customer'], contacted: ['ติดต่อแล้ว', 'Contacted'],
  appointment: ['นัดหมาย', 'Appointment'], negotiate: ['เจรจา', 'Negotiating'], interested: ['สนใจ', 'Interested'], signed: ['เซ็นแล้ว', 'Signed'],
  won: ['ปิดได้', 'Won'], reactivated: ['กลับมาสั่ง', 'Reactivated'], ordering_again: ['สั่งซ้ำ', 'Ordering again'], rejected: ['ปฏิเสธ', 'Rejected'], lost: ['เสีย', 'Lost'],
};
const stageLabel = (stage: string | null | undefined) => stage ? (STAGE[stage] ? text(...STAGE[stage]) : stage) : text('ยังไม่ทราบ', 'Unknown');

/** Same original own/team readers. Record URLs inspect only the returned page; no scope override or write. */
export function MyWinback({ role = session.claims()?.role }: { role?: string }) {
  useUiLocale();
  const normalized = normalizeRole(role), { pathname } = useLocation(), ownPath = pathname === '/reports/winback/my' || pathname.startsWith('/reports/winback/my/');
  const allowed = ownPath ? ['admin', 'sale'].includes(normalized) : ['admin', 'sales_manager', 'business_analyst'].includes(normalized);
  if (!allowed) return <CommercePage><Alert tone="danger">{text('บัญชีนี้ไม่มีสิทธิ์อ่านรายการขายในขอบเขตนี้', 'This account cannot read this sales scope.')}</Alert></CommercePage>;
  return <SalesWorkList key={`${normalized}:${ownPath}`} ownPath={ownPath} role={normalized} />;
}
function SalesWorkList({ ownPath, role }: { ownPath: boolean; role: string }) {
  const { pathname } = useLocation(), base = ownPath ? '/reports/winback/my' : '/reports/winback/opportunities', apiBase = ownPath && role !== 'admin' ? '/reports/winback/my' : '/reports/winback';
  const tail = pathname.slice(base.length).replace(/^\//, '').replace(/\/$/, ''), parts = tail ? tail.split('/') : [], kind: SalesKind = parts[0] === 'leads' ? 'leads' : 'opportunities';
  const record = kind === 'leads' ? parts[1] : parts[0], validRecord = record ? salesRecordId(record) : null;
  const validPath = parts.length <= (kind === 'leads' ? 2 : 1) && (!record || validRecord?.success);
  const listUrl = kind === 'leads' ? `${base}/leads` : base;
  const [params, setParams] = useSearchParams(), parsed = salesWorkQuery(params), [draft, setDraft] = useState(parsed.q);
  useEffect(() => setDraft(parsed.q), [parsed.q]);
  const state = useAsync(async () => {
    if (!validPath || parsed.error) return null;
    try { const value = parseSalesPage(await api.get(`${apiBase}/${kind === 'leads' ? 'pool' : 'opportunities'}?${new URLSearchParams({ page: String(parsed.page), limit: '20', search: parsed.q })}`), kind); return { ...value, capturedAt: new Date().toISOString() }; }
    catch (e) { throw Error(friendlyError(e)); }
  }, [apiBase, kind, parsed.page, parsed.q, parsed.error, validPath]);
  const suffix = params.size ? `?${params}` : '', row = validRecord?.success ? state.data?.rows.find(r => r.id === validRecord.data) : null;
  const scope = ownPath && role !== 'admin' ? text('รายการที่คุณดูแล และรายการที่ยังไม่มีคนดูแล', 'Records you own, plus records nobody owns yet.') : text('รายการของทั้งทีมตามสิทธิ์ของบัญชีนี้', 'Records across the team that this account may see.');
  const changePage = (page: number) => { const next = new URLSearchParams(params); page === 1 ? next.delete('page') : next.set('page', String(page)); setParams(next); };
  const clear = () => { setDraft(''); setParams({}); };
  return <CommercePage><PageHeader title={ownPath && role !== 'admin' ? text('โอกาสและลีดของฉัน', 'My opportunities and leads') : text('โอกาสและลีดของทีม', 'Team opportunities and leads')} subtitle={scope} />
    <nav aria-label={text('งานขายที่ต้องการอ่าน', 'Sales reading tasks')} className="flex flex-wrap gap-3"><Link className="text-primary underline underline-offset-2 min-h-11 inline-flex items-center" to={`${base}${suffix}`} aria-current={kind === 'opportunities' ? 'page' : undefined}>{text('ทบทวนโอกาส', 'Review opportunities')}</Link><Link className="text-primary underline underline-offset-2 min-h-11 inline-flex items-center" to={`${base}/leads${suffix}`} aria-current={kind === 'leads' ? 'page' : undefined}>{text('ทบทวนลีด', 'Review leads')}</Link></nav>
    <Alert tone="muted">{text('หน้านี้ใช้ดูสถานะที่บันทึกไว้เท่านั้น มอบหมายงาน ติดต่อ หรือส่งข้อความหาลูกค้าจากหน้านี้ไม่ได้', 'This view only shows recorded status. Assignment, contact and messaging actions are unavailable here.')}</Alert>
    {!validPath || parsed.error ? <Alert tone="danger">{text('ลิงก์หรือตัวกรองไม่ถูกต้อง กลับหน้ารายการและเริ่มค้นหาใหม่', 'Invalid action link or filters. Return to the list and search again.')}<WorkspaceLink to={base}>{text('กลับหน้ารายการ', 'Open the list')}</WorkspaceLink></Alert> : <>
      {record ? <WorkspaceLink to={`${listUrl}${suffix}`}>{text('กลับหน้ารายการเดิม', 'Back to this list')}</WorkspaceLink> : <Panel><PanelHead title={text('ค้นหาในขอบเขตที่มีสิทธิ์', 'Search the authorized scope')} /><form className="p-4 flex flex-col sm:flex-row gap-3 items-end" onSubmit={e => { e.preventDefault(); const next = new URLSearchParams(); if (draft.trim()) next.set('q', draft.trim()); setParams(next); }}><TaskInput label={text('ชื่อร้านหรือคำค้น', 'Store name or search text')} value={draft} maxLength={120} onChange={e => setDraft(e.target.value)} fieldClassName="flex-1" /><Button type="submit">{text('ค้นหารายการ', 'Search records')}</Button><Button variant="secondary" onClick={clear}>{text('ล้างตัวกรอง', 'Clear filters')}</Button></form></Panel>}
      <PlanningError error={state.error} onRetry={state.reload} />{state.loading ? <Loading variant={record ? 'detail' : 'table'} /> : state.data && !state.error && <>
        <p role="status" className="text-xs">{text('โหลดข้อมูลเมื่อ', 'Read captured')}: {fmt.when(state.data.capturedAt)} · {text('ข้อมูลต้นทางอาจยังไม่อัปเดตล่าสุด', 'Source freshness unverified')}</p>{state.data.capped && <Alert tone="warn">{text('แหล่งโอกาสจำกัดจำนวนตัวอย่างก่อนแบ่งหน้า ยังไม่ใช่รายการทั้งหมด', 'Opportunity candidates are capped before pagination; coverage is incomplete.')}</Alert>}
        {record ? row ? <Panel><PanelHead title={row.name} /><div className="p-4"><KeyValueGrid cols={2} items={[{ label: text('รหัสรายการ', 'Record ID'), value: row.id, mono: true }, { label: text('สถานะที่บันทึก', 'Recorded stage'), value: <Chip tone="muted">{stageLabel(row.stage)}</Chip> }, { label: text('ผู้ดูแลที่บันทึก', 'Recorded owner'), value: row.ownerId ? row.ownerName || row.ownerId : text('ยังไม่มีผู้ดูแล', 'Unassigned') }, { label: text('พื้นที่', 'District'), value: row.district ?? text('ยังไม่มีข้อมูล', 'Unavailable') }]} /></div><p className="px-4 pb-4 text-xs">{text('อ่านจากหน้ารายการเดิม ประวัติการติดตามและรายละเอียดครบทุกแหล่งยังไม่มีในสัญญาผลอ่านนี้', 'Evidence comes from the original list page. Follow-up history and a complete individual-record reader are unavailable.')}</p></Panel> : <Empty>{text('ไม่พบรายการนี้ในหน้าผลอ่านล่าสุด อาจเปลี่ยนหน้าหรือขอบเขตแล้ว กลับหน้ารายการเพื่อตรวจอีกครั้ง', 'This record is absent from the latest returned page. Return to the list and review the current scope.')}<WorkspaceLink to={`${listUrl}${suffix}`}>{text('เปิดรายการเดิม', 'Open this list')}</WorkspaceLink></Empty> : <>
          <p role="status">{state.data.rows.length} {text('รายการที่อ่านพบในหน้านี้', 'records returned on this page')} · {text('ทั้งหมดตามผลอ่าน', 'Reported total')}: {state.data.total}</p>
          {!state.data.rows.length ? <Empty>{parsed.q ? text('ไม่พบรายการตรงคำค้น ลองล้างตัวกรอง', 'No matching records. Try clearing filters.') : text('ยังไม่มีรายการในหน้านี้ ลองอ่านใหม่หรือกลับหน้าแรก', 'No records on this page. Refresh or return to the first page.')}<Button variant="secondary" onClick={clear}>{text('กลับหน้าแรกและล้างคำค้น', 'First page and clear search')}</Button></Empty> : <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{state.data.rows.map(r => <Panel key={r.id}><div className="p-4 space-y-3"><WorkspaceLink to={`${listUrl}/${r.id}${suffix}`}>{r.name}</WorkspaceLink><p>{text('สถานะที่บันทึก', 'Recorded stage')}: {stageLabel(r.stage)}</p><p className="text-sm break-all">{text('ผู้ดูแล', 'Owner')}: {r.ownerId ? r.ownerName || r.ownerId : text('ยังไม่มีผู้ดูแล', 'Unassigned')}</p></div></Panel>)}</div>}
          <div className="flex flex-wrap gap-3 items-center"><Button variant="secondary" disabled={parsed.page === 1} onClick={() => changePage(parsed.page - 1)}>{text('หน้าก่อน', 'Previous page')}</Button><span>{text('หน้า', 'Page')} {parsed.page}</span><Button variant="secondary" disabled={parsed.page * 20 >= state.data.total} onClick={() => changePage(parsed.page + 1)}>{text('หน้าถัดไป', 'Next page')}</Button><Button onClick={state.reload}>{text('อ่านใหม่', 'Refresh')}</Button></div>
        </>}
      </>}
    </>}
  </CommercePage>;
}
