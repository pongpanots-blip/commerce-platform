// ui-metadata-migration: static labels and UI notices only
import { FormEvent, useState } from 'react';
import { Alert, Button, ErrorText, Field, Hint, Icon, Input, Loading, MasterDataSelect, Page, PageHeader, Panel, PanelHead, Select } from '@cp/ui';
import { stockApi, StockWarehouse } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
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
export function StockMoves() {
  __useUiLocale();
  const warehouses = useAsync(() => stockApi.warehouses(), []);
  const own = (warehouses.data ?? []).filter((w: StockWarehouse) => w.stockSource === 'commerce');
  const [tab, setTab] = useState<Tab>('receive');
  const [form, setForm] = useState({ sku: '', warehouse: '', to: '', quantity: '', reason: 'DAMAGE', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const task = TASKS.find(item => item.id === tab)!;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm(current => ({ ...current, [k]: e.target.value, ...(k === 'warehouse' && current.to === e.target.value ? { to: '' } : {}) }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setDone(null);
    const quantity = Number(form.quantity);
    const note = form.note.trim() || undefined;
    try {
      if (tab === 'transfer') {
        const r = await stockApi.transfer({ sku: form.sku.trim(), fromWarehouseCode: form.warehouse, toWarehouseCode: form.to, quantity, note });
        setDone(__uiMessage("โอน {0} แล้ว · {1} เหลือ {2} · {3} มี {4}", {"0": quantity, "1": r.from.warehouse, "2": r.from.quantity, "3": r.to.warehouse, "4": r.to.quantity}));
      } else {
        const body = tab === 'receive' ? { mode: 'add' as const, quantity, reason: 'RECEIVE' }
          : tab === 'count' ? { mode: 'set' as const, quantity, reason: 'COUNT' }
          : { mode: 'add' as const, quantity: form.reason === 'DAMAGE' ? -Math.abs(quantity) : quantity, reason: form.reason };
        const r = await stockApi.adjust({ sku: form.sku.trim(), warehouseCode: form.warehouse, note, ...body });
        setDone(__uiMessage("บันทึกแล้ว · {0} {1} → {2}", {"0": form.warehouse, "1": r.previousQuantity, "2": r.quantity}));
      }
      setForm({ ...form, quantity: '', note: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader title={__uiText("ความเคลื่อนไหวสต็อก")} subtitle={__uiText("เลือกงานที่ต้องการ แล้วบันทึกการเปลี่ยนแปลงสินค้าในคลังที่แพลตฟอร์มดูแล")} actions={<Button icon="refresh" onClick={warehouses.reload}>{__uiText("รีเฟรชคลัง")}</Button>} />
      <ErrorText error={warehouses.error ?? error} />
      {warehouses.loading && !warehouses.data && <Loading />}
      {warehouses.data && own.length === 0 && (
        <Hint>{__uiText("ยังไม่มีคลังที่ปรับยอดผ่านแพลตฟอร์มได้ หากเป็นคลังจาก ERP ให้บันทึกใน ERP แล้วรอซิงก์ยอดเข้ามา")}</Hint>
      )}
      {done && <Alert tone="ok" title={__uiText("บันทึกสต็อกเรียบร้อย")} onClose={() => setDone(null)}>{(typeof done === 'string' ? __uiText(done) : done)}</Alert>}
      <div role="group" aria-label={__uiText("ประเภทการเคลื่อนไหวสต็อก")} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {TASKS.map(item => <button key={item.id} type="button" aria-pressed={item.id === tab} disabled={busy} onClick={() => { setTab(item.id); setForm(current => ({ ...current, quantity: '' })); setDone(null); setError(null); }}
          className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60 ${item.id === tab ? 'border-primary bg-primary-container/40' : 'border-secondary-container bg-white hover:border-primary/50'}`}>
          <Icon name={item.icon} size={22} className="mt-0.5 shrink-0 text-primary" />
          <span><span className="block font-semibold">{__uiText(item.title)}</span><span className="mt-1 block text-xs leading-relaxed text-on-surface-variant">{__uiText(item.description)}</span></span>
        </button>)}
      </div>
      <Panel>
        <PanelHead title={__uiText("บันทึก{0}", {"0": task.title})} icon={task.icon} sub={task.hint} />
        <form onSubmit={submit}>
          <fieldset disabled={busy} className="grid min-w-0 gap-4 p-4 md:grid-cols-2 md:p-5">
          <Field label={__uiText("สินค้า")} hint={__uiText("รหัสสินค้าที่ต้องการบันทึก")}><Input value={form.sku} onChange={set('sku')} required maxLength={64} placeholder="BREAD-001" /></Field>
          <Field label={tab === 'transfer' ? __uiText("จากคลัง") : __uiText("คลัง")}>
            <MasterDataSelect
              required
              options={own.map((w) => ({ value: w.code, label: `${w.code} — ${w.name}${w.sellable ? '' : __uiText(" (ไม่นับเป็นยอดขายได้)")}` }))}
              value={form.warehouse}
              onChange={(next) => set('warehouse')({ target: { value: String(next) } })}
            />
          </Field>
          {tab === 'transfer' && (
            <Field label={__uiText("ไปคลัง")}>
              <MasterDataSelect
                required
                options={own.filter((w) => w.code !== form.warehouse).map((w) => ({ value: w.code, label: `${w.code} — ${w.name}` }))}
                value={form.to}
                onChange={(next) => set('to')({ target: { value: String(next) } })}
              />
            </Field>
          )}
          {tab === 'adjust' && (
            <Field label={__uiText("เหตุผล")}>
              <Select value={form.reason} onChange={set('reason')}>
                <option value="DAMAGE">{__uiText("เสียหาย (ลด)")}</option>
                <option value="RETURN">{__uiText("รับคืน (เพิ่ม)")}</option>
                <option value="CORRECTION">{__uiText("แก้ไข (+ เพิ่ม / − ลด)")}</option>
              </Select>
            </Field>
          )}
          <Field label={tab === 'count' ? __uiText("ยอดที่นับได้ทั้งหมด") : __uiText("จำนวน")} hint={tab === 'adjust' && form.reason === 'CORRECTION' ? __uiText("จำนวนบวกเพื่อเพิ่มยอด หรือจำนวนลบเพื่อลดยอด") : undefined}>
            <Input type="number" step={1} min={tab === 'adjust' && form.reason === 'CORRECTION' ? undefined : tab === 'count' ? 0 : 1}
              value={form.quantity} onChange={set('quantity')} required />
          </Field>
          <Field label={__uiText("หมายเหตุ")} hint={__uiText("ระบุเอกสารหรือรายละเอียดเพิ่มเติม (ไม่บังคับ)")}><Input value={form.note} onChange={set('note')} maxLength={200} /></Field>
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-secondary-container bg-surface-container-low/40 px-4 py-4 md:px-5">
            <p className="text-xs text-on-surface-variant">{__uiText("ตรวจ SKU คลัง และจำนวนให้ถูกต้องก่อนบันทึก")}</p>
            <Button type="submit" variant="primary" disabled={busy || warehouses.loading || own.length === 0}>{busy ? __uiText("กำลังบันทึก…") : __uiText("บันทึก{0}", {"0": task.title})}</Button>
          </div>
        </form>
      </Panel>
    </Page>
  );
}
