// ui-metadata-migration: static labels and UI notices only
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, ButtonLink, Empty, ErrorText, Hint, Icon, Loading, Page, PageHeader, Panel, PanelHead, TaskForm, TaskInput, TaskSelect, TaskMasterDataSelect, useTaskFormState, useUnsavedChanges, type TaskFieldErrors } from '@cp/ui';
import { stockApi, inventoryOverviewApi, StockWarehouse, StockAdjustResult } from '../../lib/api';
import { useAsync } from '../hooks';
import { InterruptedAction, requireSaved, taskMessages, useActionDraft, writeFailure } from '../task-forms';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
/** Same values as commerce-platform inventory MovementStatus. */
const MOVE_STATUS: Record<string, string> = { applied: 'นำไปใช้แล้ว', stale: 'ข้อมูลเก่ากว่ายอดปัจจุบัน ไม่ได้ใช้', ignored: 'ไม่ได้ใช้ เพราะคลังนี้ปรับยอดที่อื่น' };
type Tab = 'receive' | 'count' | 'adjust' | 'transfer';
const TASKS = [
  { id: 'receive', get title() { return __uiText("รับเข้า"); }, icon: 'inbox', get description() { return __uiText("เพิ่มสินค้าที่ได้รับเข้าในคลัง"); }, get hint() { return __uiText("ระบุจำนวนที่รับเพิ่ม ระบบจะบวกเข้ากับยอดคงเหลือเดิม"); } },
  { id: 'count', get title() { return __uiText("ตรวจนับ"); }, icon: 'fact_check', get description() { return __uiText("ปรับยอดตามจำนวนที่นับได้จริง"); }, get hint() { return __uiText("ระบุยอดทั้งหมดที่นับได้ ระบบจะใช้จำนวนนี้แทนยอดคงเหลือเดิม"); } },
  { id: 'adjust', get title() { return __uiText("ปรับยอด"); }, icon: 'edit_note', get description() { return __uiText("บันทึกสินค้าเสียหาย รับคืน หรือแก้ไขยอด"); }, get hint() { return __uiText("เลือกเหตุผลก่อนกรอกจำนวน: เสียหายจะลดยอด รับคืนจะเพิ่มยอด และแก้ไขใช้จำนวนบวกหรือลบได้"); } },
  { id: 'transfer', get title() { return __uiText("โอนย้าย"); }, icon: 'sync_alt', get description() { return __uiText("ย้ายสินค้าจากคลังหนึ่งไปอีกคลัง"); }, get hint() { return __uiText("จำนวนนี้จะลดจากคลังต้นทางและเพิ่มในคลังปลายทาง โดยต้องเลือกคนละคลัง"); } },
] as const;

/**
 * Stock moves for warehouses commerce owns (stage 3): every change goes through the ledger (movement, level and
 * inventory.sellable.snapshot to josh in one transaction). ERP warehouses are not listed — their stock changes in the ERP.
 */
