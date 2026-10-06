import { FormEvent, useState } from 'react';
import { Button, Checkbox, Empty, ErrorText, Field, Input, Loading, Page, PageHeader, Panel, PanelHead, Pager, SearchInput, Stack2, Table, TBody, TD, TH, THead, TR, fmt, Icon } from '@cp/ui';
import { marketApi } from '../../lib/api';
import { useAsync } from '../hooks';

type Filters = {
  search?: string; district?: string; category?: string; minRating?: string; minReviewCount?: string;
  priceRange?: string; busyWindow?: string; dineIn?: boolean; takeaway?: boolean; delivery?: boolean; excludeHasTmpLead?: boolean;
};
const LIMIT = 20;
const WEEKDAYS = ['', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];

/** Market Explorer (moved from josh restaurant-place): restaurants for prospecting, read from josh's replica. */
export function MarketExplorer() {
  const [draft, setDraft] = useState<Filters>({});
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [csvError, setCsvError] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync(() => marketApi.restaurants({ ...filters, page, limit: LIMIT }), [filters, page]);

  function submit(e: FormEvent) { e.preventDefault(); setPage(1); setFilters(draft); }
  const set = (k: keyof Filters) => (e: { target: HTMLInputElement }) =>
    setDraft({ ...draft, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const total = data?.summary.totalCount ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / LIMIT));

  async function csv() {
    setCsvError(null);
    try { await marketApi.restaurantsCsv(filters); } catch (e) { setCsvError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <Page>
      <PageHeader
        title="Market Explorer"
        subtitle="ร้านอาหารสำหรับหาลูกค้าใหม่ · rating, รีวิว, ช่วงเวลาที่คนเยอะวันนี้ และร้านที่ฝ่ายขายผูกไว้แล้ว · อ่านจาก replica ของ josh"
        actions={
          <>
            <Button variant="ghost" onClick={csv}>Export CSV</Button>
            <Button variant="ghost" onClick={reload}>Refresh</Button>
          </>
        }
      />

      <ErrorText error={csvError} />

      <Panel as="form" onSubmit={submit}>
        <PanelHead title="ค้นหา" />
        <div className="px-4 py-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <SearchInput placeholder="ชื่อร้าน" value={draft.search ?? ''} onChange={set('search')} />
            <Input placeholder="เขต เช่น วัฒนา" value={draft.district ?? ''} onChange={set('district')} />
            <Input placeholder="ประเภท เช่น Japanese" value={draft.category ?? ''} onChange={set('category')} />
            <Input type="number" min={0} max={5} step={0.1} placeholder="rating ขั้นต่ำ" value={draft.minRating ?? ''} onChange={set('minRating')} />
            <Input type="number" min={0} placeholder="รีวิวขั้นต่ำ" value={draft.minReviewCount ?? ''} onChange={set('minReviewCount')} />
            <Input placeholder="คนเยอะช่วง (วันนี้) เช่น 17-20" value={draft.busyWindow ?? ''} onChange={set('busyWindow')} />
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            {([['dineIn', 'นั่งทาน'], ['takeaway', 'ซื้อกลับ'], ['delivery', 'delivery'], ['excludeHasTmpLead', 'ยังไม่มีในรายชื่อฝ่ายขาย']] as const).map(([k, label]) => (
              <Checkbox key={k} label={label} checked={!!draft[k]} onChange={set(k)} />
            ))}
          </div>
          <Button type="submit">ค้นหา</Button>
        </div>
      </Panel>

      <ErrorText error={error} />

      {data && (
        <>
          <div className="text-xs text-on-surface-variant space-y-1">
            <div>
              {fmt.num(total)} ร้าน
              {data.summary.topCategories.length > 0 && <> · ประเภท: {data.summary.topCategories.map((c) => `${c.name} (${c.count})`).join(', ')}</>}
            </div>
            {data.summary.topDistricts.length > 0 && <div>เขต: {data.summary.topDistricts.map((c) => `${c.name} (${c.count})`).join(', ')}</div>}
          </div>

          <Panel className="overflow-hidden">
            <Table>
              <THead>
                <TH>ร้าน</TH>
                <TH>เขต</TH>
                <TH>ประเภท</TH>
                <TH right>rating</TH>
                <TH right>รีวิว</TH>
                <TH right>โต๊ะ (ประมาณ)</TH>
                <TH>ราคา</TH>
                <TH>วันนี้ 08–23</TH>
                <TH>ฝ่ายขาย</TH>
              </THead>
              <TBody>
                {data.items.length ? (
                  data.items.map((r) => (
                    <TR key={r.id}>
                      <TD><Stack2 top={r.name} bottom={r.nameEn && r.nameTh ? r.nameEn : undefined} /></TD>
                      <TD kind="muted">{r.district ?? '—'}</TD>
                      <TD kind="muted">{r.category ?? '—'}</TD>
                      <TD kind="num">{r.rating ?? '—'}</TD>
                      <TD kind="num">{r.reviewCount ?? '—'}</TD>
                      <TD kind="num">{r.estimatedTables ?? '—'}</TD>
                      <TD kind="muted">{r.priceRange ?? '—'}</TD>
                      <TD><Spark curve={r.popularTimesToday} /></TD>
                      <TD>{r.winbackCustomerCode ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#e7f5ec] text-[#157347]">{r.winbackCustomerCode}</span> : <span className="text-on-surface-variant text-[11px]">ยังไม่มี</span>}</TD>
                    </TR>
                  ))
                ) : (
                  <TR><TD colSpan={9}><Empty icon="storefront">ไม่พบร้านตามเงื่อนไข</Empty></TD></TR>
                )}
              </TBody>
            </Table>
          </Panel>

          {data.items.length > 0 && (
            <Panel className="overflow-hidden">
              <Pager page={page} pageSize={LIMIT} total={total} onPage={setPage} />
            </Panel>
          )}
        </>
      )}

      {loading && !data && <Loading />}
    </Page>
  );
}

/** Today's 08:00–23:00 busyness as tiny bars; blank when the place isn't enriched yet. */
function Spark({ curve }: { curve: number[] | null }) {
  if (!curve) return <span className="text-on-surface-variant">—</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 1, height: 18 }} title={curve.map((v, i) => `${i + 8}:00 ${v}%`).join('\n')}>
      {curve.map((v, i) => <span key={i} style={{ width: 3, height: `${Math.max(1, v) * 0.18}px`, background: v > 60 ? 'var(--warn)' : 'var(--accent)', opacity: 0.8 }} />)}
    </span>
  );
}

