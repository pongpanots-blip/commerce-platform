// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Empty, ErrorText, Field, Input, Loading, Page, PageHeader, Panel, PanelHead, Pager, SearchInput, Stack2, Table, TBody, TD, TH, THead, TR, fmt, Icon } from '@cp/ui';
import { marketApi, RestaurantRow } from '../../lib/api';
import { useAsync } from '../hooks';
import { hasRestaurantCoordinates, RestaurantMap } from './RestaurantMap';
import './MarketExplorer.css';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Filters = {
  search?: string; district?: string; category?: string; minRating?: string; minReviewCount?: string;
  priceRange?: string; busyWindow?: string; dineIn?: boolean; takeaway?: boolean; delivery?: boolean; excludeHasTmpLead?: boolean;
};
const LIMIT = 20;
const WEEKDAYS = ['', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];

/** Market Explorer (moved from josh restaurant-place): restaurants for prospecting, read from josh's replica or commerce's copy (backend RESTAURANTS_SOURCE). */
export function MarketExplorer() {
  __useUiLocale();
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
          <div><div className="market-eyebrow"><Icon name="travel_explore" size={18} /> {__uiText(" MARKET EXPLORER")}</div>
            <h1>{__uiText("สำรวจร้านอาหาร")}<span>{__uiText("ค้นหาโอกาสให้ทีมขาย")}</span></h1>
            <p>{__uiText("เลือกพื้นที่และประเภทร้าน ดูข้อมูลประกอบ แล้วส่งต่อรายชื่อให้ทีม")}</p>
          </div>
          <div className="market-actions">
            <Button onClick={reload} icon="refresh" disabled={loading}>{__uiText("รีเฟรช")}</Button>
            <Button variant="primary" onClick={csv} icon="download" disabled={loading || exporting || !data || !!error || total === 0}>{exporting ? __uiText("กำลังส่งออก…") : __uiText("ส่งออกรายชื่อ CSV")}</Button>
          </div>
        </header>
        <ErrorText error={csvError} />

        <section className="market-overview" aria-label={__uiText("ภาพรวมร้านตามเงื่อนไข")} aria-busy={loading}>
          <div className="market-total">
            <span>{active.length ? __uiText("ร้านที่ตรงเงื่อนไข") : __uiText("ร้านในฐานข้อมูล")}</span>
            <strong>{loading ? '…' : error ? '—' : data ? fmt.num(total) : '—'}<small>{__uiText("ร้าน")}</small></strong>
            <span><Icon name="database" size={15} /> {__uiText(" ข้อมูลจาก JOSH · อ่านอย่างเดียว")}</span>
          </div>
          <div className="market-distribution">
            <div className="market-section-label">{__uiText("เริ่มจากพื้นที่ไหน ")}<span>{__uiText("เขตที่พบมากตามเงื่อนไข")}</span></div>
            <div className="market-districts">
              {!error && data?.summary.topDistricts.map((district) => <button key={district.name} disabled={loading} type="button" onClick={() => apply({ ...filters, district: district.name })} aria-label={__uiText("เลือกเขต {0}", {"0": district.name})}>
                <span>{district.name}</span><strong>{fmt.num(district.count)}</strong>
                <i style={{ width: `${district.count / Math.max(1, data.summary.topDistricts[0].count) * 100}%` }} />
              </button>)}
              {(!data || error || !data.summary.topDistricts.length) && <p className="market-muted">{loading ? __uiText("กำลังอ่านข้อมูลพื้นที่…") : __uiText("ยังไม่มีข้อมูลเขตตามเงื่อนไขนี้")}</p>}
            </div>
          </div>
        </section>

        <form className="market-search" onSubmit={submit}>
          <div className="market-section-label">{__uiText("ค้นหาร้านเป้าหมาย ")}<span>{__uiText("กรองจากข้อมูลที่มีจริง")}</span></div>
          <fieldset disabled={loading}>
            <div className="market-search-grid">
              <Field label={__uiText("ชื่อร้าน")}><SearchInput placeholder={__uiText("ค้นหาชื่อไทยหรืออังกฤษ")} value={draft.search ?? ''} onChange={set('search')} /></Field>
              <Field label={__uiText("เขต / อำเภอ")}><Input placeholder={__uiText("เช่น วัฒนา")} value={draft.district ?? ''} onChange={set('district')} /></Field>
              <Field label={__uiText("ประเภทร้าน")}><Input list="market-categories" placeholder={__uiText("เช่น japanese หรือ cafe")} value={draft.category ?? ''} onChange={set('category')} /></Field>
              <Button type="submit" variant="primary" icon="search">{__uiText("ค้นหาร้าน")}</Button>
            </div>
            <datalist id="market-categories">{data?.summary.topCategories.map(c => <option key={c.name} value={c.name} />)}</datalist>
            <div className="market-presets"><span>{__uiText("เลือกเร็ว")}</span>
              <button type="button" onClick={() => apply({ excludeHasTmpLead: true })} aria-pressed={filters.excludeHasTmpLead === true}>{__uiText("ยังไม่อยู่ในรายชื่อฝ่ายขาย")}</button>
              <button type="button" onClick={() => apply({ minRating: '4', minReviewCount: '50' })} aria-pressed={filters.minRating === '4' && filters.minReviewCount === '50'}>{__uiText("คะแนน 4+ · รีวิว 50+")}</button>
              <button type="button" onClick={() => apply({ category: 'cafe' })} aria-pressed={filters.category === 'cafe'}>{__uiText("คาเฟ่")}</button>
              <button type="button" onClick={() => apply({ category: 'japanese' })} aria-pressed={filters.category === 'japanese'}>{__uiText("ร้านญี่ปุ่น")}</button>
            </div>
            <details className="market-advanced">
              <summary>{__uiText("ตัวกรองเพิ่มเติม ")}<span>{__uiText("คะแนน · รีวิว · เวลา · บริการ")}</span></summary>
              <div className="market-advanced-grid">
                <Field label={__uiText("คะแนนขั้นต่ำ")}><Input type="number" min={0} max={5} step={0.1} placeholder="0–5" value={draft.minRating ?? ''} onChange={set('minRating')} /></Field>
                <Field label={__uiText("รีวิวขั้นต่ำ")}><Input type="number" min={0} step={1} placeholder={__uiText("เช่น 50")} value={draft.minReviewCount ?? ''} onChange={set('minReviewCount')} /></Field>
                <Field label={__uiText("ช่วงที่คนเยอะวันนี้")} hint={__uiText("เวลาไทย · ชั่วโมงเริ่มถึงก่อนชั่วโมงสิ้นสุด")}><Input pattern="([01]?[0-9]|2[0-3])-([01]?[0-9]|2[0-4])" placeholder={__uiText("เช่น 17-20")} value={draft.busyWindow ?? ''} onChange={set('busyWindow')} /></Field>
                <Field label={__uiText("ช่วงราคา")}><Input placeholder={__uiText("เช่น ฿200–400")} value={draft.priceRange ?? ''} onChange={set('priceRange')} /></Field>
              </div>
              <div className="market-services">{([['dineIn', 'นั่งทาน'], ['takeaway', 'ซื้อกลับ'], ['delivery', 'เดลิเวอรี'], ['excludeHasTmpLead', 'ยังไม่อยู่ในรายชื่อฝ่ายขาย']] as const).map(([k, label]) => <Checkbox key={k} label={label} checked={!!draft[k]} onChange={set(k)} />)}</div>
              <Button type="submit" variant="primary">{__uiText("ใช้ตัวกรอง")}</Button>
            </details>
          </fieldset>
        </form>

        <ErrorText error={error} />
        {!loading && !error && !!data?.items.length && <RestaurantMap restaurants={data.items} page={page} total={total} onSelect={setSelected} />}
        <section className="market-results" aria-label={__uiText("ผลการค้นหาร้าน")} aria-busy={loading}>
          <div className="market-results-head"><div><h2>{__uiText("รายชื่อร้านอาหาร ")}<span>{!loading && !error && data ? fmt.num(total) : '…'}</span></h2><p>{__uiText("เรียงตามชื่อร้าน · กดชื่อเพื่อดูรายละเอียด")}</p></div>
            {active.length > 0 && <Button onClick={() => apply({})} disabled={loading} icon="filter_alt_off">{__uiText("ล้างตัวกรอง (")}{active.length})</Button>}
          </div>
          {active.length > 0 && <div className="market-applied">{active.map(([key, value]) => <span key={key}>{FILTER_LABELS[key]}: {value === true ? __uiText("ใช่") : String(value)}</span>)}</div>}
          {loading && <div role="status" className="market-loading">{__uiText("กำลังค้นหาร้านอาหาร…")}</div>}
          {!loading && error && <div className="market-empty"><Icon name="cloud_off" size={32} /><h3>{__uiText("ยังโหลดรายชื่อไม่ได้")}</h3><p>{__uiText("ลองรีเฟรชเพื่ออ่านข้อมูลอีกครั้ง")}</p><Button onClick={reload}>{__uiText("ลองอีกครั้ง")}</Button></div>}
          {!error && data && <div className="market-table-wrap"><table className="market-table"><thead><tr><th scope="col">{__uiText("ร้าน / พื้นที่")}</th><th scope="col">{__uiText("คะแนนและรีวิว")}</th><th scope="col">{__uiText("ช่วงราคา")}</th><th scope="col">{__uiText("คนเยอะวันนี้")}</th><th scope="col">{__uiText("สถานะฝ่ายขาย")}</th><th scope="col"><span className="sr-only">{__uiText("รายละเอียด")}</span></th></tr></thead><tbody>
            {data.items.map(r => <tr key={r.id}>
              <td><button className="market-name" onClick={() => setSelected(r)} disabled={loading}>{r.name || __uiText("ยังไม่มีชื่อร้าน")}</button>{r.nameTh && r.nameEn && r.nameEn !== r.name && <span className="market-subname">{r.nameEn}</span>}<div className="market-location"><Icon name="location_on" size={14} /> {r.district || __uiText("ยังไม่ระบุเขต")}<span>·</span>{categoryLabel(r.category)}</div></td>
              <td>{r.rating !== null ? <strong className="market-rating"><Icon name="star" size={15} /> {r.rating.toFixed(1)}</strong> : <span className="market-muted">{__uiText("ยังไม่มีคะแนน")}</span>}<span className="market-subname">{r.reviewCount !== null ? __uiText("{0} รีวิว", {"0": fmt.num(r.reviewCount)}) : __uiText("ยังไม่มีรีวิว")}</span></td>
              <td>{r.priceRange || <span className="market-muted">{__uiText("ยังไม่ระบุ")}</span>}</td>
              <td><Spark curve={r.popularTimesToday} /></td>
              <td><span className={`market-sales ${r.winbackAccountId ? 'is-linked' : ''}`}>{r.winbackAccountId ? __uiText("มีในรายชื่อแล้ว") : __uiText("ยังไม่มีในรายชื่อ")}</span>{r.winbackCustomerCode && <span className="market-subname">{r.winbackCustomerCode}</span>}</td>
              <td><button className="market-open" aria-label={__uiText("ดูรายละเอียด {0}", {"0": r.name})} onClick={() => setSelected(r)} disabled={loading}><Icon name="arrow_forward" size={18} /></button></td>
            </tr>)}
          </tbody></table></div>}
          {!loading && !error && data?.items.length === 0 && <div className="market-empty"><Icon name="storefront" size={32} /><h3>{__uiText("ไม่พบร้านตามเงื่อนไข")}</h3><p>{__uiText("ลองลดคะแนนขั้นต่ำ หรือเลือกพื้นที่อื่น")}</p><Button onClick={() => apply({})}>{__uiText("ดูร้านทั้งหมด")}</Button></div>}
          {!error && !!data?.items.length && <div className="market-pagination"><Pager page={page} pageSize={LIMIT} total={total} onPage={next => { if (!loading) setPage(next); }} /></div>}
        </section>
        <footer className="market-footnote"><Icon name="info" size={16} /><span>{__uiText("คะแนน รีวิว และช่วงคนเยอะอาจมีไม่ครบทุกแห่ง · เวลาอ้างอิงกรุงเทพฯ · ตรวจสอบข้อมูลร้านก่อนติดต่อ")}</span></footer>
        {selected && <RestaurantDialog key={selected.id} restaurant={selected} onClose={() => setSelected(null)} />}
      </div>
    </Page>
  );
}

