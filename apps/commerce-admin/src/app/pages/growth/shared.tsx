import type { GrowthEvidence, GrowthReadiness, GrowthStatus, GrowthTemplate } from '@cp/growth';
import { Alert, Button, Chip, DetailSection, Empty, Loading, Panel, PanelHead, fmt } from '@cp/ui';
import { api } from '../../../lib/api';
import { useAsync, type AsyncState } from '../../hooks';

export const templateLabels: Record<GrowthTemplate, string> = {
  cart_idle: 'ตะกร้าค้าง', reorder: 'ซื้อซ้ำ', winback: 'Winback', market: 'โอกาสจากตลาด',
};
const statusLabels: Record<GrowthStatus, string> = {
  draft: 'ร่าง', review: 'รอตรวจ', approved: 'อนุมัติแล้ว', exporting: 'กำลังสร้างร่าง workflow',
  ready: 'สร้างร่าง workflow แล้ว', export_unknown: 'ต้องตรวจการสร้าง workflow',
};
export function PlanStatus({ status }: { status: GrowthStatus }) {
  return <Chip tone={status === 'approved' || status === 'ready' ? 'ok' : status === 'review' || status === 'export_unknown' ? 'warn' : 'muted'}>{statusLabels[status]}</Chip>;
}
export function LoadState({ state }: { state: AsyncState<unknown> }) {
  if (state.loading) return <Loading />;
  if (state.error) return <Alert tone="danger" actions={<Button onClick={state.reload} size="sm">ลองใหม่</Button>}>{state.error}</Alert>;
  return null;
}
export function Readiness() {
  const state = useAsync(() => api.get<GrowthReadiness>('/growth/readiness'));
  return <Panel>
    <PanelHead title="ความพร้อมของแผน" icon="verified_user" />
    <div className="p-4 space-y-3">
      <LoadState state={state} />
      {!state.loading && !state.error && state.data && <>
        <div className="flex flex-wrap gap-2">
          <Chip tone={state.data.replica ? 'ok' : 'warn'}>ข้อมูลร้าน · {state.data.replica ? (state.data.dataSource === 'copies' ? 'สำเนาใน commerce' : 'เชื่อมแล้ว') : 'ยังไม่เชื่อม'}</Chip>
          <Chip tone={state.data.ai ? 'ok' : 'muted'}>AI · {state.data.ai ? 'พร้อมร่าง' : 'ยังไม่เชื่อม'}</Chip>
          <Chip tone={state.data.workflow ? 'ok' : 'muted'}>Workflow · {state.data.workflow ? 'พร้อมสร้างร่าง' : 'ยังไม่เชื่อม'}</Chip>
        </div>
        <Alert tone="warn" title="สร้างแผนและอนุมัติได้ · workflow ที่สร้างจะหยุดไว้">
          <p>การบันทึก อนุมัติ หรือสร้างร่าง workflow ไม่ส่งข้อความ การตรวจสต็อก กำไร และงบ ณ เวลาส่งยังไม่พร้อมสำหรับเปิดใช้แผนนี้</p>
          {state.data.activationBlockers.length > 0 && <ul className="list-disc pl-4 mt-2 space-y-1">{state.data.activationBlockers.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
        </Alert>
      </>}
    </div>
  </Panel>;
}
export function Evidence({ items }: { items: GrowthEvidence[] }) {
  return <DetailSection title={`หลักฐาน ${items.length} รายการ`} icon="fact_check">
    {!items.length ? <Empty icon="fact_check">ยังไม่มีหลักฐานที่ยืนยันได้</Empty> : <div className="space-y-3">
      {items.map((item) => <article key={item.id} className="rounded-lg bg-surface-container-low p-3 space-y-1 min-w-0">
        <div className="flex flex-wrap gap-2 items-center"><Chip>{item.source}</Chip><span className="text-[10px] text-outline">เก็บเมื่อ {fmt.when(item.collectedAt)}</span></div>
        <div className="text-xs font-semibold break-words">{item.url && /^https?:\/\//i.test(item.url) ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{item.title}</a> : item.title}</div>
        <p className="text-xs text-on-surface-variant break-words">{item.excerpt}</p>
        <div className="text-[10px] font-mono text-outline break-all">{item.id}</div>
      </article>)}
    </div>}
  </DetailSection>;
}
export function localDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
