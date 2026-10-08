// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { useEffect, useState } from 'react';
import { Button, Checkbox, Empty, ErrorText, Hint, Page, PageHeader, Pager, Panel, PanelHead, SearchInput, Table, TBody, TD, TH, THead, TR } from '@cp/ui';
import { MasterPending, productMastersApi, productPricesApi } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const LABEL: Record<string, string> = {
  get product_status(){return __uiText("สถานะ");}, get category_code(){return __uiText("หมวด (รหัส)");}, get brand_name(){return __uiText("แบรนด์");}, get selling_unit(){return __uiText("หน่วยขาย");}, get order_taking_unit(){return __uiText("หน่วยสั่ง");},
  get erp_ordering_units(){return __uiText("หน่วยที่สั่งได้");}, get pack_size(){return __uiText("ขนาดแพ็ก");}, get packaging_type(){return __uiText("ชนิดแพ็ก");}, get units_per_box(){return __uiText("ต่อกล่อง");}, get weight_per_unit(){return __uiText("น้ำหนักต่อหน่วย");},
  get vat_type(){return __uiText("VAT");}, get marketed_by(){return __uiText("ผู้จัดจำหน่าย");}, get product_type(){return __uiText("ประเภท");}, get order_taking_flag(){return __uiText("สั่งล่วงหน้า");}, get sup_code(){return __uiText("supplier");},
  get season_start(){return __uiText("เริ่มฤดู");}, get season_end(){return __uiText("จบฤดู");},
};
const show = (v: unknown) => (v == null || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The MER queue of ERP changes to live products' units, pack, status, category … owned by commerce (stage 4d).
 * Approve applies only the fields the ERP changed; every change reaches josh as product.master.snapshot. New SKUs
 * (drafts) are still approved on the product page (josh).
 */
export function ProductMasterQueue() {
  __useUiLocale();
  const owned = useAsync(() => productPricesApi.ownership(), []);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const pending = useAsync(() => productMastersApi.pending(search, page, pageSize), [search, page, pageSize]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const isOwned = owned.data?.productMaster === true;

  // Bulk approve / reject is page-scoped: changing page clears the selection; a page emptied by approve steps back.
  const go = (p: number, size = pageSize) => { setPicked(new Set()); setPageSize(size); setPage(p); };
  useEffect(() => {
    const d = pending.data;
    if (d && !d.items.length && d.total > 0 && d.page > 1) setPage(Math.ceil(d.total / d.limit));
  }, [pending.data]);

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
      <PageHeader title={__uiText("คิวข้อมูลสินค้าจาก ERP")} subtitle={__uiText("หน่วย แพ็ก แบรนด์ VAT สถานะ หมวด การสั่งซื้อ ของสินค้าที่ขายอยู่ · ERP เปลี่ยนแล้วรอ MER อนุมัติที่นี่ · สินค้าใหม่ (draft) อนุมัติที่หน้าสินค้า")} />
      {owned.data && !isOwned && <Hint>{__uiText("ยังไม่ได้สลับ — คิวนี้ยังอยู่ที่ josh (COMMERCE_OWNS_PRODUCT_MASTER)")}</Hint>}
      <ErrorText error={error ?? pending.error ?? null} />
      <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); go(1); }}>
        <div className="flex-1 max-w-sm"><SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder={__uiText("SKU")} /></div>
        <Button type="submit">{__uiText("ค้นหา")}</Button>
      </form>
      <Panel>
        <PanelHead title={__uiText("รออนุมัติ ({0})", {"0": pending.data?.total ?? 0})} />
        <div className="px-4 py-2 flex gap-2">
          <Button variant="primary" disabled={!isOwned || picked.size === 0} onClick={() => void act('approve')}>{__uiText("อนุมัติ ")}{picked.size || ''}</Button>
          <Button variant="danger-ghost" disabled={!isOwned || picked.size === 0} onClick={() => void act('reject')}>{__uiText("ไม่อนุมัติ")}</Button>
        </div>
        {pending.data?.items.length ? (
          <>
            <Table>
              <THead><TR><TH /><TH>{__uiText("SKU")}</TH><TH>{__uiText("ERP เปลี่ยน (ตอนนี้ → ใหม่)")}</TH><TH>{__uiText("ERP ส่งเมื่อ")}</TH></TR></THead>
              <TBody>
                {pending.data.items.map((r: MasterPending) => (
                  <TR key={r.sku} selected={picked.has(r.sku)} onClick={() => toggle(r.sku)}>
                    <TD><Checkbox checked={picked.has(r.sku)} onChange={() => toggle(r.sku)} onClick={(e) => e.stopPropagation()} /></TD>
                    <TD kind="mono">{r.sku}</TD>
                    <TD>
                      {Object.entries(r.patch).map(([k, v]) => {
                        const same = show(r.current[k]) === show(v);
                        return <div key={k} className={same ? 'text-on-surface-variant' : ''}>{LABEL[k] ?? k}: {show(r.current[k])} → {same ? show(v) : <strong>{show(v)}</strong>}</div>;
                      })}
                    </TD>
                    <TD kind="time">{new Date(r.changed_at ?? r.received_at).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'))}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pager page={page} pageSize={pageSize} total={pending.data.total} onPage={(p) => go(p)} onPageSize={(n) => go(1, n)} />
          </>
        ) : <Empty>{__uiText("ไม่มีข้อมูลที่รออนุมัติ")}</Empty>}
      </Panel>
    </Page>
  );
}
