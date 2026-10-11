// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { useState } from 'react';
import { Alert, Button, Chip, Empty, ErrorText, Hint, Page, PageHeader, Pager, Panel, PanelHead, SearchInput, Table, TBody, TD, TH, THead, TR } from '@cp/ui';
import { orderingApi, OrderPeriodRow, productPricesApi } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const STATUS: Record<string, string> = { O: 'เปิดรับ', C: 'ปิดรับแล้ว', N: 'ยังไม่เปิด' };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The ERP's supplier order rounds (pre-order SKUs: which delivery dates, ordered until when), owned by commerce
 * (stage 4f). Read-only — the ERP is the source; each push reaches josh as supplier.order_periods.snapshot.
 * "ส่งให้ josh อีกครั้ง" re-sends one supplier's rounds (repair).
 */
export function SupplierOrderPeriods() {
  __useUiLocale();
  const owned = useAsync(() => productPricesApi.ownership(), []);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const rows = useAsync(() => orderingApi.periods(search, page, pageSize), [search, page, pageSize]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwned = owned.data?.ordering === true;

  async function republish(sup: string) {
    setError(null); setMsg(null);
    try {
      const r = await orderingApi.republish(sup);
      setMsg(__uiMessage("ส่งรอบสั่งซื้อของ {0} ให้ร้านค้าอีกครั้งแล้ว ({1} รอบ)", {"0": sup, "1": r.periods.length}));
    } catch (e) { setError(errText(e)); }
  }

  const list = rows.data?.items ?? [];
  return (
    <Page>
      <PageHeader title={__uiText("รอบสั่งซื้อจากซัพพลายเออร์")} subtitle={__uiText("รอบของสินค้าสั่งล่วงหน้า วันส่ง และวันปิดรับ ข้อมูลมาจากระบบหลัก (ERP) ร้านค้าใช้ตรวจตอนลูกค้าสั่งซื้อ")} />
      {owned.data && !isOwned && <Hint>{__uiText("ยังไม่ได้เปิดใช้หน้านี้ ร้านค้ายังบันทึกรอบสั่งซื้อเอง หน้านี้จะว่างจนกว่าจะนำข้อมูลเข้าหรือเปิดใช้")}</Hint>}
      <ErrorText error={error ?? rows.error ?? null} />
      {msg && <Alert tone="ok" onClose={() => setMsg(null)}>{(typeof msg === 'string' ? __uiText(msg) : msg)}</Alert>}
      <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); setPage(1); }}>
        <div className="flex-1 max-w-sm"><SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder={__uiText("รหัสซัพพลายเออร์")} /></div>
        <Button type="submit">{__uiText("ค้นหา")}</Button>
      </form>
      <Panel>
        <PanelHead title={__uiText("รอบสั่งซื้อ ({0})", {"0": rows.data?.total ?? 0})} />
        {list.length ? (
          <>
            <Table>
              <THead><TH>{__uiText("ซัพพลายเออร์")}</TH><TH>{__uiText("รอบ")}</TH><TH>{__uiText("วันส่ง")}</TH><TH>{__uiText("ปิดรับ")}</TH><TH>{__uiText("สถานะ")}</TH><TH>{__uiText("ระบบหลักส่งล่าสุด")}</TH><TH /></THead>
              <TBody>
                {list.map((r: OrderPeriodRow, i) => (
                  <TR key={`${r.sup_code}:${r.erp_order_period}`}>
                    <TD kind="mono">{r.sup_code}</TD>
                    <TD kind="mono">{r.erp_order_period}</TD>
                    <TD>{r.date_from} – {r.date_to}</TD>
                    <TD kind="time">{r.close_at ? new Date(r.close_at).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')) : '—'}</TD>
                    <TD><Chip tone={r.status === 'O' ? 'ok' : 'muted'} dot>{STATUS[r.status] ? __uiText(STATUS[r.status]) : r.status}</Chip></TD>
                    <TD kind="time">{new Date(r.synced_at).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'))}</TD>
                    <TD>{(i === 0 || list[i - 1].sup_code !== r.sup_code) && (
                      <Button size="sm" variant="ghost" disabled={!isOwned} onClick={() => void republish(r.sup_code)}>{__uiText("ส่งให้ร้านค้าอีกครั้ง")}</Button>
                    )}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pager page={page} pageSize={pageSize} total={rows.data?.total ?? 0} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
          </>
        ) : <Empty>{__uiText("ไม่มีรอบสั่งซื้อ ลองค้นหาด้วยรหัสซัพพลายเออร์อื่น หรือรอระบบหลักส่งข้อมูลเข้ามา")}</Empty>}
      </Panel>
    </Page>
  );
}