/** Order target group (moved from josh order-targetgroup): customers by order-taking SKUs and delivery frequency. */
export function OrderTargetgroup() {
  const [minShipments, setMinShipments] = useState(0);
  const [custCode, setCustCode] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 50;
  const { data, loading, error, reload } = useAsync(
    () => marketApi.targetgroup({ minShipmentsPerWeek: minShipments || undefined, custCode: search || undefined, limit, offset: (page - 1) * limit }),
    [minShipments, search, page],
  );
  const maxPage = Math.max(1, Math.ceil((data?.total ?? 0) / limit));

  return (
    <Page>
      <PageHeader
        title="Order target group"
        subtitle="ลูกค้าแต่ละรายสั่ง SKU แบบ order-taking กี่ตัว และส่งของได้กี่วันต่อสัปดาห์ · อ่านจาก replica ของ josh"
        actions={<Button variant="ghost" onClick={reload}>Refresh</Button>}
      />

      <Panel as="form" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(custCode.trim()); }}>
        <PanelHead title="ค้นหา" />
        <div className="px-4 py-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="รหัสลูกค้า">
              <Input value={custCode} onChange={(e) => setCustCode(e.target.value)} />
            </Field>
            <Field label="ส่งได้อย่างน้อย (วัน/สัปดาห์)">
              <select value={minShipments} onChange={(e) => { setPage(1); setMinShipments(Number(e.target.value)); }} className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n === 0 ? 'ทั้งหมด' : `≥ ${n}`}</option>)}
              </select>
            </Field>
          </div>
          <Button type="submit">ค้นหา</Button>
        </div>
      </Panel>

      <ErrorText error={error} />

      {data && (
        <>
          <div className="text-xs text-on-surface-variant">{fmt.num(data.total)} ราย</div>

          <Panel className="overflow-hidden">
            <Table>
              <THead>
                <TH>ลูกค้า</TH>
                <TH right>SKU ที่สั่ง</TH>
                <TH right>SKU order-taking</TH>
                <TH right>มีรอบส่งเปิด</TH>
                <TH right>ส่งได้/สัปดาห์</TH>
                <TH>วันส่ง</TH>
              </THead>
              <TBody>
                {data.items.length ? (
                  data.items.map((r) => (
                    <TR key={r.cust_code}>
                      <TD kind="mono">{r.cust_code}</TD>
                      <TD kind="num">{r.total_skus_ordered}</TD>
                      <TD kind="num">{r.ot_skus_ordered}</TD>
                      <TD kind="num">{r.ot_skus_with_active_period}</TD>
                      <TD kind="num">{r.max_shipments_per_week}</TD>
                      <TD kind="muted">{r.delivery_weekdays?.map((d) => WEEKDAYS[d] ?? d).join(' ') ?? '—'}</TD>
                    </TR>
                  ))
                ) : (
                  <TR><TD colSpan={6}><Empty icon="inbox">ไม่พบข้อมูล</Empty></TD></TR>
                )}
              </TBody>
            </Table>
          </Panel>

          {data.items.length > 0 && (
            <Panel className="overflow-hidden">
              <Pager page={page} pageSize={limit} total={data.total} onPage={setPage} />
            </Panel>
          )}
        </>
      )}

      {loading && !data && <Loading />}
    </Page>
  );
}