const FILTER_LABELS: Record<string, string> = { get search(){return __uiText("ชื่อร้าน");}, get district(){return __uiText("เขต");}, get category(){return __uiText("ประเภท");}, get minRating(){return __uiText("คะแนนขั้นต่ำ");}, get minReviewCount(){return __uiText("รีวิวขั้นต่ำ");}, get priceRange(){return __uiText("ราคา");}, get busyWindow(){return __uiText("ช่วงคนเยอะ");}, get dineIn(){return __uiText("นั่งทาน");}, get takeaway(){return __uiText("ซื้อกลับ");}, get delivery(){return __uiText("เดลิเวอรี");}, get excludeHasTmpLead(){return __uiText("ยังไม่มีฝ่ายขาย");} };
const CATEGORY_LABELS: Record<string, string> = { get restaurant(){return __uiText("ร้านอาหาร");}, get cafe(){return __uiText("คาเฟ่");}, get 'cafe:coffee_shop'(){return __uiText("ร้านกาแฟ");}, get 'restaurant:thai'(){return __uiText("อาหารไทย");}, get 'restaurant:japanese'(){return __uiText("อาหารญี่ปุ่น");}, get 'restaurant:chinese'(){return __uiText("อาหารจีน");}, get fast_food(){return __uiText("อาหารจานด่วน");}, get 'restaurant:noodle'(){return __uiText("ก๋วยเตี๋ยว");} };
function categoryLabel(category: string | null) { return category ? CATEGORY_LABELS[category] || category : __uiText("ยังไม่ระบุประเภท"); }