export interface StockDraft { sku: string; warehouse: string; to: string; quantity: string; reason: string; note: string; [key: string]: string }
export function validateStockTask(tab: Tab, form: StockDraft, own: StockWarehouse[]): TaskFieldErrors {
  const errors: TaskFieldErrors = {};
  if (!form.sku.trim() || form.sku.trim().length > 64) errors.sku = __uiText('กรอกรหัสสินค้า 1–64 ตัวอักษร');
  if (!own.some(w => w.code === form.warehouse)) errors.warehouse = __uiText('เลือกคลังที่แพลตฟอร์มดูแล');
  if (tab === 'transfer' && (!own.some(w => w.code === form.to) || form.to === form.warehouse)) errors.to = __uiText('เลือกคลังปลายทางที่ต่างจากต้นทาง');
  if (tab === 'adjust' && !['DAMAGE', 'RETURN', 'CORRECTION'].includes(form.reason)) errors.reason = __uiText('เลือกเหตุผลที่รองรับ');
  const min = tab === 'count' ? 0 : tab === 'adjust' && form.reason === 'CORRECTION' ? -1_000_000 : 1;
  const qty = Number(form.quantity);
  if (!form.quantity.trim() || !Number.isInteger(qty) || qty < min || qty > 1_000_000) errors.quantity = __uiText('กรอกจำนวนเต็มระหว่าง {0} ถึง {1}', { 0: min, 1: 1_000_000 });
  if (form.note.length > 200) errors.note = __uiText('หมายเหตุไม่เกิน 200 ตัวอักษร');
  return errors;
}
export function stockTaskBody(tab: Exclude<Tab, 'transfer'>, form: StockDraft) {
  const quantity = Number(form.quantity);
  return { sku: form.sku.trim(), warehouseCode: form.warehouse, note: form.note.trim() || undefined,
    ...(tab === 'receive' ? { mode: 'add' as const, quantity, reason: 'RECEIVE' } : tab === 'count' ? { mode: 'set' as const, quantity, reason: 'COUNT' } : { mode: 'add' as const, quantity: form.reason === 'DAMAGE' ? -Math.abs(quantity) : quantity, reason: form.reason }) };
}
const applied = (r: StockAdjustResult) => r?.status === 'applied' && [r.previousQuantity, r.quantity, r.reserved].every(Number.isFinite);

