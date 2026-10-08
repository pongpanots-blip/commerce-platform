// ui-metadata-migration: static labels and UI notices only
import { FormEvent, useState } from 'react';
import { Button, Empty, ErrorText, Hint, Loading, Page, PageHeader, Panel, PanelHead, SearchInput, Select, StatGrid, StatTile, Table, TBody, TD, TH, THead, TR, fmt } from '@cp/ui';
import { inventoryOverviewApi } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const OWNER = { erp: 'ERP', commerce: 'commerce (คลังเรา)' } as const;

/** Stock by SKU and warehouse code, who owns each warehouse's stock, and the last ledger movement. */
export function InventoryPerWarehouse() {
  __useUiLocale();
  const [warehouse, setWarehouse] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const data = useAsync(() => inventoryOverviewApi.get(warehouse, search, page), [warehouse, search, page]);
  const maxPage = data.data ? Math.max(1, Math.ceil(data.data.total / data.data.pageSize)) : 1;
  const pick = (code: string) => { setWarehouse(code); setPage(1); };

  function submit(e: FormEvent) { e.preventDefault(); setPage(1); setSearch(query.trim()); }

  return (
    <Page>
      <PageHeader
        title={__uiText("Inventory per warehouse")}
        subtitle={__uiText("สต็อกตาม SKU และคลัง · ERP = ยอดมาจาก ERP (ปรับใน ERP) · commerce = คลังของเรา (ปรับได้ใน commerce)")}
        actions={<Button icon="refresh" onClick={data.reload}>{__uiText("Refresh")}</Button>}
      />

      <ErrorText error={data.error} />

      {data.data?.warehouses && (
        <StatGrid cols={Math.min(6, data.data.warehouses.length)}>
          {data.data.warehouses.map((w) => (
            <StatTile
              key={w.code}
              label={`${w.code} · ${OWNER[w.stockSource] ?? w.stockSource}`}
              value={fmt.num(w.onHand)}
              foot={__uiText("{0} · {1} SKU · จอง {2}",{'0':w.name,'1':fmt.num(w.skus),'2':fmt.num(w.reserved)})}
              onClick={() => pick(warehouse === w.code ? '' : w.code)}
              selected={warehouse === w.code}
            />
          ))}
        </StatGrid>
      )}

      <Panel>
        <PanelHead title={__uiText("รายละเอียด")} />
        <form className="px-4 py-3 border-b border-secondary-container flex flex-wrap items-end gap-3" onSubmit={submit}>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">{__uiText("คลัง")}</label>
            <Select value={warehouse} onChange={(e) => pick(e.target.value)}>
              <option value="">{__uiText("ทุกคลัง")}</option>
              {(data.data?.warehouses ?? []).map((w) => (
                <option key={w.code} value={w.code}>{w.code} — {w.name}</option>
              ))}
            </Select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">{__uiText("ค้นหา SKU หรือชื่อสินค้า")}</label>
            <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Button type="submit">{__uiText("ค้นหา")}</Button>
        </form>

        {data.loading && !data.data?.items.length ? (
          <Loading />
        ) : !data.data?.items.length ? (
          <Empty>{__uiText("ไม่พบสต็อก")}</Empty>
        ) : (
          <>
            <Table>
              <THead>
                <TH>{__uiText("SKU")}</TH>
                <TH>{__uiText("สินค้า")}</TH>
                <TH>{__uiText("คลัง")}</TH>
                <TH right>{__uiText("คงเหลือ")}</TH>
                <TH right>{__uiText("จอง")}</TH>
                <TH right>{__uiText("พร้อมขาย")}</TH>
                <TH>{__uiText("เปลี่ยนล่าสุด")}</TH>
              </THead>
              <TBody>
                {data.data.items.map((r) => (
                  <TR key={r.id} muted={r.available <= 0}>
                    <TD kind="mono">{r.sku}</TD>
                    <TD>{r.name}</TD>
                    <TD>
                      <span className="font-mono">{r.warehouseCode}</span>
                      <div className="text-[10px] font-medium mt-0.5">
                        {r.stockSource === 'commerce' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{__uiText("✓ commerce")}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant">{__uiText("ERP")}</span>
                        )}
                      </div>
                    </TD>
                    <TD kind="num">{fmt.num(r.quantity)}</TD>
                    <TD kind="num">{fmt.num(r.reserved)}</TD>
                    <TD kind="num" className={r.available <= 0 ? 'text-danger' : ''}>
                      {fmt.num(r.available)}
                    </TD>
                    <TD className="text-[11px]">
                      {r.lastChangedAt ? (
                        <>
                          <div className="font-mono">{fmt.when(r.lastChangedAt)}</div>
                          <div className="text-on-surface-variant">
                            {r.lastSource}
                            {r.lastReason && ` · ${r.lastReason}`}
                            {r.lastStatus && r.lastStatus !== 'applied' && ` · ${r.lastStatus}`}
                          </div>
                        </>
                      ) : (
                        fmt.when(r.updatedAt)
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            {maxPage > 1 && (
              <div className="flex items-center justify-center gap-3 py-3 border-t border-secondary-container">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{__uiText("ก่อนหน้า")}</Button>
                <Hint>{__uiText("หน้า ")}{page} / {maxPage} ({fmt.num(data.data?.total ?? 0)} {__uiText(" รายการ)")}</Hint>
                <Button size="sm" variant="secondary" disabled={page >= maxPage} onClick={() => setPage(page + 1)}>{__uiText("ถัดไป")}</Button>
              </div>
            )}
          </>
        )}
      </Panel>
    </Page>
  );
}
