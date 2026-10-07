import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { getScrapedItems, getScrapingSources, getCompetitorPrices, getCompetitorSkuSuggestions, matchCompetitorCatalogItem,
  type ScrapedCatalogItem, type ScrapingSource, type CompetitorPriceComparison, type CompetitorSkuSuggestion } from '@josh/shared-api';
import { ScrapingNavigation, scrapingButton, scrapingPrimary, scrapingInput, scrapingError } from './ScrapingSourcesPage';

export default function ScrapedCatalogPage() {
  const [params, setParams] = useSearchParams();
  const sourceId = params.get('sourceId') || '';
  const [sources, setSources] = useState<ScrapingSource[]>([]);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: ScrapedCatalogItem[]; total: number }>({ items: [], total: 0 });
  const [selected, setSelected] = useState<ScrapedCatalogItem | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [pairs, setPairs] = useState<CompetitorPriceComparison[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, CompetitorSkuSuggestion[]>>({});
  const [busySku, setBusySku] = useState('');
  useEffect(() => { getScrapingSources().then(setSources).catch(err => setError(scrapingError(err))); }, []);
  useEffect(() => { getCompetitorPrices().then(setPairs).catch(() => undefined); }, [refresh]);
  const weightText: Record<CompetitorSkuSuggestion['weightMatch'], string> = { same: 'น้ำหนักตรง', different: 'น้ำหนักต่างกัน', unknown: 'ไม่ทราบน้ำหนัก', per_kg: 'เราขายต่อกก.' };
  function openMatch(item: ScrapedCatalogItem) {
    setOpenId(openId === item.id ? null : item.id);
    if (!suggestions[item.id]) getCompetitorSkuSuggestions(item.id).then(result => setSuggestions(all => ({ ...all, [item.id]: result.suggestions })))
      .catch(err => { setSuggestions(all => ({ ...all, [item.id]: [] })); setError(scrapingError(err)); });
  }
  async function pick(item: ScrapedCatalogItem, sku: string) {
    setBusySku(sku); setError('');
    try { const pair = await matchCompetitorCatalogItem(item.id, sku); setPairs(all => [...all, pair]); setOpenId(null); }
    catch (err) { setError(scrapingError(err)); } finally { setBusySku(''); }
  }
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setSelected(null); setResult({ items: [], total: 0 });
    getScrapedItems(sourceId, query, page).then(data => { if (active) setResult(data); })
      .catch(err => { if (active) setError(scrapingError(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sourceId, query, page, refresh]);
  return <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
    <ScrapingNavigation />
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">ข้อมูลจากเว็บ</h1>
      <p className="mt-1 text-sm text-gray-500">ค้นหาสินค้า ตรวจข้อมูลต้นทาง แล้วเลือกจับคู่กับ SKU ของเรา</p></div><Link className={scrapingPrimary} to={ADMIN_ROUTES.scrapingSources}>ตั้งค่า / เริ่มเก็บเว็บ</Link></header>
    <form className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search); setRefresh(r => r + 1); }}>
      <label className="min-w-40 text-sm">เว็บต้นทาง<select className={scrapingInput} value={sourceId} onChange={e => { setPage(1); setParams(e.target.value ? { sourceId: e.target.value } : {}); }}><option value="">ทุกเว็บ</option>{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
      <label className="min-w-48 flex-1 text-sm">ชื่อสินค้า / SKU<input className={scrapingInput} maxLength={200} value={search} placeholder="เช่น เนื้อ 1 กก." onChange={e => setSearch(e.target.value)} /></label>
      <button className={scrapingPrimary} disabled={loading}>ค้นหา</button><button type="button" className={scrapingButton} disabled={loading} onClick={() => setRefresh(r => r + 1)}>โหลดล่าสุด</button>
    </form>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="flex justify-between text-sm"><p>{result.total.toLocaleString('th-TH')} รายการ</p><p className="text-gray-500">ราคาที่แสดง: THB รวม VAT · น้ำหนักที่ไม่ระบุให้ตรวจเอง</p></div>
    {loading ? <p role="status">กำลังโหลดรายการ…</p> : !result.items.length ? <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center"><h2 className="font-semibold">ยังไม่มีรายการที่ตรงคำค้น</h2><p className="mt-2 text-sm text-gray-500">ลองเปลี่ยนคำค้น หรือเพิ่มเว็บและเริ่มเก็บข้อมูล</p></div> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{result.items.map(item => <article key={item.id} className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex justify-between gap-2"><span className="text-xs font-medium text-primary">{item.source.name}</span><span className="text-xs text-gray-500">{item.sku || 'ไม่มี SKU ต้นทาง'}</span></div>
      <div className="flex gap-3">{item.fields.image && <img src={item.fields.image} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded object-cover" />}<h2 className="font-semibold">{item.name}</h2></div>
      <div className="flex items-baseline justify-between gap-2"><p className={`text-2xl font-semibold tabular-nums ${item.priceIncVat == null && item.fields.price ? 'text-gray-400' : ''}`}>{item.priceIncVat != null ? `฿${item.priceIncVat.toLocaleString('th-TH')}` : item.fields.price || '—'}</p><p className="text-sm text-gray-500">{item.weightKg == null ? 'น้ำหนักยังไม่ชัดเจน' : `${item.weightKg} กก.`}</p></div>
      {item.priceIncVat == null && <p className="text-xs text-amber-700">{item.fields.price
        ? (item.source.config.vatIncluded ? 'ราคาบนการ์ดไม่ชัดเจน (มีหลายราคา) ตรวจก่อนนำไปเทียบ' : 'ยังไม่ยืนยันว่าราคารวม VAT — ยืนยันที่ “ตั้งค่าเว็บ” แล้วกด “เริ่มรอบใหม่” จึงจะใช้เทียบได้')
        : 'ยังไม่มีราคา THB รวม VAT ที่ชัดเจน'}</p>}
      {!item.configCurrent && <p className="text-xs text-amber-700">ตั้งค่าเว็บเปลี่ยนแล้ว ควรดึงใหม่ก่อนจับคู่</p>}
      <p className="text-xs text-gray-500">เก็บเมื่อ {new Date(item.observedAt).toLocaleString('th-TH')}</p>
      <a className="text-sm text-primary underline" href={item.url} target="_blank" rel="noopener noreferrer">ดูแหล่งที่มา ↗</a>
      {pairs.filter(pair => pair.sourceUrl === item.url).map(pair => <p key={pair.id} className="rounded-lg bg-green-50 p-2 text-sm text-green-800">✓ จับคู่กับ {pair.ourProduct.sku} · {pair.ourProduct.name} <Link className="underline" to={ADMIN_ROUTES.competitorPrices}>ดูเทียบราคา</Link></p>)}
      {openId === item.id && <section aria-label={`SKU ที่น่าจะตรงกับ ${item.name}`} className="space-y-2 rounded-lg border border-gray-200 p-3 text-sm">
        <p className="font-medium">SKU ของเราตัวไหนตรงกับสินค้านี้?</p>
        {!suggestions[item.id] ? <p role="status" className="text-gray-500">กำลังหา SKU ที่ชื่อใกล้เคียง…</p>
          : !suggestions[item.id].length ? <p className="text-gray-500">ไม่พบ SKU ที่ชื่อใกล้เคียง</p>
          : suggestions[item.id].map(s => <div key={s.sku} className="flex items-center justify-between gap-2 border-t border-gray-100 pt-2 first:border-0 first:pt-0">
            <div className="min-w-0"><p>{s.name}</p><p className="text-xs text-gray-500">{s.sku} · ชื่อคล้าย {s.similarityPercent}% · {weightText[s.weightMatch]}</p></div>
            <button className={scrapingPrimary} disabled={!!busySku} onClick={() => void pick(item, s.sku)}>{busySku === s.sku ? 'กำลังบันทึก…' : '✓ ตัวนี้'}</button></div>)}
        <Link className="block text-xs text-primary underline" to={`${ADMIN_ROUTES.competitorPrices}?catalogItem=${item.id}`}>ไม่มีตัวที่ตรง — กรอก SKU เอง</Link>
      </section>}
      <div className="mt-auto flex gap-2 pt-2"><button className={scrapingButton} onClick={() => setSelected(item)}>ดูข้อมูลทั้งหมด</button><button className={scrapingPrimary} onClick={() => openMatch(item)}>{openId === item.id ? 'ปิด' : 'จับคู่ SKU ของเรา'}</button></div>
    </article>)}</div>}
    <div className="flex items-center justify-center gap-3 text-sm"><button className={scrapingButton} disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>ก่อนหน้า</button><span>หน้า {page} / {Math.max(1, Math.ceil(result.total / 30))}</span><button className={scrapingButton} disabled={page * 30 >= result.total || loading} onClick={() => setPage(p => p + 1)}>ถัดไป</button></div>
    {selected && <section aria-label="รายละเอียดข้อมูลจากเว็บ" className="space-y-3 rounded-xl border border-primary-border bg-white p-5"><div className="flex justify-between gap-2"><h2 className="font-semibold">{selected.name}</h2><button className={scrapingButton} onClick={() => setSelected(null)}>ปิด</button></div>
      <dl className="space-y-3 text-sm">{Object.entries(selected.fields).map(([key, value]) => <div key={key} className="grid gap-2 break-words md:grid-cols-[180px_1fr]"><dt className="text-gray-500">{selected.source.config.fields.find(field => field.key === key)?.label || key}</dt><dd>{value || '—'}</dd></div>)}</dl>
      <p className="break-all text-xs text-gray-500">หน้าที่อ่าน: {selected.pageUrl}</p><p className="text-xs text-gray-500">เงื่อนไข: {selected.source.config.priceContext}</p>
    </section>}
  </div>;
}
