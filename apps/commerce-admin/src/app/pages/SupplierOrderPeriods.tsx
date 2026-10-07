import { useState } from 'react';
import { Button, Chip, Empty, ErrorText, Hint, Page, PageHeader, Panel, PanelHead, SearchInput, Table, TBody, TD, TH, THead, TR } from '@cp/ui';
import { orderingApi, OrderPeriodRow, productPricesApi } from '../../lib/api';
import { useAsync } from '../hooks';

const STATUS: Record<string, string> = { O: 'เปิด', C: 'ปิด', N: 'ยังไม่เปิด' };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The ERP's supplier order rounds (pre-order SKUs: which delivery dates, ordered until when), owned by commerce
 * (stage 4f). Read-only — the ERP is the source; each push reaches josh as supplier.order_periods.snapshot.
 * "ส่งให้ josh อีกครั้ง" re-sends one supplier's rounds (repair).
 */
export function SupplierOrderPeriods() {
  const owned = useAsync(() => productPricesApi.ownership(), []);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const rows = useAsync(() => orderingApi.periods(search), [search]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwned = owned.data?.ordering === true;

  async function republish(sup: string) {
    setError(null); setMsg(null);
    try {
      const r = await orderingApi.republish(sup);
      setMsg(`ส่งรอบสั่งซื้อของ ${sup} ให้ josh แล้ว (${r.periods.length} รอบ)`);
    } catch (e) { setError(errText(e)); }
  }

  const list = rows.data ?? [];
  return (
    <Page>
      <PageHeader title="รอบสั่งซื้อ supplier (ERP)" subtitle="สินค้าสั่งล่วงหน้า: วันส่งที่รับ และปิดรับเมื่อไร · มาจาก ERP PUT /erp/order-periods · josh ใช้ตรวจตอน checkout" />
      {owned.data && !isOwned && <Hint>ยังไม่ได้สลับ — josh ยังเขียนรอบสั่งซื้อเอง (COMMERCE_OWNS_ORDERING) · ที่นี่จะว่างจนกว่าจะ import หรือสลับ</Hint>}
      <ErrorText error={error ?? rows.error ?? null} />
      {msg && <div className="px-4 py-2 text-xs text-on-surface-variant bg-surface-container-low">{msg}</div>}
      <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); }}>
        <div className="flex-1 max-w-sm"><SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="รหัส supplier" /></div>
        <Button type="submit">ค้นหา</Button>
      </form>
      <Panel>
        <PanelHead title={`รอบสั่งซื้อ (${list.length})`} />
        {list.length ? (
          <Table>
            <THead><TR><TH>supplier</TH><TH>รอบ</TH><TH>วันส่ง</TH><TH>ปิดรับ</TH><TH>สถานะ</TH><TH>ERP ส่งล่าสุด</TH><TH /></TR></THead>
            <TBody>
              {list.map((r: OrderPeriodRow, i) => (
                <TR key={`${r.sup_code}:${r.erp_order_period}`}>
                  <TD kind="mono">{r.sup_code}</TD>
                  <TD kind="mono">{r.erp_order_period}</TD>
                  <TD>{r.date_from} – {r.date_to}</TD>
                  <TD kind="time">{r.close_at ? new Date(r.close_at).toLocaleString('th-TH') : '—'}</TD>
                  <TD><Chip tone={r.status === 'O' ? 'ok' : 'muted'}>{STATUS[r.status] ?? r.status}</Chip></TD>
                  <TD kind="time">{new Date(r.synced_at).toLocaleString('th-TH')}</TD>
                  <TD>{(i === 0 || list[i - 1].sup_code !== r.sup_code) && (
                    <Button size="sm" variant="ghost" disabled={!isOwned} onClick={() => void republish(r.sup_code)}>ส่งให้ josh อีกครั้ง</Button>
                  )}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : <Empty>ไม่มีรอบสั่งซื้อ</Empty>}
      </Panel>
    </Page>
  );
}
