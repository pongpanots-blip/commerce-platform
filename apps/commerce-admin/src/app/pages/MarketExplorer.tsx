import { FormEvent, useState } from 'react';
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
  const total = data?.summary.total_count ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / LIMIT));

  async function csv() {
    setCsvError(null);
    try { await marketApi.restaurantsCsv(filters); } catch (e) { setCsvError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Market Explorer</h1>
          <p>ร้านอาหารสำหรับหาลูกค้าใหม่ · rating, รีวิว, ช่วงเวลาที่คนเยอะวันนี้ และร้านที่ฝ่ายขายผูกไว้แล้ว · อ่านจาก replica ของ josh</p>
        </div>
        <div className="row">
          <button className="btn ghost" type="button" onClick={csv}>Export CSV</button>
          <button className="btn ghost" type="button" onClick={reload}>Refresh</button>
        </div>
      </div>
      {csvError && <div className="err">{csvError}</div>}

      <section className="panel">
        <form className="stack" onSubmit={submit}>
          <div className="row">
            <label className="field">ชื่อร้าน<input value={draft.search ?? ''} onChange={set('search')} /></label>
            <label className="field">เขต<input value={draft.district ?? ''} onChange={set('district')} placeholder="เช่น วัฒนา" /></label>
            <label className="field">ประเภท<input value={draft.category ?? ''} onChange={set('category')} placeholder="เช่น Japanese" /></label>
            <label className="field">rating ขั้นต่ำ<input type="number" min={0} max={5} step={0.1} value={draft.minRating ?? ''} onChange={set('minRating')} /></label>
            <label className="field">รีวิวขั้นต่ำ<input type="number" min={0} value={draft.minReviewCount ?? ''} onChange={set('minReviewCount')} /></label>
            <label className="field">คนเยอะช่วง (วันนี้)<input value={draft.busyWindow ?? ''} onChange={set('busyWindow')} placeholder="17-20" /></label>
          </div>
          <div className="row" style={{ alignItems: 'center' }}>
            {([['dineIn', 'นั่งทาน'], ['takeaway', 'ซื้อกลับ'], ['delivery', 'delivery'], ['excludeHasTmpLead', 'ยังไม่มีในรายชื่อฝ่ายขาย']] as const).map(([k, label]) => (
              <label key={k} className={`check${draft[k] ? ' on' : ''}`}><input type="checkbox" checked={!!draft[k]} onChange={set(k)} />{label}</label>
            ))}
            <button className="btn" type="submit">ค้นหา</button>
          </div>
        </form>
      </section>

      {error && <div className="err">{error}</div>}
      {data && (
        <>
          <p className="hint">
            {total.toLocaleString('th-TH')} ร้าน
            {data.summary.top_categories.length > 0 && <> · ประเภท: {data.summary.top_categories.map((c) => `${c.name} (${c.count})`).join(', ')}</>}
            {data.summary.top_districts.length > 0 && <> · เขต: {data.summary.top_districts.map((c) => `${c.name} (${c.count})`).join(', ')}</>}
          </p>
          <section className="panel">
            {data.items.length ? (
              <table>
                <thead><tr><th>ร้าน</th><th>เขต</th><th>ประเภท</th><th>rating</th><th>รีวิว</th><th>ราคา</th><th>วันนี้ 08–23</th><th>ฝ่ายขาย</th></tr></thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}{r.name_en && r.name_th && <div className="hint">{r.name_en}</div>}</td>
                      <td>{r.district ?? '—'}</td>
                      <td>{r.category ?? '—'}</td>
                      <td>{r.rating ?? '—'}</td>
                      <td>{r.review_count ?? '—'}</td>
                      <td>{r.price_range ?? '—'}</td>
                      <td><Spark curve={r.popular_times_today} /></td>
                      <td>{r.winback_customer_code ? <span className="badge ok">{r.winback_customer_code}</span> : <span className="badge muted">ยังไม่มี</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty">ไม่พบร้านตามเงื่อนไข</div>}
          </section>
          <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
            <button className="btn ghost sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>
            <span className="hint">หน้า {page} / {maxPage}</span>
            <button className="btn ghost sm" disabled={page >= maxPage || loading} onClick={() => setPage(page + 1)}>ถัดไป</button>
          </div>
        </>
      )}
      {loading && !data && <div className="empty">Loading…</div>}
    </div>
  );
}

/** Today's 08:00–23:00 busyness as tiny bars; blank when the place isn't enriched yet. */
function Spark({ curve }: { curve: number[] | null }) {
  if (!curve) return <span className="hint">—</span>;
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
    <div>
      <div className="page-head">
        <div>
          <h1>Order target group</h1>
          <p>ลูกค้าแต่ละรายสั่ง SKU แบบ order-taking กี่ตัว และส่งของได้กี่วันต่อสัปดาห์ · อ่านจาก replica ของ josh</p>
        </div>
        <button className="btn ghost" type="button" onClick={reload}>Refresh</button>
      </div>
      <section className="panel">
        <form className="stack" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(custCode.trim()); }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field">รหัสลูกค้า<input value={custCode} onChange={(e) => setCustCode(e.target.value)} /></label>
            <label className="field">ส่งได้อย่างน้อย (วัน/สัปดาห์)
              <select value={minShipments} onChange={(e) => { setPage(1); setMinShipments(Number(e.target.value)); }}>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n === 0 ? 'ทั้งหมด' : `≥ ${n}`}</option>)}
              </select>
            </label>
            <button className="btn" type="submit">ค้นหา</button>
          </div>
        </form>
      </section>
      {error && <div className="err">{error}</div>}
      {loading && !data && <div className="empty">Loading…</div>}
      {data && (
        <>
          <p className="hint">{data.total.toLocaleString('th-TH')} ราย</p>
          <section className="panel">
            {data.items.length ? (
              <table>
                <thead><tr><th>ลูกค้า</th><th>SKU ที่สั่ง</th><th>SKU order-taking</th><th>มีรอบส่งเปิด</th><th>ส่งได้/สัปดาห์</th><th>วันส่ง</th></tr></thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.cust_code}>
                      <td className="mono">{r.cust_code}</td><td>{r.total_skus_ordered}</td><td>{r.ot_skus_ordered}</td>
                      <td>{r.ot_skus_with_active_period}</td><td>{r.max_shipments_per_week}</td>
                      <td>{r.delivery_weekdays?.map((d) => WEEKDAYS[d] ?? d).join(' ') ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty">ไม่พบข้อมูล</div>}
          </section>
          <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
            <button className="btn ghost sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>
            <span className="hint">หน้า {page} / {maxPage}</span>
            <button className="btn ghost sm" disabled={page >= maxPage || loading} onClick={() => setPage(page + 1)}>ถัดไป</button>
          </div>
        </>
      )}
    </div>
  );
}