export function StockMoves() {
  const location = useLocation();
  const route = location.pathname.split('/')[2];
  if (!TASKS.some(task => task.id === route)) return <Navigate replace to={`/stock-moves/receive${location.search}${location.hash}`} />;
  return <StockTask key={route} tab={route as Tab} />;
}
function StockTask({ tab }: { tab: Tab }) {
  __useUiLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const warehouses = useAsync(() => stockApi.warehouses(), []);
  const own = (warehouses.data ?? []).filter((w: StockWarehouse) => w.stockSource === 'commerce');
  const draft = useActionDraft<StockDraft>(`stock:${tab}`, { sku: '', warehouse: '', to: '', quantity: '', reason: 'DAMAGE', note: '' });
  const form = draft.values;
  const [done, setDone] = useState<string | null>(null);
  const task = TASKS.find(item => item.id === tab)!;
  const requestLeave = useUnsavedChanges(draft.dirty || draft.pending);
  const set = (k: keyof StockDraft) => (e: { target: { value: string } }) => draft.set(current => ({ ...current, [k]: e.target.value, ...(k === 'warehouse' && current.to === e.target.value ? { to: '' } : {}) }));
  async function checkLatest() {
    const codes = tab === 'transfer' ? [form.warehouse, form.to] : [form.warehouse];
    const readings = await Promise.all(codes.map(code => inventoryOverviewApi.get(code, form.sku.trim(), 1)));
    return readings.map((data, index) => {
      const item = data.items.find(row => row.sku === form.sku.trim() && row.warehouseCode === codes[index]);
      return item ? `${item.sku} · ${item.warehouseCode}: ${item.quantity} (${__uiText('จองแล้ว')}: ${item.reserved}) · ${item.lastStatus ? (MOVE_STATUS[item.lastStatus] ? __uiText(MOVE_STATUS[item.lastStatus]) : item.lastStatus) : '—'}` : __uiText('ไม่พบรหัสสินค้านี้ในผลค้นหาล่าสุด ตรวจรายการก่อนลองใหม่');
    }).join(' · ');
  }
  async function submit(_data: FormData, signal: AbortSignal) {
    if (warehouses.loading || warehouses.error || !draft.begin(signal)) return { ok: false as const, formError: __uiText('รอข้อมูลที่จำเป็นโหลดเสร็จ แล้วลองอีกครั้ง') };
    try {
      let message: string;
      if (tab === 'transfer') {
        const r = requireSaved(await stockApi.transfer({ sku: form.sku.trim(), fromWarehouseCode: form.warehouse, toWarehouseCode: form.to, quantity: Number(form.quantity), note: form.note.trim() || undefined }), r => applied(r.from) && applied(r.to) && r.from.warehouse === form.warehouse && r.to.warehouse === form.to);
        message = __uiMessage('โอน {0} แล้ว · {1} เหลือ {2} · {3} มี {4}', { 0: Number(form.quantity), 1: r.from.warehouse, 2: r.from.quantity, 3: r.to.warehouse, 4: r.to.quantity });
      } else {
        const r = requireSaved(await stockApi.adjust(stockTaskBody(tab, form)), applied);
        message = __uiMessage('บันทึกแล้ว · {0} {1} → {2}', { 0: form.warehouse, 1: r.previousQuantity, 2: r.quantity });
      }
      if (!signal.aborted) { draft.clear(); setDone(message); }
      return { ok: true as const, receipt: { message } };
    } catch (error) { if (!signal.aborted) draft.fail(error); return writeFailure(error); }
    finally { draft.settle(); }
  }
  return (
    <Page>
      <PageHeader title={__uiText("ความเคลื่อนไหวสต็อก")} subtitle={__uiText("เลือกงานที่ต้องการ แล้วบันทึกการเปลี่ยนแปลงสินค้าในคลังที่แพลตฟอร์มดูแล")} actions={<Button icon="refresh" onClick={warehouses.reload}>{__uiText("รีเฟรชคลัง")}</Button>} />
      <ErrorText error={warehouses.error} onRetry={warehouses.reload} />
      {warehouses.loading && !warehouses.data && <Loading variant="form" />}
      {warehouses.data && own.length === 0 && (
        // Every warehouse still takes its stock from the ERP: nothing here can be recorded yet, so say so instead of a dead form.
        <Panel>
          <Empty icon="warehouse"><div className="flex flex-col items-center gap-3 text-center">
            <span className="block text-sm font-semibold text-on-surface">{__uiText("ยังไม่มีคลังที่บันทึกสต็อกในระบบนี้ได้")}</span>
            <span className="block max-w-md">{__uiText("ทุกคลังรับยอดสต็อกจากระบบหลัก (ERP) ให้รับเข้า ปรับ หรือโอนใน ERP แล้วยอดจะซิงก์มาเอง หน้านี้จะใช้ได้เมื่อมีคลังที่ระบบนี้ดูแลเอง")}</span>
            <ButtonLink to="/erp/inventory-warehouse" variant="primary" icon="inventory_2">{__uiText("ดูสต็อกแต่ละคลัง")}</ButtonLink>
          </div></Empty>
        </Panel>
      )}
      {draft.recovered && !draft.interrupted && <Hint>{__uiText('กู้คืนข้อมูลที่ยังไม่บันทึกแล้ว ตรวจข้อมูลก่อนบันทึก')}</Hint>}
      {draft.interrupted && <InterruptedAction onCheck={checkLatest} onContinue={draft.acknowledge} outstanding={draft.outstanding} />}
      {done && <Alert tone="ok" title={__uiText("บันทึกสต็อกเรียบร้อย")} onClose={() => setDone(null)}>{(typeof done === 'string' ? __uiText(done) : done)}</Alert>}
      {!(warehouses.data && own.length === 0) && <>
      <div role="group" aria-label={__uiText("ประเภทการเคลื่อนไหวสต็อก")} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {TASKS.map(item => <button key={item.id} type="button" aria-pressed={item.id === tab} disabled={draft.pending} onClick={() => { if (item.id !== tab) void requestLeave(() => navigate(`/stock-moves/${item.id}${location.search}${location.hash}`)); }}
          className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60 ${item.id === tab ? 'border-primary bg-primary-container/40' : 'border-secondary-container bg-white hover:border-primary/50'}`}>
          <Icon name={item.icon} size={22} className="mt-0.5 shrink-0 text-primary" />
          <span><span className="block font-semibold">{__uiText(item.title)}</span><span className="mt-1 block text-xs leading-relaxed text-on-surface-variant">{__uiText(item.description)}</span></span>
        </button>)}
      </div>
      <Panel>
        <PanelHead title={`${__uiText('บันทึก')} ${task.title}`} icon={task.icon} sub={task.hint} />
        <TaskForm appearance="stitch" messages={taskMessages()} onSubmit={submit} validate={() => validateStockTask(tab, form, own)} disabled={draft.interrupted || draft.outstanding || warehouses.loading || !!warehouses.error || own.length === 0}>
          <fieldset disabled={draft.pending} className="grid min-w-0 gap-4 p-4 md:grid-cols-2 md:p-5">
          <TaskInput name="sku" label={__uiText("สินค้า")} help={__uiText("รหัสสินค้าที่ต้องการบันทึก")} value={form.sku} onChange={set('sku')} required maxLength={64} placeholder="BREAD-001" />
            <TaskMasterDataSelect name="warehouse" label={tab === 'transfer' ? __uiText("จากคลัง") : __uiText("คลัง")}
              required
              options={own.map((w) => ({ value: w.code, label: `${w.code} — ${w.name}${w.sellable ? '' : __uiText(" (ไม่นับเป็นยอดขายได้)")}` }))}
              value={form.warehouse}
              onChange={(next) => set('warehouse')({ target: { value: String(next) } })}
            />
          {tab === 'transfer' && (
              <TaskMasterDataSelect name="to" label={__uiText("ไปคลัง")}
                required
                options={own.filter((w) => w.code !== form.warehouse).map((w) => ({ value: w.code, label: `${w.code} — ${w.name}` }))}
                value={form.to}
                onChange={(next) => set('to')({ target: { value: String(next) } })}
              />
          )}
          {tab === 'adjust' && (
              <TaskSelect name="reason" label={__uiText("เหตุผล")} value={form.reason} onChange={set('reason')}>
                <option value="DAMAGE">{__uiText("เสียหาย (ลด)")}</option>
                <option value="RETURN">{__uiText("รับคืน (เพิ่ม)")}</option>
                <option value="CORRECTION">{__uiText("แก้ไข (+ เพิ่ม / − ลด)")}</option>
              </TaskSelect>
          )}
            <TaskInput name="quantity" label={tab === 'count' ? __uiText("ยอดที่นับได้ทั้งหมด") : __uiText("จำนวน")} help={tab === 'adjust' && form.reason === 'CORRECTION' ? __uiText("จำนวนบวกเพื่อเพิ่มยอด หรือจำนวนลบเพื่อลดยอด") : undefined} type="number" max={1_000_000} step={1} min={tab === 'adjust' && form.reason === 'CORRECTION' ? undefined : tab === 'count' ? 0 : 1}
              value={form.quantity} onChange={set('quantity')} required />
          <TaskInput name="note" label={__uiText("หมายเหตุ")} help={__uiText("ระบุเอกสารหรือรายละเอียดเพิ่มเติม (ไม่บังคับ)")} value={form.note} onChange={set('note')} maxLength={200} />
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-secondary-container bg-surface-container-low/40 px-4 py-4 md:px-5">
            <p className="text-xs text-on-surface-variant">{__uiText("ตรวจรหัสสินค้า คลัง และจำนวนให้ถูกต้องก่อนบันทึก")}</p>
            <StockSubmit label={`${__uiText('บันทึก')} ${task.title}`} />
          </div>
        </TaskForm>
      </Panel>
      </>}
    </Page>
  );
}

function StockSubmit({ label }: { label: string }) {
  const { busy, disabled } = useTaskFormState();
  return <Button type="submit" variant="primary" disabled={busy || disabled}>{busy ? __uiText('กำลังบันทึก…') : label}</Button>;
}