/** Today's 08:00–23:00 busyness; missing data stays explicitly unknown. */
function Spark({ curve }: { curve: number[] | null }) {
  __useUiLocale();
  if (!curve?.length) return <span className="market-muted">{__uiText("ยังไม่มีข้อมูล")}</span>;
  const peak = curve.indexOf(Math.max(...curve));
  return <div className="market-busyness"><span className="market-spark" role="img" aria-label={curve.map((v, i) => `${i + 8}:00 ${v}%`).join(', ')} title={curve.map((v, i) => `${i + 8}:00 ${v}%`).join('\n')}>
    {curve.map((v, i) => <i key={i} style={{ height: `${Math.max(2, Math.min(100, v))}%` }} className={v > 60 ? 'is-busy' : ''} />)}
  </span><small>{curve[peak] > 0 ? __uiText("สูงสุด {0}:00", {"0": String(peak + 8).padStart(2, '0')}) : __uiText("ไม่มีช่วงหนาแน่น")}</small></div>;
}

function RestaurantDialog({ restaurant, onClose }: { restaurant: RestaurantRow; onClose: () => void }) {
  __useUiLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const { data, loading, error, reload } = useAsync(() => marketApi.restaurant(restaurant.id), []);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const r = data ?? restaurant;
  const hasCoordinates = hasRestaurantCoordinates(r);
  return <dialog ref={dialog} className="market-dialog" aria-labelledby="restaurant-title" onClose={onClose}>
    <div className="market-dialog-head"><span className="market-eyebrow">{__uiText("รายละเอียดร้านอาหาร")}</span><button autoFocus onClick={() => dialog.current?.close()} aria-label={__uiText("ปิดรายละเอียด")}><Icon name="close" size={22} /></button></div>
    <h2 id="restaurant-title">{r.name || __uiText("ยังไม่มีชื่อร้าน")}</h2><p className="market-location">{r.district || __uiText("ยังไม่ระบุเขต")} · {categoryLabel(r.category)}</p>
    <div className="market-detail-stats"><div><span>{__uiText("คะแนน / รีวิว")}</span><strong>{r.rating ?? __uiText("ยังไม่มีคะแนน")}</strong><small>{r.reviewCount === null ? __uiText("ยังไม่มีรีวิว") : __uiText("{0} รีวิว", {"0": fmt.num(r.reviewCount)})}</small></div><div><span>{__uiText("ช่วงราคา")}</span><strong>{r.priceRange || __uiText("ยังไม่ระบุ")}</strong></div><div><span>{__uiText("จำนวนโต๊ะโดยประมาณ")}</span><strong>{fmt.num(r.estimatedTables)}</strong><small>{__uiText("คำนวณจากรีวิว ไม่ใช่จำนวนที่สำรวจ")}</small></div></div>
    <section className="market-detail-section"><h3>{__uiText("ช่วงคนเยอะวันนี้ ")}<span>{__uiText("08:00–23:00 · เวลาไทย")}</span></h3><Spark curve={r.popularTimesToday} />{!!r.popularTimesToday?.length && <div className="market-time-axis" aria-hidden="true"><span>08:00</span><span>12:00</span><span>16:00</span><span>20:00</span><span>23:00</span></div>}</section>
    <section className="market-detail-section"><h3>{__uiText("สถานะฝ่ายขาย")}</h3><span className={`market-sales ${r.winbackAccountId ? 'is-linked' : ''}`}>{r.winbackAccountId ? __uiText("มีในรายชื่อฝ่ายขายแล้ว") : __uiText("ยังไม่มีในรายชื่อฝ่ายขาย")}</span>{r.winbackCustomerCode && <p>{__uiText("รหัสลูกค้า ")}{r.winbackCustomerCode}</p>}</section>
    {loading && <p role="status" className="market-muted">{__uiText("กำลังโหลดบริการและแหล่งข้อมูล…")}</p>}<ErrorText error={error} />{error && <Button onClick={reload}>{__uiText("ลองโหลดรายละเอียดอีกครั้ง")}</Button>}
    {data && <><section className="market-detail-section"><h3>{__uiText("บริการของร้าน")}</h3><div className="market-detail-services">{([['dineIn', 'นั่งทาน'], ['takeaway', 'ซื้อกลับ'], ['delivery', 'เดลิเวอรี']] as const).map(([key, label]) => <span key={key}>{label}<strong>{data.serviceOptions[key] === true ? __uiText("มีบริการ") : data.serviceOptions[key] === false ? __uiText("ไม่มีบริการ") : __uiText("ยังไม่มีข้อมูล")}</strong></span>)}</div></section><p className="market-muted">{__uiText("แหล่งข้อมูล: ")}{data.source || __uiText("ยังไม่ระบุ")} {__uiText(" · ข้อมูลเพิ่มเติมล่าสุด: ")}{data.enrichedAt ? new Date(data.enrichedAt).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }) : __uiText("ยังไม่มีข้อมูล")}</p></>}
    <div className="market-dialog-footer"><span>{__uiText("ตรวจสอบข้อมูลก่อนเข้าพบหรือติดต่อร้าน")}</span>{hasCoordinates && <a href={`https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`} target="_blank" rel="noreferrer"><Icon name="map" size={17} /> {__uiText(" เปิดแผนที่")}</a>}</div>
  </dialog>;
}

