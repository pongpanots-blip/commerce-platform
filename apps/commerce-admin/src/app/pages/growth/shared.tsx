import type { GrowthEvidence, GrowthReadiness, GrowthStatus, GrowthTemplate } from '@cp/growth';
import { Alert, Button, Chip, DetailSection, Empty, ErrorText, Loading, Panel, PanelHead, fmt } from '@cp/ui';
import { api } from '../../../lib/api';
import { useAsync, type AsyncState } from '../../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export const templateLabels: Record<GrowthTemplate, string> = {
  get cart_idle(){return __uiText("ตะกร้าค้าง");}, get reorder(){return __uiText("ซื้อซ้ำ");}, get winback(){return __uiText("ชวนลูกค้าเก่ากลับมา");}, get market(){return __uiText("โอกาสจากตลาด");},
};
const statusLabels: Record<GrowthStatus, string> = {
  get draft(){return __uiText("ร่าง");}, get review(){return __uiText("รอตรวจ");}, get approved(){return __uiText("อนุมัติแล้ว");}, get exporting(){return __uiText("กำลังสร้างร่าง workflow");},
  get ready(){return __uiText("สร้างร่าง workflow แล้ว");}, get export_unknown(){return __uiText("ต้องตรวจการสร้าง workflow");},
};
export function PlanStatus({ status }: { status: GrowthStatus }) {
  __useUiLocale();
  return <Chip tone={status === 'approved' || status === 'ready' ? 'ok' : status === 'review' || status === 'export_unknown' ? 'warn' : 'muted'}>{statusLabels[status]}</Chip>;
}
export function LoadState({ state }: { state: AsyncState<unknown> }) {
  __useUiLocale();
  if (state.loading) return <Loading />;
  if (state.error) return <div className="space-y-3"><ErrorText error={state.error} /><Button onClick={state.reload} size="sm">{__uiText("ลองใหม่")}</Button></div>;
  return null;
}
export function Readiness() {
  __useUiLocale();
  const state = useAsync(() => api.get<GrowthReadiness>('/growth/readiness'));
  return <Panel>
    <PanelHead title={__uiText("ความพร้อมของแผน")} icon="verified_user" />
    <div className="p-4 space-y-3">
      <LoadState state={state} />
      {!state.loading && !state.error && state.data && <>
        <div className="flex flex-wrap gap-2">
          <Chip tone={state.data.replica ? 'ok' : 'warn'}>{__uiText("ข้อมูลร้าน · ")}{state.data.replica ? (state.data.dataSource === 'copies' ? 'สำเนาใน commerce' : 'เชื่อมแล้ว') : __uiText("ยังไม่เชื่อม")}</Chip>
          <Chip tone={state.data.ai ? 'ok' : 'muted'}>{__uiText("AI · ")}{state.data.ai ? __uiText("พร้อมร่าง") : __uiText("ยังไม่เชื่อม")}</Chip>
          <Chip tone={state.data.workflow ? 'ok' : 'muted'}>{__uiText("Workflow · ")}{state.data.workflow ? __uiText("พร้อมสร้างร่าง") : __uiText("ยังไม่เชื่อม")}</Chip>
        </div>
        <Alert tone="warn" title={__uiText("สร้างแผนและอนุมัติได้ · workflow ที่สร้างจะหยุดไว้")}>
          <p>{__uiText("การบันทึก อนุมัติ หรือสร้างร่าง workflow ไม่ส่งข้อความ การตรวจสต็อก กำไร และงบ ณ เวลาส่งยังไม่พร้อมสำหรับเปิดใช้แผนนี้")}</p>
          {state.data.activationBlockers.length > 0 && <ul className="list-disc pl-4 mt-2 space-y-1">{state.data.activationBlockers.map((reason) => <li key={reason}>{__uiText(reason)}</li>)}</ul>}
        </Alert>
      </>}
    </div>
  </Panel>;
}
export function Evidence({ items }: { items: GrowthEvidence[] }) {
  __useUiLocale();
  return <DetailSection title={__uiText("หลักฐาน {0} รายการ", {"0": items.length})} icon="fact_check">
    {!items.length ? <Empty icon="fact_check">{__uiText("ยังไม่มีหลักฐานที่ยืนยันได้")}</Empty> : <div className="space-y-3">
      {items.map((item) => <article key={item.id} className="rounded-lg bg-surface-container-low p-3 space-y-1 min-w-0">
        <div className="flex flex-wrap gap-2 items-center"><Chip>{item.source}</Chip><span className="text-[10px] text-outline">{__uiText("เก็บเมื่อ ")}{fmt.when(item.collectedAt)}</span></div>
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
