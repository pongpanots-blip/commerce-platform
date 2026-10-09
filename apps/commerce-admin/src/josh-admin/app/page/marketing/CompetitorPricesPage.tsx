// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { FormEvent, Fragment, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ScrapingNavigation } from './ScrapingSourcesPage';
import { StepSources } from './CompetitorSteps';
import { CompetitorReviewGrid } from './CompetitorReviewGrid';
import { CompetitorAddSite } from './CompetitorAddSite';
import {
  captureCompetitorPrice, deleteCompetitorPrice, getCompetitorCatalogProduct, getCompetitorPrices,
  refreshCompetitorPrice, saveCompetitorPrice, verifyCompetitorPrice, getScrapedItem, getCompetitorSkuSuggestions, confirmCompetitorPrice, getCompetitorOverview, downloadCompetitorOverviewXlsx,
  getCompetitorSiteCandidates, matchCompetitorCatalogItem, type CompetitorSiteCandidates, type CompetitorOverviewRow, type CompetitorOverviewPosition,
  type CompetitorCatalogProduct, type CompetitorSkuSuggestion, type CompetitorOverview, type CompetitorOverviewFilters, type CompetitorPriceComparison, type CompetitorPriceInput,
} from '@josh/shared-api';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const money = (value: number | null) => value == null ? '—' : `฿${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value: string | null) => value ? new Date(value).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')) : 'ยังไม่มีราคา';
const blank: CompetitorPriceInput = { sku: '', ourWeightKg: 1, sourceUrl: '', competitorName: '', competitorSku: '', competitorWeightKg: 1,
  sourceContext: '', vatIncluded: false, collectionAllowed: false, autoRefresh: false };
const weightLabels: Record<CompetitorSkuSuggestion['weightMatch'], string> = { same: 'น้ำหนักตรง', different: 'น้ำหนักต่างกัน', unknown: 'ไม่ทราบน้ำหนัก', per_kg: 'เราขายต่อกก.' };
const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 bg-white p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';
const buttonClass = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';
const primaryClass = 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50';
const tone = (position: CompetitorOverviewPosition) => position === 'we_pricier' ? 'text-red-700' : position === 'we_cheaper' ? 'text-emerald-700' : 'text-gray-600';
const tabs: { position: CompetitorOverviewPosition | 'matched'; label: string; note: string; count: (t: CompetitorOverview['totals']) => number; tone: string }[] = [
  { position: 'we_pricier', get label(){return __uiText("เราแพงกว่า");}, note: 'ต้องคุยกับ supplier', count: t => t.wePricier, tone: 'text-red-700' },
  { position: 'we_cheaper', get label(){return __uiText("เราถูกกว่า");}, note: 'ราคาแข่งได้', count: t => t.weCheaper, tone: 'text-emerald-700' },
  { position: 'no_data', get label(){return __uiText("รอยืนยัน");}, note: 'ราคาเก่า / ยังไม่ยืนยัน', count: t => t.noData, tone: 'text-amber-700' },
  { position: 'matched', get label(){return __uiText("จับคู่แล้วทั้งหมด");}, note: 'SKU ที่มีคู่แข่งให้เทียบ', count: t => t.skus - t.unmatched, tone: 'text-gray-900' }];
const cellPill = (position: CompetitorOverviewPosition) => position === 'we_pricier' ? 'bg-red-50 text-red-700' : position === 'we_cheaper' ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-700';

function errorMessage(error: unknown) {
  const response = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(response) ? response.join(', ') : response || (error instanceof Error ? error.message : 'ทำรายการไม่สำเร็จ กรุณาลองใหม่');
}

export default function CompetitorPricesPage() {
  __useUiLocale();
  const [params, setParams] = useSearchParams();
  const catalogItemId = params.get('catalogItem');
  const step = (['sources', 'add', 'match', 'results'] as const).find(s => s === params.get('step')) ?? 'match';
  const activeStep = step === 'add' ? 'sources' : step; // adding a site is part of step 1
  const goStep = (next: 'sources' | 'add' | 'match' | 'results') => { setParams({ step: next }); window.scrollTo?.({ top: 0 }); };
  const [rows, setRows] = useState<CompetitorPriceComparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<CompetitorOverviewFilters>({ page: 1, position: 'matched' });
  const [overview, setOverview] = useState<CompetitorOverview | null>(null);
  const [form, setForm] = useState<CompetitorPriceInput | null>(null);
  const [editId, setEditId] = useState<string>();
  const [preview, setPreview] = useState<CompetitorCatalogProduct | null>(null);
  const [suggestions, setSuggestions] = useState<CompetitorSkuSuggestion[] | null>(null);
  const [openSku, setOpenSku] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CompetitorSiteCandidates | null>(null);
  const [candidatesKey, setCandidatesKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'review' | 'price' | null>(null);
  const [matchNote, setMatchNote] = useState('');
  const [price, setPrice] = useState('');
  const [observedAt, setObservedAt] = useState('');
  const page = filters.page ?? 1;
  const pages = Math.max(1, Math.ceil((overview?.total ?? 0) / (overview?.pageSize || 50)));
  const filter = (next: CompetitorOverviewFilters) => { setOpenSku(null); setFilters({ ...filters, ...next, page: next.page ?? 1 }); };

  const load = useCallback(async () => {
    try { const [pairs, view] = await Promise.all([getCompetitorPrices(), getCompetitorOverview(filters)]); setRows(pairs); setOverview(view); }
    catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!catalogItemId) return;
    let active = true;
    getScrapedItem(catalogItemId).then(item => {
      if (!active) return;
      setEditId(undefined); setPreview(null);
      setForm({ ...blank, catalogItemId: item.id, sourceUrl: item.url, competitorName: item.name, competitorSku: item.sku,
        competitorWeightKg: item.weightKg || 0, sourceContext: item.source.config.priceContext,
        vatIncluded: item.source.config.vatIncluded, collectionAllowed: item.source.config.collectionAllowed });
    }).catch(err => { if (active) setError(errorMessage(err)); });
    setSuggestions(null);
    getCompetitorSkuSuggestions(catalogItemId).then(result => { if (active) setSuggestions(result.suggestions); })
      .catch(err => { if (active) { setSuggestions([]); setError(errorMessage(err)); } });
    return () => { active = false; };
  }, [catalogItemId]);
  useEffect(() => {
    if (!openSku) return;
    let active = true; setCandidates(null);
    getCompetitorSiteCandidates(openSku).then(result => { if (active) setCandidates(result); })
      .catch(() => { if (active) setCandidates({ sku: openSku, name: '', offerSummary: '', ourPricePerKgIncVat: null, sites: [] }); });
    return () => { active = false; };
  }, [openSku, candidatesKey]);

  async function action(work: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await work(); }
    catch (err) { setError(errorMessage(err)); }
    finally { await load(); setBusy(false); }
  }

  function edit(row?: CompetitorPriceComparison, sku = '') {
    setPanel(null); setEditId(row?.id); setPreview(row?.ourProduct ?? null);
    setForm(row ? { revision: row.revision, sku: row.ourProduct.sku, ourWeightKg: row.ourWeightKg, sourceUrl: row.sourceUrl,
      competitorName: row.competitorName, competitorSku: row.competitorSku, competitorWeightKg: row.competitorWeightKg,
      sourceContext: row.sourceContext, vatIncluded: row.vatIncluded, collectionAllowed: row.collectionAllowed, autoRefresh: row.autoRefresh } : { ...blank, sku });
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  function toggle(sku: string) {
    setOpenSku(openSku === sku ? null : sku); setSelectedId(null); setPanel(null);
  }
  /** After pairing from the form, show that SKU's row open. */
  function showSku(sku: string) {
    setSearch(sku); setFilters({ search: sku, page: 1 }); setOpenSku(sku); setParams({ step: 'results' });
  }

  function openPanel(pair: CompetitorPriceComparison, kind: 'review' | 'price') {
    setSelectedId(pair.id); setPanel(kind); setMatchNote(pair.matchNote ?? ''); setPrice('');
    const now = new Date();
    setObservedAt(new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 19));
  }

  async function exportXlsx() {
    setBusy(true); setError('');
    try {
      const url = URL.createObjectURL(await downloadCompetitorOverviewXlsx({ ...filters, page: undefined }));
      const link = document.createElement('a');
      link.href = url; link.download = `competitor-prices-${new Date().toISOString().slice(0, 10)}.xlsx`; link.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  function skuPanel(row: CompetitorOverviewRow) {
    const selected = row.pairs.find(pair => pair.id === selectedId);
    return <div className="space-y-5 bg-gray-50 p-5">
      <div><h3 className="font-semibold">{__uiText("เว็บที่จับคู่กับ SKU นี้แล้ว (")}{row.pairs.length})</h3>
        {!row.pairs.length ? <p className="mt-1 text-sm text-gray-500">{__uiText("ยังไม่มี — เลือกสินค้าจากเว็บด้านล่างได้เลย")}</p>
          : <ul aria-label={__uiText("เว็บที่เทียบกับ SKU นี้")} className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">{row.comparisons.map(c => {
            const pair = row.pairs.find(p => p.id === c.pairId)!;
            const pending = !pair.verified || !pair.vatIncluded;
            return <li key={c.pairId} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0"><p className="font-medium">{c.sourceName}{c.priceBasis === 'member' ? __uiText(" (ราคาสมาชิก)") : ''}</p>
                <a className="break-words text-xs text-primary underline" href={c.sourceUrl} target="_blank" rel="noopener noreferrer">{c.competitorName} ↗</a>
                <p className="text-xs text-gray-500">{c.summary}{c.observedAt ? __uiText(" · พบราคา {0}", {"0": date(c.observedAt)}) : ''}</p></div>
              <div className="flex flex-wrap items-center gap-2"><span className={`text-xs font-medium ${pending ? 'text-amber-700' : tone(c.position)}`}>{c.verdict}</span>
                {pending && <button className={primaryClass} disabled={busy} onClick={() => void action(() => confirmCompetitorPrice(pair.id, pair.revision, pair.ourProductVersion))}>{__uiText("✓ สินค้าเดียวกัน")}</button>}
                <button className={buttonClass} disabled={busy} onClick={() => { if (window.confirm(__uiText("ลบคู่ {0} กับ {1}?", {"0": row.sku, "1": c.sourceName}))) void action(async () => { await deleteCompetitorPrice(pair.id); setCandidatesKey(k => k + 1); }); }}>{pending ? __uiText("ไม่ใช่ — ลบ") : __uiText("ลบ")}</button>
                <button className={buttonClass} disabled={busy} onClick={() => { setSelectedId(selectedId === pair.id ? null : pair.id); setPanel(null); }}>{selectedId === pair.id ? __uiText("ปิด") : __uiText("เพิ่มเติม")}</button></div>
            </li>;
          })}</ul>}
        {row.pairs.some(pair => !pair.verified || !pair.vatIncluded) && <p className="mt-2 text-xs text-gray-500">{__uiText("“✓ สินค้าเดียวกัน” = ยืนยันว่าเป็นสินค้าเดียวกันและราคาบนเว็บรวม VAT แล้วใช้ราคาที่เก็บล่าสุดเทียบทันที")}</p>}
      </div>

      {selected && <div aria-label={__uiText("ตัวเลือกเพิ่มเติม")} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium">{selected.sourceName} · {selected.competitorName}</p>
        <p className="text-xs text-gray-600">{__uiText("เงื่อนไขราคา: ")}{selected.sourceContext} {__uiText(" · น้ำหนักเรา ")}{selected.ourWeightKg} {__uiText(" กก. / คู่แข่ง ")}{selected.competitorWeightKg} {__uiText(" กก.")}</p>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} disabled={busy} onClick={() => edit(selected)}>{__uiText("แก้น้ำหนัก / ลิงก์")}</button>
          <button className={buttonClass} disabled={busy} onClick={() => openPanel(selected, 'review')}>{__uiText("ตรวจคู่สินค้าแบบละเอียด")}</button>
          <button className={buttonClass} disabled={busy || !selected.vatIncluded} onClick={() => openPanel(selected, 'price')}>{__uiText("บันทึกราคาเอง")}</button>
          <button className={buttonClass} disabled={busy || !selected.canRefresh} title={selected.refreshReason ?? undefined} onClick={() => void action(() => refreshCompetitorPrice(selected.id))}>{__uiText("ดึงราคาตอนนี้")}</button></div>
        {selected.refreshReason && <p className="text-xs text-gray-500">{selected.refreshReason}</p>}{selected.lastError && <p className="text-sm text-red-700">{selected.lastError}</p>}
        {panel === 'review' && <form aria-label={__uiText("ตรวจคู่สินค้า")} className="space-y-3 border-t border-gray-100 pt-3" onSubmit={e => { e.preventDefault(); void action(async () => { await verifyCompetitorPrice(selected.id, matchNote, selected.revision, selected.ourProductVersion); setPanel(null); }); }}>
          <p className="text-sm text-gray-600">{__uiText("ตรวจชนิด / ส่วนตัด เกรด แบรนด์ ประเทศ และแช่เย็นหรือแช่แข็งจากหน้าสินค้าก่อนยืนยัน")}</p>
          <label className="block text-sm">{__uiText("เหตุผลและสเปกที่ตรงกัน")}<textarea className={inputClass} required minLength={10} maxLength={1000} value={matchNote} onChange={e => setMatchNote(e.target.value)} /></label>
          <label className="flex gap-2 text-sm"><input type="checkbox" required />{__uiText("ตรวจสเปกจากแหล่งที่มาแล้ว และยืนยันน้ำหนักต่อหน่วยขายของเรา")}</label>
          <p className="text-xs text-gray-500">{__uiText("ยืนยันล่าสุด ")}{date(selected.verifiedAt)}{selected.verifiedBy ? __uiText(" · ผู้ยืนยัน {0}", {"0": selected.verifiedBy}) : ''}</p>
          <button className={primaryClass} disabled={busy}>{__uiText("ยืนยันคู่สินค้า")}</button></form>}
        {panel === 'price' && <form aria-label={__uiText("บันทึกราคา")} className="space-y-3 border-t border-gray-100 pt-3" onSubmit={e => { e.preventDefault(); void action(async () => { await captureCompetitorPrice(selected.id, Number(price), new Date(observedAt).toISOString(), selected.revision); setPanel(null); }); }}>
          <div className="grid gap-3 md:grid-cols-2"><label className="text-sm">{__uiText("ราคาเต็มแพ็ก ")}{selected.competitorWeightKg} {__uiText(" กก. (บาท รวม VAT)")}<input className={inputClass} type="number" required min="0.01" max="9999999999.99" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></label>
            <label className="text-sm">{__uiText("เวลาที่พบราคา")}<input className={inputClass} type="datetime-local" step="1" required value={observedAt} onChange={e => setObservedAt(e.target.value)} /></label></div>
          <button className={primaryClass} disabled={busy}>{__uiText("บันทึกราคา")}</button></form>}
      </div>}

      <div aria-label={__uiText("หาสินค้าเดียวกันจากเว็บอื่น")}><h3 className="font-semibold">{__uiText("เพิ่มเว็บให้ SKU นี้")}</h3>
        <p className="text-xs text-gray-500">{__uiText("สินค้าชื่อใกล้เคียงจากทุกเว็บที่เก็บไว้ — กด “✓ ตัวนี้” เพื่อจับคู่และยืนยันในครั้งเดียว")}</p>
        {candidates?.sku !== row.sku ? <p role="status" className="mt-2 text-sm text-gray-500">{__uiText("กำลังหาสินค้าที่ชื่อใกล้เคียงในแต่ละเว็บ…")}</p>
          : !candidates.sites.length ? <p className="mt-2 text-sm text-gray-500">{__uiText("ไม่พบสินค้าชื่อใกล้เคียงในเว็บที่เก็บไว้")}</p>
          : <div className="mt-2 grid gap-3 md:grid-cols-2">{candidates.sites.map(site => <div key={site.sourceId} className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-sm font-medium">{site.sourceName}{row.sites.includes(site.sourceName) && <span className="ml-2 text-xs font-normal text-emerald-700">{__uiText("มีคู่แล้ว")}</span>}</p>
            <ul className="mt-1 divide-y divide-gray-100">{site.candidates.map(item => <li key={item.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="flex min-w-0 gap-2">{item.image && <img src={item.image} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded object-cover" />}
                <div className="min-w-0"><a className="break-words text-primary underline" href={item.url} target="_blank" rel="noopener noreferrer">{item.name} ↗</a>
                  <p className="text-xs text-gray-500">{money(item.priceIncVat)} · {item.weightKg == null ? __uiText("ไม่ทราบน้ำหนัก") : __uiText("{0} กก.", {"0": item.weightKg})} {__uiText(" · ชื่อคล้าย ")}{item.similarityPercent}% · {weightLabels[item.weightMatch]}</p></div></div>
              {item.weightKg == null ? <button className={buttonClass} disabled={busy} onClick={() => setParams({ step: 'results', catalogItem: item.id })}>{__uiText("กรอกน้ำหนักเอง")}</button>
                : <button className={primaryClass} disabled={busy} onClick={() => void action(async () => { await matchCompetitorCatalogItem(item.id, row.sku); setCandidatesKey(k => k + 1); })}>{__uiText("✓ ตัวนี้")}</button>}
            </li>)}</ul></div>)}</div>}
        <button className="mt-2 text-xs text-primary underline" onClick={() => edit(undefined, row.sku)}>{__uiText("ไม่เจอ — กรอกลิงก์จากเว็บอื่นเอง")}</button>
      </div>
    </div>;
  }

  return <div className="cp-management-page space-y-5 text-gray-900">
    <ScrapingNavigation />
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">{__uiText("เทียบราคาคู่แข่ง")}</h1>
        <p className="mt-1 text-sm text-gray-500">{__uiText("เก็บราคาจากเว็บคู่แข่ง → จับคู่กับ SKU ของเรา → ดูว่าเราแพงหรือถูกกว่าแต่ละเว็บ (ราคาต่อกิโล รวม VAT)")}</p></div>
    </header>
    <nav aria-label={__uiText("ขั้นตอน")} className="grid gap-2 sm:grid-cols-3">{([
      ['sources', '1', __uiText('เว็บคู่แข่ง'), __uiText('เก็บสินค้าและราคาจากเว็บ')],
      ['match', '2', __uiText('ตรวจคู่ที่ระบบจับให้'), __uiText('ติ๊กตัวที่ถูก บันทึกอัตโนมัติ')],
      ['results', '3', __uiText('ผลเทียบราคา'), overview ? __uiText('เราแพงกว่า {0} SKU · Excel', {'0':overview.totals.wePricier.toLocaleString('th-TH')}) : __uiText('ตาราง + Excel')],
    ] as const).map(([key, number, title, detail]) => <button key={key} aria-current={activeStep === key ? 'step' : undefined} onClick={() => goStep(key)}
      className={`flex items-start gap-3 rounded-xl border bg-white p-4 text-left ${activeStep === key ? 'border-primary ring-1 ring-primary' : 'border-gray-200 hover:border-gray-300'}`}>
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${activeStep === key ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}>{number}</span>
      <span className="min-w-0"><span className="block font-semibold">{title}</span><span className="block text-xs text-gray-500">{detail}</span></span></button>)}</nav>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{(typeof error === 'string' ? __uiText(error) : error)}</div>}

    {form && <section aria-label={__uiText("เพิ่มหรือแก้ไขคู่สินค้า")} className="rounded-xl border border-primary-border bg-white p-5">
      <h2 className="text-lg font-semibold">{editId ? __uiText("แก้ไขคู่สินค้า") : __uiText("เพิ่มคู่สินค้า")}</h2>
      <p className="mt-1 text-xs text-gray-500">{__uiText("การเปลี่ยน SKU ลิงก์ น้ำหนัก หรือเงื่อนไขราคา จะล้างราคาเดิมและต้องยืนยันคู่ใหม่")}</p>
      <form className="mt-4 space-y-4" onSubmit={(event: FormEvent) => { event.preventDefault(); void action(async () => {
        const saved = await saveCompetitorPrice(form, editId); setForm(null); showSku(saved.ourProduct.sku);
      }); }}>
        {form.catalogItemId && <section aria-label={__uiText("SKU ที่น่าจะตรงกัน")} className="space-y-2">
          <h3 className="text-sm font-medium">{__uiText("SKU ของเราที่น่าจะตรงกับ “")}{form.competitorName}”</h3>
          {suggestions == null ? <p role="status" className="text-sm text-gray-500">{__uiText("กำลังหา SKU ที่ชื่อใกล้เคียง…")}</p>
            : !suggestions.length ? <p className="text-sm text-gray-500">{__uiText("ไม่พบ SKU ที่ชื่อใกล้เคียง กรอก SKU เองด้านล่าง")}</p>
            : <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">{suggestions.map(s => <li key={s.sku} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0"><p className="font-medium">{s.name}</p>
                <p className="text-xs text-gray-500">{s.sku} · {s.brand || __uiText("ไม่ระบุแบรนด์")} · {money(s.sellingUnitPriceIncVat)}/{s.sellingUnit || __uiText("หน่วย")}</p>
                {rows.some(row => row.ourProduct.sku === s.sku) && <p className="text-xs text-primary">{__uiText("SKU นี้เทียบอยู่แล้วกับ ")}{[...new Set(rows.filter(row => row.ourProduct.sku === s.sku).map(row => row.sourceName))].join(', ')} {__uiText(" — บันทึกแล้วจะเพิ่มเป็นอีกเว็บ")}</p>}</div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-gray-100 px-2 py-0.5">{__uiText("ชื่อคล้าย ")}{s.similarityPercent}%</span>
                <span className={`rounded-full px-2 py-0.5 ${s.weightMatch === 'different' ? 'bg-amber-50 text-amber-800' : s.weightMatch === 'unknown' ? 'bg-gray-100' : 'bg-green-50 text-green-800'}`}>{weightLabels[s.weightMatch]}{s.ourWeightKg != null && s.weightMatch !== 'per_kg' ? __uiText(" ({0} กก.)", {"0": s.ourWeightKg}) : ''}</span>
                <button type="button" className={buttonClass} disabled={busy || form.sku === s.sku} onClick={() => { setForm({ ...form, sku: s.sku, ourWeightKg: s.ourWeightKg ?? form.ourWeightKg }); setPreview(s); }}>{form.sku === s.sku ? __uiText("เลือกแล้ว") : __uiText("ใช้ SKU นี้")}</button></div>
            </li>)}</ul>}
          <p className="text-xs text-gray-500">{__uiText("ระบบเสนอจากชื่อและน้ำหนักเท่านั้น ตรวจแบรนด์ แพ็ก และสเปกก่อนบันทึก")}</p>
        </section>}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">{__uiText("SKU ของเรา")}<div className="flex items-end gap-2"><input className={inputClass} required maxLength={100} value={form.sku}
            onChange={e => { setForm({ ...form, sku: e.target.value }); setPreview(null); }} /><button type="button" className={`${buttonClass} shrink-0`} disabled={busy || !form.sku.trim()}
            onClick={() => void action(async () => setPreview(await getCompetitorCatalogProduct(form.sku)))}>{__uiText("ตรวจ SKU")}</button></div></label>
          <label className="text-sm">{__uiText("น้ำหนักต่อหน่วยขายของเรา (กก.)")}<input className={inputClass} type="number" min="0.0001" max="100000" step="0.0001" required value={form.ourWeightKg}
            onChange={e => setForm({ ...form, ourWeightKg: Number(e.target.value) })} /><span className="text-xs text-gray-500">{__uiText("SKU ที่ขายต่อ KG: ระบุจำนวนกิโลที่ต้องการเทียบ")}</span></label>
        </div>
        {preview && <div className="rounded-lg bg-primary-soft p-3 text-sm"><strong>{preview.name}</strong> · {preview.sku}<p className="mt-1 text-xs">{preview.brand || __uiText("ไม่ระบุแบรนด์")} · {preview.country || __uiText("ไม่ระบุประเทศ")} · {preview.storage || __uiText("ไม่ระบุการเก็บรักษา")} · {preview.packSize || __uiText("ไม่ระบุแพ็ก")} {__uiText(" · ราคาฐาน ")}{money(preview.sellingUnitPriceIncVat)}/{preview.sellingUnit || __uiText("ไม่ระบุหน่วย")}</p></div>}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">{__uiText("ชื่อสินค้าคู่แข่งตรงตามหน้าเว็บ")}<input className={inputClass} required maxLength={500} value={form.competitorName} onChange={e => setForm({ ...form, competitorName: e.target.value })} /></label>
          <label className="text-sm">{__uiText("SKU คู่แข่ง (ถ้ามี)")}<input className={inputClass} maxLength={100} value={form.competitorSku} onChange={e => setForm({ ...form, competitorSku: e.target.value })} /></label>
          <label className="text-sm">{__uiText("ลิงก์หน้าสินค้า")}<input className={inputClass} type="url" required maxLength={2000} value={form.sourceUrl} placeholder="https://…" onChange={e => setForm({ ...form, sourceUrl: e.target.value, catalogItemId: undefined })} /></label>
          <label className="text-sm">{__uiText("น้ำหนักสุทธิต่อแพ็กคู่แข่ง (กก.)")}<input className={inputClass} type="number" min="0.0001" max="100000" step="0.0001" required value={form.competitorWeightKg} onChange={e => setForm({ ...form, competitorWeightKg: Number(e.target.value) })} /></label>
        </div>
        <label className="block text-sm">{__uiText("เงื่อนไขราคา / สาขา / โปรโมชั่น")}<textarea className={inputClass} required maxLength={1000} value={form.sourceContext} placeholder={__uiText("เช่น ราคาปกติ สาขา… ไม่มีคูปองสมาชิก ไม่รวมค่าส่ง")} onChange={e => setForm({ ...form, sourceContext: e.target.value })} /></label>
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={form.vatIncluded} onChange={e => setForm({ ...form, vatIncluded: e.target.checked, autoRefresh: e.target.checked && form.autoRefresh })} />{__uiText("ตรวจแล้วว่าราคาคู่แข่งรวม VAT หรือสินค้ายกเว้น VAT")}</label>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={form.collectionAllowed} onChange={e => setForm({ ...form, collectionAllowed: e.target.checked, autoRefresh: e.target.checked && form.autoRefresh })} />{__uiText("มีสิทธิ์หรือได้รับอนุญาตให้ดึงข้อมูลอัตโนมัติจากแหล่งนี้")}</label>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" disabled={!form.vatIncluded || !form.collectionAllowed} checked={form.autoRefresh} onChange={e => setForm({ ...form, autoRefresh: e.target.checked })} />{__uiText("ดึงราคาอัตโนมัติรายชั่วโมง หลังยืนยันคู่สินค้าและตั้งค่าระบบดึงราคา")}</label>
        </div>
        <div className="flex gap-2"><button type="submit" className={primaryClass} disabled={busy}>{__uiText("บันทึกคู่สินค้า")}</button><button type="button" className={buttonClass} disabled={busy} onClick={() => { setForm(null); if (catalogItemId) setParams({ step }); }}>{__uiText("ยกเลิก")}</button></div>
      </form>
    </section>}

    {step === 'sources' && <section aria-label={__uiText("เว็บคู่แข่ง")} className="rounded-xl border border-gray-200 bg-white"><StepSources onNext={() => goStep('match')} onAdd={() => goStep('add')} /></section>}
    {step === 'add' && <section aria-label={__uiText("เพิ่มเว็บคู่แข่ง")} className="rounded-xl border border-gray-200 bg-gray-50"><button className="m-4 mb-0 text-sm text-primary underline" onClick={() => goStep('sources')}>{__uiText("← กลับไปหน้าเว็บคู่แข่ง")}</button>
      <CompetitorAddSite onDone={() => goStep('sources')} /></section>}
    {step === 'match' && <section aria-label={__uiText("จับคู่ SKU")} className="rounded-xl border border-gray-200 bg-white"><CompetitorReviewGrid onChanged={() => void load()} />
      <div className="flex justify-end border-t border-gray-100 p-3"><button className={buttonClass} onClick={() => goStep('results')}>{__uiText("ไปดูผลเทียบราคา →")}</button></div></section>}
    {step === 'results' && <section aria-label={__uiText("เทียบราคาราย SKU")} className="rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-end gap-2 border-b border-gray-100 p-2"><button className={buttonClass} disabled={busy} onClick={() => { setError(''); void load(); }}>{__uiText("โหลดล่าสุด")}</button>
        <button className={primaryClass} disabled={busy || !overview?.total} onClick={() => void exportXlsx()}>{__uiText("Export Excel")}</button></div>
      <div role="tablist" className="grid grid-cols-2 gap-3 border-b border-gray-100 p-3 md:grid-cols-4">{tabs.map(tab =>
        <button key={tab.label} role="tab" aria-selected={filters.position === tab.position} onClick={() => filter({ position: tab.position })}
          className={`rounded-xl bg-white p-4 text-left ${filters.position === tab.position ? 'border-2 border-primary' : 'border border-gray-200 hover:border-gray-300'}`}>
          <span className="block text-sm text-gray-600">{tab.label}</span>
          <span className={`block text-2xl font-semibold tabular-nums ${tab.tone}`}>{overview ? tab.count(overview.totals).toLocaleString('th-TH') : '—'}</span>
          <span className="block text-xs text-gray-500">{tab.note}</span></button>)}</div>
      <form className="flex flex-wrap items-end gap-2 p-3" onSubmit={e => { e.preventDefault(); filter({ search: search.trim() || undefined }); }}>
        <input aria-label={__uiText("ค้นหา SKU หรือชื่อสินค้า")} className="min-w-48 flex-1 rounded-lg border border-gray-300 p-2 text-sm" placeholder={__uiText("ค้นหา SKU / ชื่อสินค้า")} value={search} onChange={e => setSearch(e.target.value)} />
        <select aria-label={__uiText("เว็บคู่แข่ง")} className={buttonClass} value={filters.site ?? ''} onChange={e => filter({ site: e.target.value || undefined })}><option value="">{__uiText("ทุกเว็บ")}</option>{overview?.sites.map(site => <option key={site} value={site}>{site}</option>)}</select>
        <select aria-label={__uiText("หมวดสินค้า")} className={buttonClass} value={filters.category ?? ''} onChange={e => filter({ category: e.target.value || undefined })}><option value="">{__uiText("ทุกหมวด")}</option>{overview?.categories.map(category => <option key={category} value={category}>{category}</option>)}</select>
        <button className={buttonClass} disabled={busy}>{__uiText("ค้นหา")}</button>
      </form>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-y border-gray-100 bg-gray-50 text-xs text-gray-500"><tr>
        <th className="p-3 font-medium">{__uiText("สินค้าของเรา")}</th><th className="whitespace-nowrap p-3 text-right font-medium">{__uiText("ราคาเรา/กก.")}</th>
        {overview?.sites.map(site => <th key={site} className="whitespace-nowrap p-3 text-right font-medium">{site}</th>)}<th className="whitespace-nowrap p-3 text-right font-medium">{__uiText("ถูกสุดในตลาด")}</th><th className="p-3" /></tr></thead>
        <tbody>{overview?.rows.map(row => <Fragment key={row.sku}><tr className={`cursor-pointer border-b border-gray-100 align-top hover:bg-gray-50 ${openSku === row.sku ? 'bg-gray-50' : ''}`} onClick={() => toggle(row.sku)}>
          <td className="min-w-64 max-w-md p-3"><p className="font-medium">{row.name}{row.ourOffer.pricingType === 'approx' && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-normal text-amber-800" title={__uiText("น้ำหนักต่อหน่วยไม่คงที่ ราคาจริงคิดตามน้ำหนักที่ส่ง")}>{__uiText("Approx")}</span>}</p>
            <p className="mt-0.5 text-xs text-gray-500">{row.sku}{row.category ? ` · ${row.category}` : ''}</p>
            <p className="mt-0.5 text-xs text-gray-600">{row.ourOffer.summary || '—'}</p>
            {row.position !== 'unmatched' && <p className={`mt-1 text-xs font-medium ${tone(row.position)}`}>{row.verdict}</p>}</td>
          <td className="whitespace-nowrap p-3 text-right font-medium tabular-nums">{money(row.ourPricePerKgIncVat)}</td>
          {overview.sites.map(site => {
            const c = row.comparisons.find(comparison => comparison.sourceName === site);
            return <td key={site} className="whitespace-nowrap p-3 text-right">{!c ? <span className="text-gray-300">—</span>
              : !c.comparable ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">{__uiText("รอยืนยัน")}</span>
              : <><p className="tabular-nums">{money(c.pricePerKgIncVat)}</p><span className={`mt-0.5 inline-block rounded-full px-2 text-xs font-semibold ${cellPill(c.position)}`}>{c.position === 'same' ? __uiText("เท่ากัน") : `${c.position === 'we_pricier' ? 'เราแพงกว่า' : 'เราถูกกว่า'} ${Math.abs(c.differencePercent ?? 0)}%`}</span>
                {row.comparisons.filter(other => other.sourceName === site).length > 1 && <p className="text-xs text-gray-500">{__uiText("ถูกสุดจาก ")}{row.comparisons.filter(other => other.sourceName === site).length} {__uiText(" ขนาด")}</p>}</>}</td>;
          })}
          <td className="whitespace-nowrap p-3 text-right">{row.cheapest ? <><p className={`font-semibold ${tone(row.position)}`}>{row.position === 'we_cheaper' ? __uiText("เราถูกสุด") : row.position === 'same' ? __uiText("เท่ากัน") : __uiText("แพงกว่า {0}%", {"0": Math.abs(row.differencePercent ?? 0)})}</p>
            <p className="text-xs text-gray-500">{row.cheapest.sourceName} {money(row.cheapest.pricePerKgIncVat)}</p></> : <span className="text-xs text-gray-400">{__uiText("ยังเทียบไม่ได้")}</span>}</td>
          <td className="whitespace-nowrap p-3 text-right"><button className={row.position === 'unmatched' || row.pendingPairs ? primaryClass : buttonClass} onClick={e => { e.stopPropagation(); toggle(row.sku); }}>
            {openSku === row.sku ? __uiText("ปิด") : row.position === 'unmatched' ? __uiText("จับคู่") : row.pendingPairs ? __uiText("ยืนยัน") : __uiText("ดู / เพิ่มเว็บ")}</button></td>
        </tr>
        {openSku === row.sku && <tr><td colSpan={overview.sites.length + 4} className="border-b border-gray-200 p-0">{skuPanel(row)}</td></tr>}
        </Fragment>)}</tbody></table></div>
      {loading ? <p role="status" className="p-8 text-center text-gray-500">{__uiText("กำลังโหลด…")}</p> : !overview?.rows.length && <p className="p-8 text-center text-gray-500">{__uiText("ไม่พบ SKU ที่ตรงตัวกรอง")}</p>}
      {pages > 1 && <div className="flex items-center justify-center gap-3 border-t border-gray-100 p-3 text-sm">
        <button className={buttonClass} disabled={busy || page <= 1} onClick={() => filter({ page: page - 1 })}>{__uiText("ก่อนหน้า")}</button>
        <span>{__uiText("หน้า ")}{page} / {pages} · {overview?.total.toLocaleString('th-TH')} {__uiText(" SKU")}</span>
        <button className={buttonClass} disabled={busy || page >= pages} onClick={() => filter({ page: page + 1 })}>{__uiText("ถัดไป")}</button></div>}
    </section>}
    <p className="text-xs text-gray-500">{__uiText("ราคาที่เก่ากว่ารอบเก็บของเว็บนั้น (เก็บทุกวัน = 48 ชม.) หรือดึงครั้งล่าสุดไม่สำเร็จ จะพักการเทียบจนกว่าจะอัปเดตสำเร็จ · ใช้ราคาฐานแค็ตตาล็อก ไม่มีราคาสัญญารายลูกค้า")}</p>
  </div>;
}