/** Order target group (moved from josh order-targetgroup): customers by order-taking SKUs and delivery frequency. */
export function OrderTargetgroup() {
  __useUiLocale();
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
        title={__uiText("Order target group")}
        subtitle={__uiText("ลูกค้าแต่ละรายสั่ง SKU แบบ order-taking กี่ตัว และส่งของได้กี่วันต่อสัปดาห์ · อ่านจาก replica ของ josh")}
        actions={<Button onClick={reload} icon="refresh">{__uiText("Refresh")}</Button>}
      />

      <Panel as="form" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(custCode.trim()); }}>
        <PanelHead title={__uiText("ค้นหา")} />
        <div className="px-4 py-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label={__uiText("รหัสลูกค้า")}>
              <Input value={custCode} onChange={(e) => setCustCode(e.target.value)} />
            </Field>
            <Field label={__uiText("ส่งได้อย่างน้อย (วัน/สัปดาห์)")}>
              <select value={minShipments} onChange={(e) => { setPage(1); setMinShipments(Number(e.target.value)); }} className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n === 0 ? __uiText("ทั้งหมด") : `≥ ${n}`}</option>)}
              </select>
            </Field>
          </div>
          <Button type="submit">{__uiText("ค้นหา")}</Button>
        </div>
      </Panel>

      <ErrorText error={error} />

      {data && (
        <>
          <div className="text-xs text-on-surface-variant">{fmt.num(data.total)} {__uiText(" ราย")}</div>

          <Panel className="overflow-hidden">
            <Table>
              <THead>
                <TH>{__uiText("ลูกค้า")}</TH>
                <TH right>{__uiText("SKU ที่สั่ง")}</TH>
                <TH right>{__uiText("SKU order-taking")}</TH>
                <TH right>{__uiText("มีรอบส่งเปิด")}</TH>
                <TH right>{__uiText("ส่งได้/สัปดาห์")}</TH>
                <TH>{__uiText("วันส่ง")}</TH>
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
                  <TR><TD colSpan={6}><Empty icon="inbox">{__uiText("ไม่พบข้อมูล")}</Empty></TD></TR>
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

// ui-display-helper-migration: display descriptions; record values and enum keys remain data
