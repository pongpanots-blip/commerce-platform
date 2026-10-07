import { FormEvent, ReactNode, useState } from 'react';
import { Button, ErrorText, Hint, Input, Page, PageHeader, Panel, PanelHead, Select } from '@cp/ui';
import { stockApi, StockWarehouse } from '../../lib/api';
import { useAsync } from '../hooks';

type Tab = 'receive' | 'count' | 'adjust' | 'transfer';
const TABS: Array<[Tab, string]> = [['receive', 'รับเข้า'], ['count', 'ตรวจนับ'], ['adjust', 'เสียหาย / คืน / แก้ไข'], ['transfer', 'โอนย้าย']];

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-[160px] flex-1">
      <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">{label}</label>
      {children}
    </div>
  );
}

/**
 * Stock moves for warehouses commerce owns (stage 3): every change goes through the ledger (movement, level and
 * inventory.sellable.snapshot to josh in one transaction). ERP warehouses are not listed — their stock changes in the ERP.
 */
export function StockMoves() {
  const warehouses = useAsync(() => stockApi.warehouses(), []);
  const own = (warehouses.data ?? []).filter((w: StockWarehouse) => w.stockSource === 'commerce');
  const [tab, setTab] = useState<Tab>('receive');
  const [form, setForm] = useState({ sku: '', warehouse: '', to: '', quantity: '', reason: 'DAMAGE', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setDone(null);
    const quantity = Number(form.quantity);
    const note = form.note.trim() || undefined;
    try {
      if (tab === 'transfer') {
        const r = await stockApi.transfer({ sku: form.sku.trim(), fromWarehouseCode: form.warehouse, toWarehouseCode: form.to, quantity, note });
        setDone(`โอน ${quantity} แล้ว · ${r.from.warehouse} เหลือ ${r.from.quantity} · ${r.to.warehouse} มี ${r.to.quantity}`);
      } else {
        const body = tab === 'receive' ? { mode: 'add' as const, quantity, reason: 'RECEIVE' }
          : tab === 'count' ? { mode: 'set' as const, quantity, reason: 'COUNT' }
          : { mode: 'add' as const, quantity: form.reason === 'DAMAGE' ? -Math.abs(quantity) : quantity, reason: form.reason };
        const r = await stockApi.adjust({ sku: form.sku.trim(), warehouseCode: form.warehouse, note, ...body });
        setDone(`บันทึกแล้ว · ${form.warehouse} ${r.previousQuantity} → ${r.quantity}`);
      }
      setForm({ ...form, quantity: '', note: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader title="เคลื่อนไหว stock" subtitle="รับเข้า ตรวจนับ ปรับ และโอนย้าย ในคลังของเรา (stock_source = commerce) · ทุกครั้งบันทึกใน ledger และส่งยอดขายได้ให้ร้าน" />
      <ErrorText error={warehouses.error ?? error} />
      {warehouses.data && own.length === 0 && (
        <Hint>ยังไม่มีคลังที่ commerce เป็นเจ้าของ stock — คลังจาก ERP ปรับใน ERP แล้วยอดจะเข้ามาเอง</Hint>
      )}
      <Panel>
        <PanelHead title={TABS.find(([t]) => t === tab)?.[1] ?? ''} />
        <div className="px-4 pt-3 flex gap-2">
          {TABS.map(([t, label]) => (
            <Button key={t} variant={t === tab ? 'primary' : 'secondary'} onClick={() => { setTab(t); setDone(null); setError(null); }}>{label}</Button>
          ))}
        </div>
        <form className="px-4 py-3 flex flex-wrap items-end gap-3" onSubmit={submit}>
          <Labeled label="SKU"><Input value={form.sku} onChange={set('sku')} required maxLength={64} /></Labeled>
          <Labeled label={tab === 'transfer' ? 'จากคลัง' : 'คลัง'}>
            <Select value={form.warehouse} onChange={set('warehouse')} required>
              <option value="">เลือกคลัง</option>
              {own.map((w) => <option key={w.code} value={w.code}>{w.code} — {w.name}{w.sellable ? '' : ' (ไม่นับเป็นยอดขายได้)'}</option>)}
            </Select>
          </Labeled>
          {tab === 'transfer' && (
            <Labeled label="ไปคลัง">
              <Select value={form.to} onChange={set('to')} required>
                <option value="">เลือกคลัง</option>
                {own.filter((w) => w.code !== form.warehouse).map((w) => <option key={w.code} value={w.code}>{w.code} — {w.name}</option>)}
              </Select>
            </Labeled>
          )}
          {tab === 'adjust' && (
            <Labeled label="เหตุผล">
              <Select value={form.reason} onChange={set('reason')}>
                <option value="DAMAGE">เสียหาย (ลด)</option>
                <option value="RETURN">รับคืน (เพิ่ม)</option>
                <option value="CORRECTION">แก้ไข (+ เพิ่ม / − ลด)</option>
              </Select>
            </Labeled>
          )}
          <Labeled label={tab === 'count' ? 'นับได้' : 'จำนวน'}>
            <Input type="number" step={1} min={tab === 'adjust' && form.reason === 'CORRECTION' ? undefined : tab === 'count' ? 0 : 1}
              value={form.quantity} onChange={set('quantity')} required />
          </Labeled>
          <Labeled label="หมายเหตุ"><Input value={form.note} onChange={set('note')} maxLength={200} /></Labeled>
          <Button type="submit" variant="primary" disabled={busy || own.length === 0}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</Button>
        </form>
        {done && <div className="px-4 pb-3 text-xs text-on-surface-variant">{done}</div>}
      </Panel>
    </Page>
  );
}
