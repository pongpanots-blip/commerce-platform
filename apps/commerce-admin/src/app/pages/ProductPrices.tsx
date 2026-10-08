// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
import { FormEvent, useState } from 'react';
import { Button, Checkbox, Empty, ErrorText, Hint, Input, Page, PageHeader, Panel, PanelHead, SearchInput, Table, TBody, TD, TH, THead, TR, fmt } from '@cp/ui';
import { productPricesApi, PricePending, PriceRow } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const money = (v: string | number | null) => (v == null ? '—' : fmt.num(Number(v)));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Product prices owned by commerce (stage 4a): the MER queue of ERP price / MOQ changes (approve / reject) and the live
 * base price, ERP box price and MOQ per SKU. Every change reaches josh as product.price.snapshot.
 */
export function ProductPrices() {
  __useUiLocale();
  const owned = useAsync(() => productPricesApi.ownership(), []);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const pending = useAsync(() => productPricesApi.pending(search), [search]);
  const prices = useAsync(() => productPricesApi.list(search), [search]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ sku: string; sellingUnitPrice: string; orderingPrice: string; moq: string } | null>(null);
  const isOwned = owned.data?.prices === true;

  const toggle = (sku: string) => setPicked((s) => { const n = new Set(s); n.has(sku) ? n.delete(sku) : n.add(sku); return n; });
  async function act(kind: 'approve' | 'reject') {
    setError(null);
    try {
      await (kind === 'approve' ? productPricesApi.approve([...picked]) : productPricesApi.reject([...picked]));
      setPicked(new Set());
      pending.reload(); prices.reload();
    } catch (e) { setError(errText(e)); }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setError(null);
    const n = (v: string) => (v.trim() === '' ? undefined : Number(v));
    try {
      await productPricesApi.edit(edit.sku, { sellingUnitPrice: n(edit.sellingUnitPrice), orderingPrice: n(edit.orderingPrice), moq: n(edit.moq) });
      setEdit(null);
      prices.reload();
    } catch (err) { setError(errText(err)); }
  }

  return (
    <Page>
      <PageHeader title={__uiText("ราคาสินค้า")} subtitle={__uiText("ราคาขาย (ต่อหน่วยขาย) ราคาสั่ง (ต่อหน่วยสั่ง) และ MOQ · ERP เปลี่ยนแล้วรอ MER อนุมัติที่นี่ · ทุกการเปลี่ยนส่งให้ร้าน (josh)")} />
      {owned.data && !isOwned && <Hint>{__uiText("ยังไม่ได้สลับ — ราคายังแก้และอนุมัติที่ josh (COMMERCE_OWNS_PRICES)")}</Hint>}
      <ErrorText error={error ?? pending.error ?? prices.error ?? null} />
      <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); }}>
        <div className="flex-1 max-w-sm"><SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder={__uiText("SKU")} /></div>
        <Button type="submit">{__uiText("ค้นหา")}</Button>
      </form>

      <Panel>
        <PanelHead title={__uiText("รออนุมัติ ({0})", {"0": pending.data?.length ?? 0})} />
        <div className="px-4 py-2 flex gap-2">
          <Button variant="primary" disabled={!isOwned || picked.size === 0} onClick={() => void act('approve')}>{__uiText("อนุมัติ ")}{picked.size || ''}</Button>
          <Button variant="danger-ghost" disabled={!isOwned || picked.size === 0} onClick={() => void act('reject')}>{__uiText("ไม่อนุมัติ")}</Button>
        </div>
        {pending.data?.length ? (
          <Table>
            <THead><TR><TH /><TH>{__uiText("SKU")}</TH><TH kind="money">{__uiText("ราคาขาย")}</TH><TH kind="money">{__uiText("ราคาสั่ง")}</TH><TH kind="num">{__uiText("MOQ")}</TH><TH>{__uiText("ERP เปลี่ยนเมื่อ")}</TH></TR></THead>
            <TBody>
              {pending.data.map((r: PricePending) => (
                <TR key={r.sku} selected={picked.has(r.sku)} onClick={() => toggle(r.sku)}>
                  <TD><Checkbox checked={picked.has(r.sku)} onChange={() => toggle(r.sku)} onClick={(e) => e.stopPropagation()} /></TD>
                  <TD kind="mono">{r.sku}</TD>
                  <TD kind="money">{r.selling_unit_price == null ? '—' : `${money(r.current_selling_unit_price)} → ${money(r.selling_unit_price)}`}</TD>
                  <TD kind="money">{r.ordering_price == null ? '—' : `${money(r.current_ordering_price)} → ${money(r.ordering_price)}`}</TD>
                  <TD kind="num">{r.moq == null ? '—' : `${r.current_moq ?? '—'} → ${r.moq}`}</TD>
                  <TD kind="time">{r.changed_at ? new Date(r.changed_at).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')) : '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : <Empty>{__uiText("ไม่มีราคาที่รออนุมัติ")}</Empty>}
      </Panel>

      <Panel>
        <PanelHead title={__uiText("ราคาปัจจุบัน")} />
        {edit && (
          <form className="px-4 py-3 flex flex-wrap items-end gap-3 border-b border-secondary-container" onSubmit={save}>
            <div className="text-xs font-mono">{edit.sku}</div>
            {(['sellingUnitPrice', 'orderingPrice', 'moq'] as const).map((k) => (
              <div key={k} className="w-36">
                <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">{k === 'sellingUnitPrice' ? __uiText("ราคาขาย") : k === 'orderingPrice' ? __uiText("ราคาสั่ง") : __uiText("MOQ")}</label>
                <Input type="number" step={k === 'moq' ? 1 : 0.01} min={0} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
              </div>
            ))}
            <Button type="submit" variant="primary">{__uiText("บันทึก")}</Button>
            <Button onClick={() => setEdit(null)}>{__uiText("ยกเลิก")}</Button>
          </form>
        )}
        {prices.data?.length ? (
          <Table>
            <THead><TR><TH>{__uiText("SKU")}</TH><TH kind="money">{__uiText("ราคาขาย")}</TH><TH kind="money">{__uiText("ราคาสั่ง")}</TH><TH kind="num">{__uiText("MOQ")}</TH><TH>{__uiText("ที่มา")}</TH><TH>{__uiText("แก้ล่าสุด")}</TH><TH kind="actions" /></TR></THead>
            <TBody>
              {prices.data.map((r: PriceRow) => (
                <TR key={r.sku}>
                  <TD kind="mono">{r.sku}</TD>
                  <TD kind="money">{money(r.selling_unit_price)}</TD>
                  <TD kind="money">{money(r.ordering_price)}</TD>
                  <TD kind="num">{r.moq ?? '—'}</TD>
                  <TD kind="muted">{r.source}</TD>
                  <TD kind="time">{new Date(r.updated_at).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'))}</TD>
                  <TD kind="actions">
                    <Button size="sm" disabled={!isOwned} onClick={() => setEdit({ sku: r.sku, sellingUnitPrice: r.selling_unit_price ?? '', orderingPrice: r.ordering_price ?? '', moq: r.moq == null ? '' : String(r.moq) })}>{__uiText("แก้")}</Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : <Empty>{search ? __uiText("ไม่พบ SKU") : __uiText("ยังไม่มีราคา — import จาก josh ก่อนสลับ")}</Empty>}
      </Panel>
    </Page>
  );
}
