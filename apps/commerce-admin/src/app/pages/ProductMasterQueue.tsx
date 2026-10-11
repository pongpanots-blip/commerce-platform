// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Empty, ErrorText, Hint, Loading, Page, PageHeader, Pager, Panel, PanelHead, SearchInput, Table, TBody, TD, TH, THead, TR, useUnsavedChanges } from '@cp/ui';
import { MasterPending, productMastersApi, productPricesApi } from '../../lib/api';
import { useAsync, useMutation } from '../hooks';
import { InterruptedAction, requireSaved, useActionDraft } from '../task-forms';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const LABEL: Record<string, string> = {
  get product_status(){return __uiText("สถานะ");}, get category_code(){return __uiText("หมวด (รหัส)");}, get brand_name(){return __uiText("แบรนด์");}, get selling_unit(){return __uiText("หน่วยขาย");}, get order_taking_unit(){return __uiText("หน่วยสั่ง");},
  get erp_ordering_units(){return __uiText("หน่วยที่สั่งได้");}, get pack_size(){return __uiText("ขนาดแพ็ก");}, get packaging_type(){return __uiText("ชนิดแพ็ก");}, get units_per_box(){return __uiText("ต่อกล่อง");}, get weight_per_unit(){return __uiText("น้ำหนักต่อหน่วย");},
  get vat_type(){return __uiText("VAT");}, get marketed_by(){return __uiText("ผู้จัดจำหน่าย");}, get product_type(){return __uiText("ประเภท");}, get order_taking_flag(){return __uiText("สั่งล่วงหน้า");}, get sup_code(){return __uiText("ซัพพลายเออร์");},
  get season_start(){return __uiText("เริ่มฤดู");}, get season_end(){return __uiText("จบฤดู");},
};
const show = (v: unknown) => (v == null || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v));

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
  const draft = useActionDraft('product-master:review', { skus: '' });
  const [picked, setPicked] = useState<Set<string>>(() => new Set(draft.values.skus.split('\n').filter(Boolean)));
  useEffect(() => { draft.set({ skus: [...picked].join('\n') }); }, [picked]);
  const mutation = useMutation();
  const [result, setResult] = useState<{ kind: 'approve' | 'reject'; count: number } | null>(null);
  useUnsavedChanges(mutation.busy || draft.outstanding);
  const isOwned = owned.data?.productMaster === true;

  // Bulk approve / reject is page-scoped: changing page clears the selection; a page emptied by approve steps back.
  const go = (p: number, size = pageSize) => { setPicked(new Set()); setPageSize(size); setPage(p); };
  useEffect(() => {
    const d = pending.data;
    if (d && !d.items.length && d.total > 0 && d.page > 1) { setPicked(new Set()); setPage(Math.ceil(d.total / d.limit)); }
  }, [pending.data]);

  const toggle = (sku: string) => { if (draft.interrupted || draft.outstanding || mutation.busy || pending.loading || pending.error) return; setPicked((s) => { const n = new Set(s); n.has(sku) ? n.delete(sku) : n.add(sku); return n; }); };
  async function act(kind: 'approve' | 'reject') {
    if (draft.interrupted || draft.outstanding || !isOwned || owned.loading || owned.error || pending.loading || pending.error || !picked.size || mutation.busy) return;
    const skus = [...picked].filter(sku => pending.data?.items.some(item => item.sku === sku));
    if (!skus.length) return;
    if (kind === 'reject' && !window.confirm(__uiText("ไม่อนุมัติข้อมูลที่เปลี่ยนของสินค้า {0} รายการ?\n\n{1}", {"0": skus.length, "1": __uiText('ไม่ใช้ค่าที่ระบบขายส่งมา สินค้าคงค่าเดิม')}))) return;
    setResult(null);
    if (!draft.begin()) return;
    const answer = await mutation.run<{ approved: number } | { rejected: number }>(async () => {
      try {
        const value = await (kind === 'approve' ? productMastersApi.approve(skus) : productMastersApi.reject(skus));
        return requireSaved(value, receipt => {
          const record = receipt as unknown as Record<string, unknown>;
          const count = record?.[kind === 'approve' ? 'approved' : 'rejected'];
          return record?.status !== false && record?.success !== false && typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= skus.length;
        });
      } catch (error) { draft.fail(error); throw error; }
      finally { draft.settle(); }
    });
    if (!answer.ok) return;
    draft.clear();
    setResult({ kind, count: kind === 'approve' ? (answer.value as { approved: number }).approved : (answer.value as { rejected: number }).rejected });
    setPicked(new Set());
    pending.reload();
  }

  return (
    <Page>
      <PageHeader title={__uiText("อนุมัติข้อมูลสินค้าที่เปลี่ยน")} subtitle={__uiText("ระบบหลัก (ERP) เปลี่ยนหน่วย แพ็ก แบรนด์ VAT สถานะ หรือหมวดของสินค้าที่ขายอยู่ ตรวจแล้วอนุมัติที่นี่ ส่วนสินค้าใหม่อนุมัติที่หน้าสินค้า")} />
      {owned.data && !isOwned && <Hint>{__uiText("ยังไม่ได้เปิดใช้หน้านี้ ตอนนี้ยังอนุมัติข้อมูลสินค้าในระบบร้านค้าเดิม")}</Hint>}
      {result && <Alert tone={result.count > 0 ? 'ok' : 'info'} onClose={() => setResult(null)}>{__uiText(result.kind === 'approve' ? 'อนุมัติแล้ว {0} รายการ' : 'ไม่อนุมัติแล้ว {0} รายการ', { 0: result.count })}</Alert>}
      <ErrorText error={mutation.error} />
      {draft.interrupted && <InterruptedAction outstanding={draft.outstanding} onContinue={draft.acknowledge} onCheck={async () => {
        const fresh = await productMastersApi.pending(search, page, pageSize);
        requireSaved(fresh, data => Array.isArray(data.items) && Number.isInteger(data.total));
        setPicked(new Set()); pending.reload(); return __uiText('รออนุมัติ ({0})', { 0: fresh.total });
      }} />}
      <ErrorText error={owned.error} onRetry={owned.reload} />
      <ErrorText error={pending.error} onRetry={pending.reload} />
      <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); go(1); }}>
        <div className="min-w-0 flex-1 max-w-sm"><SearchInput aria-label={__uiText('ค้นหาสินค้า')} disabled={mutation.busy} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={__uiText("รหัสสินค้า")} /></div>
        <Button disabled={mutation.busy} type="submit">{__uiText("ค้นหา")}</Button>
      </form>
      <Panel>
        <PanelHead title={pending.loading || pending.error || !pending.data ? __uiText('รออนุมัติ') : __uiText("รออนุมัติ ({0})", {"0": pending.data.total})} />
        <div className="px-4 py-2 flex gap-2">
          <Button variant="primary" disabled={draft.interrupted || draft.outstanding || !isOwned || owned.loading || !!owned.error || pending.loading || !!pending.error || mutation.busy || picked.size === 0} onClick={() => void act('approve')}>{__uiText("อนุมัติ ")}{picked.size || ''}</Button>
          <Button variant="danger-ghost" disabled={draft.interrupted || draft.outstanding || !isOwned || owned.loading || !!owned.error || pending.loading || !!pending.error || mutation.busy || picked.size === 0} onClick={() => void act('reject')}>{__uiText("ไม่อนุมัติ")}</Button>
        </div>
        {pending.loading ? <Loading variant="table" /> : pending.error ? null : pending.data?.items.length ? (
          <>
            <Table scrollLabel={__uiText("รายการทั้งหมด")}>
              <THead><TH /><TH>{__uiText("รหัสสินค้า")}</TH><TH>{__uiText("ข้อมูลที่เปลี่ยน (ตอนนี้ → ใหม่)")}</TH><TH>{__uiText("ระบบหลักส่งมาเมื่อ")}</TH></THead>
              <TBody>
                {pending.data.items.map((r: MasterPending) => (
                  <TR key={r.sku} selected={picked.has(r.sku)} onClick={() => toggle(r.sku)}>
                    <TD><Checkbox aria-label={__uiText('เลือก {0}', { 0: r.sku })} disabled={mutation.busy} checked={picked.has(r.sku)} onChange={() => toggle(r.sku)} onClick={(e) => e.stopPropagation()} /></TD>
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
            {!mutation.busy && <Pager page={page} pageSize={pageSize} total={pending.data.total} onPage={(p) => go(p)} onPageSize={(n) => go(1, n)} />}
          </>
        ) : pending.data ? <Empty>{__uiText("ไม่มีข้อมูลที่รออนุมัติ")}</Empty> : null}
      </Panel>
    </Page>
  );
}
