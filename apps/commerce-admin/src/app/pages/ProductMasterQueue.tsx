import { useState } from 'react';
import { Button, Checkbox, Empty, ErrorText, Hint, Page, PageHeader, Panel, PanelHead, SearchInput, Table, TBody, TD, TH, THead, TR } from '@cp/ui';
import { MasterPending, productMastersApi, productPricesApi } from '../../lib/api';
import { useAsync } from '../hooks';

const LABEL: Record<string, string> = {
  product_status: 'สถานะ', category_code: 'หมวด (รหัส)', brand_name: 'แบรนด์', selling_unit: 'หน่วยขาย', order_taking_unit: 'หน่วยสั่ง',
  erp_ordering_units: 'หน่วยที่สั่งได้', pack_size: 'ขนาดแพ็ก', packaging_type: 'ชนิดแพ็ก', units_per_box: 'ต่อกล่อง', weight_per_unit: 'น้ำหนักต่อหน่วย',
  vat_type: 'VAT', marketed_by: 'ผู้จัดจำหน่าย', product_type: 'ประเภท', order_taking_flag: 'สั่งล่วงหน้า', sup_code: 'supplier',
  season_start: 'เริ่มฤดู', season_end: 'จบฤดู',
};
const show = (v: unknown) => (v == null || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The MER queue of ERP changes to live products' units, pack, status, category … owned by commerce (stage 4d).
 * Approve applies only the fields the ERP changed; every change reaches josh as product.master.snapshot. New SKUs
 * (drafts) are still approved on the product page (josh).
 */
export function ProductMasterQueue() {
  const owned = useAsync(() => productPricesApi.ownership(), []);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const pending = useAsync(() => productMastersApi.pending(search), [search]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const isOwned = owned.data?.productMaster === true;

  const toggle = (sku: string) => setPicked((s) => { const n = new Set(s); n.has(sku) ? n.delete(sku) : n.add(sku); return n; });
  async function act(kind: 'approve' | 'reject') {
    setError(null);
    try {
      await (kind === 'approve' ? productMastersApi.approve([...picked]) : productMastersApi.reject([...picked]));
      setPicked(new Set());
      pending.reload();
    } catch (e) { setError(errText(e)); }
  }

  return (
    <Page>
      <PageHeader title="คิวข้อมูลสินค้าจาก ERP" subtitle="หน่วย แพ็ก แบรนด์ VAT สถานะ หมวด การสั่งซื้อ ของสินค้าที่ขายอยู่ · ERP เปลี่ยนแล้วรอ MER อนุมัติที่นี่ · สินค้าใหม่ (draft) อนุมัติที่หน้าสินค้า" />
      {owned.data && !isOwned && <Hint>ยังไม่ได้สลับ — คิวนี้ยังอยู่ที่ josh (COMMERCE_OWNS_PRODUCT_MASTER)</Hint>}
      <ErrorText error={error ?? pending.error ?? null} />
      <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); }}>
        <div className="flex-1 max-w-sm"><SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SKU" /></div>
        <Button type="submit">ค้นหา</Button>
      </form>
      <Panel>
        <PanelHead title={`รออนุมัติ (${pending.data?.length ?? 0})`} />
        <div className="px-4 py-2 flex gap-2">
          <Button variant="primary" disabled={!isOwned || picked.size === 0} onClick={() => void act('approve')}>อนุมัติ {picked.size || ''}</Button>
          <Button variant="danger-ghost" disabled={!isOwned || picked.size === 0} onClick={() => void act('reject')}>ไม่อนุมัติ</Button>
        </div>
        {pending.data?.length ? (
          <Table>
            <THead><TR><TH /><TH>SKU</TH><TH>ERP เปลี่ยน (ตอนนี้ → ใหม่)</TH><TH>ERP ส่งเมื่อ</TH></TR></THead>
            <TBody>
              {pending.data.map((r: MasterPending) => (
                <TR key={r.sku} selected={picked.has(r.sku)} onClick={() => toggle(r.sku)}>
                  <TD><Checkbox checked={picked.has(r.sku)} onChange={() => toggle(r.sku)} onClick={(e) => e.stopPropagation()} /></TD>
                  <TD kind="mono">{r.sku}</TD>
                  <TD>
                    {Object.entries(r.patch).map(([k, v]) => {
                      const same = show(r.current[k]) === show(v);
                      return <div key={k} className={same ? 'text-on-surface-variant' : ''}>{LABEL[k] ?? k}: {show(r.current[k])} → {same ? show(v) : <strong>{show(v)}</strong>}</div>;
                    })}
                  </TD>
                  <TD kind="time">{new Date(r.changed_at ?? r.received_at).toLocaleString('th-TH')}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : <Empty>ไม่มีข้อมูลที่รออนุมัติ</Empty>}
      </Panel>
    </Page>
  );
}
