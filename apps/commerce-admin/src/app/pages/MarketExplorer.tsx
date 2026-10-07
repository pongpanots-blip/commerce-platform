import { FormEvent, useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Empty, ErrorText, Field, Input, Loading, Page, PageHeader, Panel, PanelHead, Pager, SearchInput, Stack2, Table, TBody, TD, TH, THead, TR, fmt, Icon } from '@cp/ui';
import { marketApi, RestaurantRow } from '../../lib/api';
import { useAsync } from '../hooks';
import { hasRestaurantCoordinates, RestaurantMap } from './RestaurantMap';
import './MarketExplorer.css';

type Filters = {
  search?: string; district?: string; category?: string; minRating?: string; minReviewCount?: string;
  priceRange?: string; busyWindow?: string; dineIn?: boolean; takeaway?: boolean; delivery?: boolean; excludeHasTmpLead?: boolean;
};
const LIMIT = 20;
const WEEKDAYS = ['', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];

/** Market Explorer (moved from josh restaurant-place): restaurants for prospecting, read from josh's replica or commerce's copy (backend RESTAURANTS_SOURCE). */
export function MarketExplorer() {
  const [draft, setDraft] = useState<Filters>({});
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<RestaurantRow | null>(null);
  const { data, loading, error, reload } = useAsync(() => marketApi.restaurants({ ...filters, page, limit: LIMIT }), [filters, page]);

  function apply(next: Filters) { setPage(1); setDraft(next); setFilters(next); }
  function submit(e: FormEvent) { e.preventDefault(); if (!loading) apply(draft); }
  const set = (k: keyof Filters) => (e: { target: HTMLInputElement }) =>
    setDraft({ ...draft, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const total = data?.summary.totalCount ?? 0;
  const active = Object.entries(filters).filter(([, value]) => value !== '' && value !== false && value !== undefined);

  async function csv() {
    if (exporting) return;
    setExporting(true);
    setCsvError(null);
    try { await marketApi.restaurantsCsv(filters); } catch (e) { setCsvError(e instanceof Error ? e.message : String(e)); }
    finally { setExporting(false); }
  }

  return (
    <Page>
      <div className="market-explorer">
        <header className="market-heading">
          <div><div className="market-eyebrow"><Icon name="travel_explore" size={18} /> MARKET EXPLORER</div>
            <h1>สำรวจร้านอาหาร<span>ค้นหาโอกาสให้ทีมขาย</span></h1>
            <p>เลือกพื้นที่และประเภทร้าน ดูข้อมูลประกอบ แล้วส่งต่อรายชื่อให้ทีม</p>
          </div>
          <div className="market-actions">
            <Button onClick={reload} icon="refresh" disabled={loading}>รีเฟรช</Button>
            <Button variant="primary" onClick={csv} icon="download" disabled={loading || exporting || !data || !!error || total === 0}>{exporting ? 'กำลังส่งออก…' : 'ส่งออกรายชื่อ CSV'}</Button>
          </div>
        </header>
        <ErrorText error={csvError} />

        <section className="market-overview" aria-label="ภาพรวมร้านตามเงื่อนไข" aria-busy={loading}>
          <div className="market-total">
            <span>{active.length ? 'ร้านที่ตรงเงื่อนไข' : 'ร้านในฐานข้อมูล'}</span>
            <strong>{loading ? '…' : error ? '—' : data ? fmt.num(total) : '—'}<small>ร้าน</small></strong>
            <span><Icon name="database" size={15} /> ข้อมูลจาก JOSH · อ่านอย่างเดียว</span>
          </div>
          <div className="market-distribution">
            <div className="market-section-label">เริ่มจากพื้นที่ไหน <span>เขตที่พบมากตามเงื่อนไข</span></div>
            <div className="market-districts">
              {!error && data?.summary.topDistricts.map((district) => <button key={district.name} disabled={loading} type="button" onClick={() => apply({ ...filters, district: district.name })} aria-label={`เลือกเขต ${district.name}`}>
                <span>{district.name}</span><strong>{fmt.num(district.count)}</strong>
                <i style={{ width: `${district.count / Math.max(1, data.summary.topDistricts[0].count) * 100}%` }} />
              </button>)}
              {(!data || error || !data.summary.topDistricts.length) && <p className="market-muted">{loading ? 'กำลังอ่านข้อมูลพื้นที่…' : 'ยังไม่มีข้อมูลเขตตามเงื่อนไขนี้'}</p>}
            </div>
          </div>
        </section>

        <form className="market-search" onSubmit={submit}>
          <div className="market-section-label">ค้นหาร้านเป้าหมาย <span>กรองจากข้อมูลที่มีจริง</span></div>
          <fieldset disabled={loading}>
            <div className="market-search-grid">
              <Field label="ชื่อร้าน"><SearchInput placeholder="ค้นหาชื่อไทยหรืออังกฤษ" value={draft.search ?? ''} onChange={set('search')} /></Field>
              <Field label="เขต / อำเภอ"><Input placeholder="เช่น วัฒนา" value={draft.district ?? ''} onChange={set('district')} /></Field>
              <Field label="ประเภทร้าน"><Input list="market-categories" placeholder="เช่น japanese หรือ cafe" value={draft.category ?? ''} onChange={set('category')} /></Field>
              <Button type="submit" variant="primary" icon="search">ค้นหาร้าน</Button>
            </div>
            <datalist id="market-categories">{data?.summary.topCategories.map(c => <option key={c.name} value={c.name} />)}</datalist>
            <div className="market-presets"><span>เลือกเร็ว</span>
              <button type="button" onClick={() => apply({ excludeHasTmpLead: true })} aria-pressed={filters.excludeHasTmpLead === true}>ยังไม่อยู่ในรายชื่อฝ่ายขาย</button>
              <button type="button" onClick={() => apply({ minRating: '4', minReviewCount: '50' })} aria-pressed={filters.minRating === '4' && filters.minReviewCount === '50'}>คะแนน 4+ · รีวิว 50+</button>
              <button type="button" onClick={() => apply({ category: 'cafe' })} aria-pressed={filters.category === 'cafe'}>คาเฟ่</button>
              <button type="button" onClick={() => apply({ category: 'japanese' })} aria-pressed={filters.category === 'japanese'}>ร้านญี่ปุ่น</button>
            </div>
            <details className="market-advanced">
              <summary>ตัวกรองเพิ่มเติม <span>คะแนน · รีวิว · เวลา · บริการ</span></summary>
              <div className="market-advanced-grid">
                <Field label="คะแนนขั้นต่ำ"><Input type="number" min={0} max={5} step={0.1} placeholder="0–5" value={draft.minRating ?? ''} onChange={set('minRating')} /></Field>
                <Field label="รีวิวขั้นต่ำ"><Input type="number" min={0} step={1} placeholder="เช่น 50" value={draft.minReviewCount ?? ''} onChange={set('minReviewCount')} /></Field>
                <Field label="ช่วงที่คนเยอะวันนี้" hint="เวลาไทย · ชั่วโมงเริ่มถึงก่อนชั่วโมงสิ้นสุด"><Input pattern="([01]?[0-9]|2[0-3])-([01]?[0-9]|2[0-4])" placeholder="เช่น 17-20" value={draft.busyWindow ?? ''} onChange={set('busyWindow')} /></Field>
                <Field label="ช่วงราคา"><Input placeholder="เช่น ฿200–400" value={draft.priceRange ?? ''} onChange={set('priceRange')} /></Field>
              </div>
              <div className="market-services">{([['dineIn', 'นั่งทาน'], ['takeaway', 'ซื้อกลับ'], ['delivery', 'เดลิเวอรี'], ['excludeHasTmpLead', 'ยังไม่อยู่ในรายชื่อฝ่ายขาย']] as const).map(([k, label]) => <Checkbox key={k} label={label} checked={!!draft[k]} onChange={set(k)} />)}</div>
              <Button type="submit" variant="primary">ใช้ตัวกรอง</Button>
            </details>
          </fieldset>
        </form>

        <ErrorText error={error} />
        {!loading && !error && !!data?.items.length && <RestaurantMap restaurants={data.items} page={page} total={total} onSelect={setSelected} />}
        <section className="market-results" aria-label="ผลการค้นหาร้าน" aria-busy={loading}>
          <div className="market-results-head"><div><h2>รายชื่อร้านอาหาร <span>{!loading && !error && data ? fmt.num(total) : '…'}</span></h2><p>เรียงตามชื่อร้าน · กดชื่อเพื่อดูรายละเอียด</p></div>
            {active.length > 0 && <Button onClick={() => apply({})} disabled={loading} icon="filter_alt_off">ล้างตัวกรอง ({active.length})</Button>}
          </div>
          {active.length > 0 && <div className="market-applied">{active.map(([key, value]) => <span key={key}>{FILTER_LABELS[key]}: {value === true ? 'ใช่' : String(value)}</span>)}</div>}
          {loading && <div role="status" className="market-loading">กำลังค้นหาร้านอาหาร…</div>}
          {!loading && error && <div className="market-empty"><Icon name="cloud_off" size={32} /><h3>ยังโหลดรายชื่อไม่ได้</h3><p>ลองรีเฟรชเพื่ออ่านข้อมูลอีกครั้ง</p><Button onClick={reload}>ลองอีกครั้ง</Button></div>}
          {!error && data && <div className="market-table-wrap"><table className="market-table"><thead><tr><th scope="col">ร้าน / พื้นที่</th><th scope="col">คะแนนและรีวิว</th><th scope="col">ช่วงราคา</th><th scope="col">คนเยอะวันนี้</th><th scope="col">สถานะฝ่ายขาย</th><th scope="col"><span className="sr-only">รายละเอียด</span></th></tr></thead><tbody>
            {data.items.map(r => <tr key={r.id}>
              <td><button className="market-name" onClick={() => setSelected(r)} disabled={loading}>{r.name || 'ยังไม่มีชื่อร้าน'}</button>{r.nameTh && r.nameEn && r.nameEn !== r.name && <span className="market-subname">{r.nameEn}</span>}<div className="market-location"><Icon name="location_on" size={14} /> {r.district || 'ยังไม่ระบุเขต'}<span>·</span>{categoryLabel(r.category)}</div></td>
              <td>{r.rating !== null ? <strong className="market-rating"><Icon name="star" size={15} /> {r.rating.toFixed(1)}</strong> : <span className="market-muted">ยังไม่มีคะแนน</span>}<span className="market-subname">{r.reviewCount !== null ? `${fmt.num(r.reviewCount)} รีวิว` : 'ยังไม่มีรีวิว'}</span></td>
              <td>{r.priceRange || <span className="market-muted">ยังไม่ระบุ</span>}</td>
              <td><Spark curve={r.popularTimesToday} /></td>
              <td><span className={`market-sales ${r.winbackAccountId ? 'is-linked' : ''}`}>{r.winbackAccountId ? 'มีในรายชื่อแล้ว' : 'ยังไม่มีในรายชื่อ'}</span>{r.winbackCustomerCode && <span className="market-subname">{r.winbackCustomerCode}</span>}</td>
              <td><button className="market-open" aria-label={`ดูรายละเอียด ${r.name}`} onClick={() => setSelected(r)} disabled={loading}><Icon name="arrow_forward" size={18} /></button></td>
            </tr>)}
          </tbody></table></div>}
          {!loading && !error && data?.items.length === 0 && <div className="market-empty"><Icon name="storefront" size={32} /><h3>ไม่พบร้านตามเงื่อนไข</h3><p>ลองลดคะแนนขั้นต่ำ หรือเลือกพื้นที่อื่น</p><Button onClick={() => apply({})}>ดูร้านทั้งหมด</Button></div>}
          {!error && !!data?.items.length && <div className="market-pagination"><Pager page={page} pageSize={LIMIT} total={total} onPage={next => { if (!loading) setPage(next); }} /></div>}
        </section>
        <footer className="market-footnote"><Icon name="info" size={16} /><span>คะแนน รีวิว และช่วงคนเยอะอาจมีไม่ครบทุกแห่ง · เวลาอ้างอิงกรุงเทพฯ · ตรวจสอบข้อมูลร้านก่อนติดต่อ</span></footer>
        {selected && <RestaurantDialog key={selected.id} restaurant={selected} onClose={() => setSelected(null)} />}
      </div>
    </Page>
  );
}

const FILTER_LABELS: Record<string, string> = { search: 'ชื่อร้าน', district: 'เขต', category: 'ประเภท', minRating: 'คะแนนขั้นต่ำ', minReviewCount: 'รีวิวขั้นต่ำ', priceRange: 'ราคา', busyWindow: 'ช่วงคนเยอะ', dineIn: 'นั่งทาน', takeaway: 'ซื้อกลับ', delivery: 'เดลิเวอรี', excludeHasTmpLead: 'ยังไม่มีฝ่ายขาย' };
const CATEGORY_LABELS: Record<string, string> = { restaurant: 'ร้านอาหาร', cafe: 'คาเฟ่', 'cafe:coffee_shop': 'ร้านกาแฟ', 'restaurant:thai': 'อาหารไทย', 'restaurant:japanese': 'อาหารญี่ปุ่น', 'restaurant:chinese': 'อาหารจีน', fast_food: 'อาหารจานด่วน', 'restaurant:noodle': 'ก๋วยเตี๋ยว' };
function categoryLabel(category: string | null) { return category ? CATEGORY_LABELS[category] || category : 'ยังไม่ระบุประเภท'; }

/** Today's 08:00–23:00 busyness; missing data stays explicitly unknown. */
function Spark({ curve }: { curve: number[] | null }) {
  if (!curve?.length) return <span className="market-muted">ยังไม่มีข้อมูล</span>;
  const peak = curve.indexOf(Math.max(...curve));
  return <div className="market-busyness"><span className="market-spark" role="img" aria-label={curve.map((v, i) => `${i + 8}:00 ${v}%`).join(', ')} title={curve.map((v, i) => `${i + 8}:00 ${v}%`).join('\n')}>
    {curve.map((v, i) => <i key={i} style={{ height: `${Math.max(2, Math.min(100, v))}%` }} className={v > 60 ? 'is-busy' : ''} />)}
  </span><small>{curve[peak] > 0 ? `สูงสุด ${String(peak + 8).padStart(2, '0')}:00` : 'ไม่มีช่วงหนาแน่น'}</small></div>;
}

function RestaurantDialog({ restaurant, onClose }: { restaurant: RestaurantRow; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { data, loading, error, reload } = useAsync(() => marketApi.restaurant(restaurant.id), []);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const r = data ?? restaurant;
  const hasCoordinates = hasRestaurantCoordinates(r);
  return <dialog ref={dialog} className="market-dialog" aria-labelledby="restaurant-title" onClose={onClose}>
    <div className="market-dialog-head"><span className="market-eyebrow">รายละเอียดร้านอาหาร</span><button autoFocus onClick={() => dialog.current?.close()} aria-label="ปิดรายละเอียด"><Icon name="close" size={22} /></button></div>
    <h2 id="restaurant-title">{r.name || 'ยังไม่มีชื่อร้าน'}</h2><p className="market-location">{r.district || 'ยังไม่ระบุเขต'} · {categoryLabel(r.category)}</p>
    <div className="market-detail-stats"><div><span>คะแนน / รีวิว</span><strong>{r.rating ?? 'ยังไม่มีคะแนน'}</strong><small>{r.reviewCount === null ? 'ยังไม่มีรีวิว' : `${fmt.num(r.reviewCount)} รีวิว`}</small></div><div><span>ช่วงราคา</span><strong>{r.priceRange || 'ยังไม่ระบุ'}</strong></div><div><span>จำนวนโต๊ะโดยประมาณ</span><strong>{fmt.num(r.estimatedTables)}</strong><small>คำนวณจากรีวิว ไม่ใช่จำนวนที่สำรวจ</small></div></div>
    <section className="market-detail-section"><h3>ช่วงคนเยอะวันนี้ <span>08:00–23:00 · เวลาไทย</span></h3><Spark curve={r.popularTimesToday} />{!!r.popularTimesToday?.length && <div className="market-time-axis" aria-hidden="true"><span>08:00</span><span>12:00</span><span>16:00</span><span>20:00</span><span>23:00</span></div>}</section>
    <section className="market-detail-section"><h3>สถานะฝ่ายขาย</h3><span className={`market-sales ${r.winbackAccountId ? 'is-linked' : ''}`}>{r.winbackAccountId ? 'มีในรายชื่อฝ่ายขายแล้ว' : 'ยังไม่มีในรายชื่อฝ่ายขาย'}</span>{r.winbackCustomerCode && <p>รหัสลูกค้า {r.winbackCustomerCode}</p>}</section>
    {loading && <p role="status" className="market-muted">กำลังโหลดบริการและแหล่งข้อมูล…</p>}<ErrorText error={error} />{error && <Button onClick={reload}>ลองโหลดรายละเอียดอีกครั้ง</Button>}
    {data && <><section className="market-detail-section"><h3>บริการของร้าน</h3><div className="market-detail-services">{([['dineIn', 'นั่งทาน'], ['takeaway', 'ซื้อกลับ'], ['delivery', 'เดลิเวอรี']] as const).map(([key, label]) => <span key={key}>{label}<strong>{data.serviceOptions[key] === true ? 'มีบริการ' : data.serviceOptions[key] === false ? 'ไม่มีบริการ' : 'ยังไม่มีข้อมูล'}</strong></span>)}</div></section><p className="market-muted">แหล่งข้อมูล: {data.source || 'ยังไม่ระบุ'} · ข้อมูลเพิ่มเติมล่าสุด: {data.enrichedAt ? new Date(data.enrichedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }) : 'ยังไม่มีข้อมูล'}</p></>}
    <div className="market-dialog-footer"><span>ตรวจสอบข้อมูลก่อนเข้าพบหรือติดต่อร้าน</span>{hasCoordinates && <a href={`https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`} target="_blank" rel="noreferrer"><Icon name="map" size={17} /> เปิดแผนที่</a>}</div>
  </dialog>;
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
        actions={<Button onClick={reload} icon="refresh">Refresh</Button>}
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
