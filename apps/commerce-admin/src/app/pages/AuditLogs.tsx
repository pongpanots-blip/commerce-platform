import { Fragment, ReactNode, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { auditLogsApi, AuditLogRow, Paginated } from '../../lib/api';
import { useAsync } from '../hooks';
import { Page, PageHeader, Panel, PanelHead, Table, THead, TH, TBody, TR, TD, ExpandRow, ExpandToggle, Pager, ErrorText, Empty, Loading, CodeBlock, DetailSection, Button, Input, Select, fmt } from '@cp/ui';
import { uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';

const PAGE_SIZE = 50;
const FILTERS = ['action', 'entityType', 'entityId', 'actorId', 'from', 'to', 'includeReads'] as const;
type FilterKey = typeof FILTERS[number];

/** Labels for what commerce-platform writes to audit_logs (staff accounts, josh actions, MCP, scheduled tasks, ERP simulator). Codes not listed show as-is. */
const ACTION: Record<string, string> = {
  'mcp.tool_call': 'ผู้ช่วย AI เปิดดูข้อมูล', 'mcp.write': 'ผู้ช่วย AI แก้ข้อมูล', 'scheduled_task.run': 'สั่งงานตามเวลาให้ทำทันที',
  'staff.create': 'สร้างบัญชีพนักงาน', 'staff.self_register': 'พนักงานสมัครเอง', 'staff.update': 'แก้บัญชีพนักงาน',
  'staff.reset_password': 'รีเซ็ตรหัสผ่านพนักงาน', 'staff.change_own_password': 'เปลี่ยนรหัสผ่านของตัวเอง',
  'josh_staff.update': 'แก้สิทธิ์พนักงานในร้านค้าออนไลน์', 'erp.simulator.send': 'ส่งข้อมูลทดสอบจากระบบขายจำลอง',
  'erp.simulator.josh_order': 'ส่งออเดอร์ทดสอบเข้าระบบขายจำลอง', 'josh.admin-call.call': 'ใช้หน้าจัดการร้านค้าออนไลน์',
};
/** josh actions are written as `josh.<target>.<verb>` (josh-actions.ts). */
const JOSH_TARGET: Record<string, string> = {
  winback: 'ดึงลูกค้ากลับ', 'push-campaigns': 'แคมเปญแจ้งเตือน', 'credit-applications': 'คำขอเครดิต', 'admin-access': 'สิทธิ์เข้าหน้าจัดการ',
  coupons: 'คูปอง', 'customer-prices': 'ราคาเฉพาะลูกค้า', 'contract-prices': 'ราคาตามสัญญา', products: 'สินค้า', promotions: 'โปรโมชัน',
  suppliers: 'ซัพพลายเออร์', 'internal-docs': 'เอกสารภายใน', 'marketing-workflows': 'ข้อความอัตโนมัติ', customers: 'ลูกค้า',
};
const JOSH_VERB: Record<string, string> = {
  create: 'สร้าง', update: 'แก้ไข', remove: 'ลบ', approve: 'อนุมัติ', reject: 'ไม่อนุมัติ', review: 'พิจารณา', set_active: 'เปิด/ปิดใช้งาน',
  assign: 'มอบหมาย', assign_sales: 'กำหนดเซลส์', set_target: 'ตั้งเป้า', update_branch: 'แก้สาขา', update_company: 'แก้ข้อมูลบริษัท',
  update_user: 'แก้ผู้ใช้', upload: 'อัปโหลด', pause: 'หยุด', test: 'ทดลองส่ง', schedule: 'ตั้งเวลาส่ง', send: 'ส่ง', set_cuisines: 'กำหนดประเภทร้าน',
};
const ENTITY: Record<string, string> = {
  mcp_tool: 'เครื่องมือผู้ช่วย AI', scheduled_task: 'งานตามเวลา', staff_account: 'บัญชีพนักงาน', josh_staff: 'พนักงานร้านค้าออนไลน์',
  erp_route: 'ระบบขายจำลอง', order: 'ออเดอร์', josh_action: 'งานในร้านค้าออนไลน์', 'josh.workflow': 'ข้อความอัตโนมัติ', 'josh.coupon': 'คูปอง',
  'josh.segment': 'กลุ่มลูกค้า', 'josh.campaign': 'แคมเปญ', 'josh.product_set': 'ชุดสินค้า', 'josh.promotion_page': 'หน้าโปรโมชัน',
  'josh.banner': 'แบนเนอร์', 'josh.notify_template': 'แม่แบบการแจ้งเตือน', 'josh.smart_link': 'ลิงก์อัจฉริยะ', 'josh.welcome_email': 'อีเมลต้อนรับ',
  'josh.push_campaign': 'แคมเปญแจ้งเตือน', 'josh.product': 'สินค้า',
};
const actionLabel = (code: string) => {
  if (ACTION[code]) return __uiText(ACTION[code]);
  const [, target, verb] = /^josh\.([a-z-]+)\.([a-z_]+)$/.exec(code) ?? [];
  return target && JOSH_TARGET[target] && JOSH_VERB[verb] ? `${__uiText(JOSH_TARGET[target])}: ${__uiText(JOSH_VERB[verb])}` : null;
};
const entityLabel = (code: string) => (ENTITY[code] ? __uiText(ENTITY[code]) : null);
/** Known code → label (code on hover); unknown code → the code in mono. */
const codeCell = (code: string, label: string | null) => (label ? <span title={code}>{label}</span> : <span className="font-mono text-[11px]">{code}</span>);

/** One line on what was touched; the writers store it in different places. */
const summaryOf = (r: AuditLogRow) => {
  const after = (r.after ?? {}) as Record<string, unknown>;
  const ctx = r.context ?? {};
  if (r.action === 'josh.admin-call.call') return `${after.method ?? ''} ${after.path ?? ''}`.trim();
  return String(ctx.summary ?? ctx.tool ?? after.email ?? '');
};

/** yyyy-mm-dd (local day) → ISO instant at local midnight, shifted by `days`. */
const dayStart = (day: string, days = 0) => {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

/** Who changed what and when. Filters live in the URL so other pages can link here (?actorId=…, ?entityType=…&entityId=…). */
export function AuditLogs() {
  __useUiLocale();
  const [params, setParams] = useSearchParams();
  const get = (k: FilterKey) => params.get(k) ?? '';
  const page = Number(params.get('page')) || 1;
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const setFilter = (k: FilterKey | 'page', v: string) => setParams((cur) => {
    const next = new URLSearchParams(cur);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== 'page') next.delete('page');
    return next;
  });

  const facets = useAsync(() => auditLogsApi.facets(), []);
  const { data, loading, error, reload } = useAsync<Paginated<AuditLogRow>>(() => auditLogsApi.list({
    action: get('action') || undefined,
    entityType: get('entityType') || undefined,
    entityId: get('entityId') || undefined,
    actorId: get('actorId') || undefined,
    from: get('from') ? dayStart(get('from')) : undefined,
    to: get('to') ? dayStart(get('to'), 1) : undefined,
    includeReads: get('includeReads') === 'true' || undefined,
    page, pageSize: PAGE_SIZE,
  }), [params.toString()]);

  const link = (k: FilterKey, v: string | null, label: ReactNode) => v
    ? <button type="button" className="text-left hover:underline" title={__uiText('กรองตามค่านี้')} onClick={() => setFilter(k, v)}>{label}</button>
    : <span>—</span>;

  return (
    <Page>
      <PageHeader title={__uiText('ประวัติการเปลี่ยนแปลง')} subtitle={__uiText('ใครแก้อะไรในระบบ และแก้เมื่อไหร่')} actions={<Button icon="refresh" onClick={reload}>{__uiText('รีเฟรช')}</Button>} />

      <Panel>
        <PanelHead title={__uiText('ตัวกรอง')} actions={<div className="flex flex-wrap items-center gap-2">
          <Input list="audit-actions" aria-label={__uiText('การกระทำ (ขึ้นต้นด้วย)')} placeholder={__uiText('การกระทำ (ขึ้นต้นด้วย)')} defaultValue={get('action')} key={`a-${get('action')}`}
            onBlur={(e) => setFilter('action', e.target.value.trim())} onKeyDown={(e) => { if (e.key === 'Enter') setFilter('action', e.currentTarget.value.trim()); }} className="w-56" />
          <datalist id="audit-actions">{facets.data?.actions.map((a) => <option key={a.value} value={a.value}>{actionLabel(a.value) ?? a.value} ({a.count})</option>)}</datalist>
          <Select aria-label={__uiText('ประเภทข้อมูล')} value={get('entityType')} onChange={(e) => setFilter('entityType', e.target.value)} className="w-48">
            <option value="">{__uiText('ทุกประเภทข้อมูล')}</option>
            {facets.data?.entityTypes.map((t) => <option key={t.value} value={t.value}>{entityLabel(t.value) ?? t.value} ({t.count})</option>)}
          </Select>
          <Input type="date" aria-label={__uiText('ตั้งแต่วันที่')} value={get('from')} onChange={(e) => setFilter('from', e.target.value)} className="w-40" />
          <Input type="date" aria-label={__uiText('ถึงวันที่')} value={get('to')} onChange={(e) => setFilter('to', e.target.value)} className="w-40" />
          <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
            <input type="checkbox" checked={get('includeReads') === 'true'} onChange={(e) => setFilter('includeReads', e.target.checked ? 'true' : '')} />
            {__uiText('รวมการเปิดดูข้อมูล')}
          </label>
          {get('actorId') &&<Button icon="close" onClick={() => setFilter('actorId', '')}>{__uiText('ผู้ทำ')}: {data?.items[0]?.actorEmail ?? get('actorId').slice(0, 8)}</Button>}
          {get('entityId') && <Button icon="close" onClick={() => setFilter('entityId', '')}>{__uiText('รหัสรายการ')}: {get('entityId').slice(0, 8)}</Button>}
          {FILTERS.some((k) => get(k)) && <Button onClick={() => setParams({})}>{__uiText('ล้างตัวกรอง')}</Button>}
        </div>} />
        <ErrorText error={error ?? facets.error} />
        {loading && !data ? <Loading /> : !data?.items.length ? (
          <Empty>{__uiText('ไม่มีประวัติที่ตรงกับตัวกรอง')}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText('เวลา')}</TH><TH>{__uiText('ผู้ทำ')}</TH><TH>{__uiText('การกระทำ')}</TH><TH>{__uiText('ประเภทข้อมูล')}</TH><TH>{__uiText('รหัสรายการ')}</TH><TH>{__uiText('สรุป')}</TH><TH></TH>
            </THead>
            <TBody>
              {data.items.map((r) => (
                <Fragment key={r.id}>
                  <TR>
                    <TD kind="time">{fmt.when(r.at)}</TD>
                    <TD>{link('actorId', r.actorId, r.actorEmail ?? r.actorId?.slice(0, 8) ?? '')}</TD>
                    <TD>{link('action', r.action, codeCell(r.action, actionLabel(r.action)))}</TD>
                    <TD>{link('entityType', r.entityType, codeCell(r.entityType, entityLabel(r.entityType)))}</TD>
                    <TD kind="mono">{link('entityId', r.entityId, r.entityId?.slice(0, 8) ?? '')}</TD>
                    <TD className="text-xs text-on-surface-variant max-w-md truncate" title={summaryOf(r)}>{summaryOf(r) || '—'}</TD>
                    <TD kind="actions"><ExpandToggle open={expandedId === r.id} onClick={() => setExpandedId((cur) => (cur === r.id ? null : r.id))} /></TD>
                  </TR>
                  {expandedId === r.id && (
                    <ExpandRow colSpan={7}>
                      <DetailSection title={__uiText('รายละเอียด')}>
                        <div className="grid md:grid-cols-3 gap-3">
                          <CodeBlock title={__uiText('ก่อนแก้')} value={r.before} maxHeight={300} />
                          <CodeBlock title={__uiText('หลังแก้')} value={r.after} maxHeight={300} />
                          <CodeBlock title={__uiText('ข้อมูลประกอบ')} value={r.context} maxHeight={300} />
                        </div>
                      </DetailSection>
                    </ExpandRow>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
        )}
        <Pager page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={(p) => setFilter('page', p > 1 ? String(p) : '')} />
      </Panel>
    </Page>
  );
}
