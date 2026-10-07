import { useCallback, useEffect, useState } from 'react';
import {
  finishCompetitorReview, getCompetitorReviewGrid, searchCompetitorReview, setCompetitorReviewCell,
  type CompetitorCompareTone, type CompetitorReviewCell, type CompetitorReviewGrid as Grid, type CompetitorReviewRow,
  type CompetitorReviewSearchResult, type CompetitorTypedSize,
} from '@josh/shared-api';
import { scrapingError } from './ScrapingSourcesPage';

type FilledCell = Exclude<CompetitorReviewCell, { state: 'none' }>;
const pill: Record<CompetitorCompareTone, string> = {
  cheaper: 'bg-emerald-50 text-emerald-800', pricier: 'bg-red-50 text-red-700', close: 'bg-gray-100 text-gray-700', unknown: 'bg-amber-50 text-amber-800',
};
const units: { value: CompetitorTypedSize['unit']; label: string }[] = [
  { value: 'kg', label: 'กก.' }, { value: 'g', label: 'กรัม' }, { value: 'l', label: 'ลิตร' }, { value: 'ml', label: 'มล.' }, { value: 'piece', label: 'ชิ้น / ตัว / ฟอง' }];
const button = 'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';
const primary = 'rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50';
const input = 'rounded-md border border-gray-300 px-2 py-1 text-sm';

/** Pack size editor: fixed or range, any unit, pieces per pack. */
function SizeEditor({ initial, busy, onSave, onCancel }: { initial: FilledCell['size']; busy: boolean; onSave: (size: CompetitorTypedSize) => void; onCancel?: () => void }) {
  const [range, setRange] = useState(!!initial && initial.min !== initial.max);
  const [unit, setUnit] = useState<CompetitorTypedSize['unit']>(initial?.unit === 'l' ? 'l' : initial?.unit === 'piece' ? 'piece' : 'kg');
  const [min, setMin] = useState(initial ? String(initial.min) : '');
  const [max, setMax] = useState(initial ? String(initial.max) : '');
  const [count, setCount] = useState(String(initial?.packCount ?? 1));
  const valid = Number(min) > 0 && (!range || Number(max) > 0) && Number(count) >= 1;
  return <form aria-label="ขนาดแพ็ก" className="mt-2 space-y-2 rounded-lg border border-primary-border bg-gray-50 p-2 text-xs" onSubmit={e => { e.preventDefault();
    if (valid) onSave({ unit, min: Number(min), max: range ? Number(max) : undefined, packCount: Number(count) }); }}>
    <div className="flex items-center justify-between gap-2"><span className="font-semibold">ขนาดแพ็กนี้</span>
      <span role="group" aria-label="แบบขนาด" className="inline-flex overflow-hidden rounded-md border border-gray-300">
        <button type="button" aria-pressed={!range} className={`px-2 py-0.5 ${!range ? 'bg-primary text-white' : 'bg-white'}`} onClick={() => setRange(false)}>คงที่</button>
        <button type="button" aria-pressed={range} className={`border-l border-gray-300 px-2 py-0.5 ${range ? 'bg-primary text-white' : 'bg-white'}`} onClick={() => setRange(true)}>เป็นช่วง</button></span></div>
    <div className="flex flex-wrap items-center gap-1">
      {range && <span>ตั้งแต่</span>}<input aria-label={range ? 'ต่ำสุด' : 'ขนาด'} className={`${input} w-16`} inputMode="decimal" value={min} onChange={e => setMin(e.target.value)} />
      {range && <><span>ถึง</span><input aria-label="สูงสุด" className={`${input} w-16`} inputMode="decimal" value={max} onChange={e => setMax(e.target.value)} /></>}
      <select aria-label="หน่วย" className={input} value={unit} onChange={e => setUnit(e.target.value as CompetitorTypedSize['unit'])}>{units.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}</select>
      <span>×</span><input aria-label="จำนวนชิ้นในแพ็ก" className={`${input} w-12`} inputMode="numeric" value={count} onChange={e => setCount(e.target.value)} /><span>ชิ้น</span></div>
    <p className="text-gray-500">เช่น 250 มล. × 24 ขวด · ช่วงจะเทียบด้วยค่ากลาง</p>
    <div className="flex gap-2"><button className={primary} disabled={busy || !valid}>บันทึกขนาด</button>{onCancel && <button type="button" className={button} onClick={onCancel}>ยกเลิก</button>}</div>
  </form>;
}

/** Small product photo so a person can tell items apart at a glance; a grey box when there is none. */
function Thumb({ src, size = 'h-10 w-10' }: { src: string | null | undefined; size?: string }) {
  return src ? <img src={src} alt="" loading="lazy" className={`${size} shrink-0 rounded border border-gray-100 bg-white object-contain`} />
    : <span aria-hidden className={`${size} shrink-0 rounded bg-gray-100`} />;
}

/** "ค้นหาเอง": searches the items we already collected from this site. */
function SiteSearch({ site, sku, query, busy, onPick, onClose }: { site: string; sku: string; query: string; busy: boolean; onPick: (r: CompetitorReviewSearchResult) => void; onClose: () => void }) {
  const [text, setText] = useState(query);
  const [results, setResults] = useState<CompetitorReviewSearchResult[] | null>(null);
  const [error, setError] = useState('');
  const run = useCallback((q: string) => { setResults(null); setError(''); searchCompetitorReview(site, q, sku).then(setResults).catch(err => { setResults([]); setError(scrapingError(err)); }); }, [site, sku]);
  useEffect(() => { if (query.trim()) run(query); }, [query, run]);
  return <div className="space-y-2 rounded-lg border border-primary-border bg-white p-2 text-xs">
    <form className="flex gap-1" onSubmit={e => { e.preventDefault(); if (text.trim()) run(text.trim()); }}>
      <label className="flex-1"><span className="sr-only">ค้นจากสินค้าที่เก็บไว้ของ {site}</span><input className={`${input} w-full`} value={text} onChange={e => setText(e.target.value)} placeholder={`ค้นใน ${site}`} /></label>
      <button className={button}>ค้นหา</button></form>
    {error && <p className="text-red-700">{error}</p>}
    {results == null ? <p role="status" className="text-gray-500">กำลังค้น…</p> : !results.length ? <p className="text-gray-500">ไม่เจอในข้อมูลที่เก็บไว้</p>
      : <ul className="divide-y divide-gray-100">{results.map(r => <li key={r.itemId} className="flex items-center justify-between gap-2 py-1.5">
        <Thumb src={r.image} /><span className="min-w-0 flex-1"><a className="block break-words font-medium text-gray-900 underline" href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a><span className="text-gray-600">{r.packLine}</span></span>
        <button className={primary} disabled={busy} onClick={() => onPick(r)}>เลือก</button></li>)}</ul>}
    <p className="text-gray-500">ค้นในข้อมูลที่เก็บมาแล้ว ไม่ได้เปิดเว็บสด · ไม่เจอ = รอเก็บรอบคืนนี้</p>
    <button className="text-gray-600 underline" onClick={onClose}>ไม่มีในเว็บนี้จริงๆ</button>
  </div>;
}

/**
 * Step 2 — the system pairs, a person checks. Each tick/untick and size edit saves at once; "ชุดถัดไป" saves the
 * proposals still ticked in this batch and marks its SKUs reviewed. Work by category, stop anywhere, come back later.
 */
export function CompetitorReviewGrid({ onChanged }: { onChanged: () => void }) {
  const [grid, setGrid] = useState<Grid | null>(null);
  const [category, setCategory] = useState('');
  const [show, setShow] = useState<'todo' | 'done'>('todo');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState('');
  const [searching, setSearching] = useState('');
  const [picked, setPicked] = useState<Record<string, FilledCell>>({}); // search pick that still needs a size
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('บันทึกอัตโนมัติทุกการติ๊ก');
  const [error, setError] = useState('');

  const load = useCallback(async (next: { category?: string; show?: 'todo' | 'done'; page?: number }) => {
    setError('');
    try {
      const data = await getCompetitorReviewGrid(next);
      setGrid(data); setCategory(data.category); setShow(data.show); setPage(data.page); setPicked({}); setEditing(''); setSearching('');
    } catch (err) { setError(scrapingError(err)); }
  }, []);
  useEffect(() => { void load({}); }, [load]);

  const key = (sku: string, site: string) => `${sku}|${site}`;
  function replaceRow(row: CompetitorReviewRow) { setGrid(g => g && { ...g, rows: g.rows.map(r => r.sku === row.sku ? row : r) }); }
  async function save(sku: string, site: string, body: Parameters<typeof setCompetitorReviewCell>[0]) {
    setBusy(key(sku, site)); setError(''); setStatus('กำลังบันทึก…');
    try {
      replaceRow(await setCompetitorReviewCell(body));
      setPicked(p => { const { [key(sku, site)]: _done, ...rest } = p; return rest; });
      setEditing(''); setSearching(''); setStatus('บันทึกแล้ว · เมื่อสักครู่'); onChanged();
    } catch (err) { setError(scrapingError(err)); setStatus('บันทึกไม่สำเร็จ'); } finally { setBusy(''); }
  }
  /** Tick = pair now; untick = "not this one" now (the site's next proposal takes the cell). */
  function toggle(row: CompetitorReviewRow, cell: FilledCell, on: boolean) {
    void save(row.sku, cell.site, cell.state === 'paired' ? { sku: row.sku, on, pairId: cell.pairId ?? undefined } : { sku: row.sku, on, itemId: cell.itemId ?? undefined });
  }
  /**
   * A search result picked for a cell. Replacing a wrong proposal/pair first records "not this one" for it;
   * a result without a known size waits in the cell for its size before it is paired.
   */
  async function pick(row: CompetitorReviewRow, site: string, r: CompetitorReviewSearchResult, replacing?: FilledCell) {
    const k = key(row.sku, site);
    if (replacing && (replacing.pairId || replacing.itemId) && replacing.itemId !== r.itemId) {
      await save(row.sku, site, replacing.state === 'paired' ? { sku: row.sku, on: false, pairId: replacing.pairId ?? undefined } : { sku: row.sku, on: false, itemId: replacing.itemId ?? undefined });
    }
    if (r.size) return save(row.sku, site, { sku: row.sku, on: true, itemId: r.itemId });
    setPicked(p => ({ ...p, [k]: { site, state: 'proposed', checked: false, pairId: null, itemId: r.itemId, title: r.title, url: r.url, image: r.image, size: null,
      packLine: r.packLine, equivLine: '', verdict: r.verdict, tone: r.tone, differencePercent: null, confidencePercent: null, moreSizes: 0 } }));
    setSearching(''); setEditing(k);
  }
  async function nextBatch() {
    if (!grid) return;
    if (show === 'done') return void load({ category, show, page: page + 1 });
    setBusy('batch'); setError(''); setStatus('กำลังบันทึกชุดนี้…');
    try {
      const accept = grid.rows.flatMap(row => row.cells.filter((c): c is FilledCell => c.state === 'proposed' && c.checked && !!c.size && !!c.itemId)
        .map(c => ({ sku: row.sku, itemId: c.itemId! })));
      const result = await finishCompetitorReview({ skus: grid.rows.map(r => r.sku), accept });
      setStatus(`บันทึกชุดนี้แล้ว · จับคู่เพิ่ม ${result.saved} คู่`);
      if (result.failed.length) setError(`บันทึกไม่ได้ ${result.failed.length} คู่: ${result.failed[0].message}`);
      onChanged();
      await load({ category, show: 'todo', page: 1 });
    } catch (err) { setError(scrapingError(err)); } finally { setBusy(''); }
  }

  if (!grid) return <div className="p-5">{error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <p role="status" className="text-sm text-gray-500">กำลังโหลด SKU และคู่ที่ระบบเสนอ…</p>}</div>;
  const pct = grid.counts.total ? Math.round(grid.counts.reviewed / grid.counts.total * 100) : 0;
  const batches = Math.max(1, Math.ceil(grid.total / grid.pageSize));
  return <div className="space-y-4 p-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-lg font-semibold">ระบบจับคู่ให้แล้ว — เอาติ๊กออกเฉพาะตัวที่ผิด</h2>
        <p className="text-sm text-gray-600">1 แถว = SKU ของเรา · 1 ช่อง = ตัวที่เหมือนในแต่ละเว็บ · ทุกการติ๊กบันทึกให้อัตโนมัติ ปิดหน้าแล้วกลับมาทำต่อได้</p></div>
      <div className="flex flex-wrap gap-2 text-sm">
        <label className="flex items-center gap-2">หมวด<select className={input} value={category} onChange={e => void load({ category: e.target.value, show, page: 1 })}>
          {grid.categories.map(c => <option key={c.name} value={c.name}>{c.name} ({c.reviewed}/{c.total})</option>)}</select></label>
        <label className="flex items-center gap-2">แสดง<select className={input} value={show} onChange={e => void load({ category, show: e.target.value as 'todo' | 'done', page: 1 })}>
          <option value="todo">ยังไม่ได้ตรวจ</option><option value="done">ตรวจแล้ว</option></select></label></div>
    </div>
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 p-3">
      <div className="min-w-64 flex-1"><div className="flex justify-between text-sm"><span><strong>{grid.category}</strong> · ตรวจแล้ว <strong>{grid.counts.reviewed.toLocaleString('th-TH')}</strong> จาก {grid.counts.total.toLocaleString('th-TH')} SKU</span>
        <span className="text-gray-500">เหลือ {(grid.counts.total - grid.counts.reviewed).toLocaleString('th-TH')}</span></div>
        <div className="mt-1 h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} /></div></div>
      <span role="status" className="flex items-center gap-2 text-sm text-emerald-800"><span className="h-2 w-2 rounded-full bg-emerald-600" />{status}</span>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!grid.rows.length ? <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center"><p className="font-semibold">{show === 'todo' ? `ตรวจหมวด${grid.category}ครบแล้ว` : 'ยังไม่มี SKU ที่ตรวจแล้ว'}</p>
      <p className="mt-1 text-sm text-gray-500">{show === 'todo' ? 'เลือกหมวดอื่นด้านบน หรือดูผลเทียบราคาในขั้นที่ 3' : 'กลับไปที่ “ยังไม่ได้ตรวจ”'}</p></div>
      : !grid.sites.length ? <p className="text-sm text-gray-500">ยังไม่มีเว็บคู่แข่ง — เพิ่มเว็บในขั้นที่ 1 ก่อน</p>
      : <div className="overflow-x-auto rounded-xl border border-gray-200"><table className="w-full min-w-[960px] text-left text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="w-56 p-3 font-medium">SKU ของเรา</th>{grid.sites.map(site => <th key={site} className="p-3 font-medium">{site}</th>)}</tr></thead>
        <tbody>{grid.rows.map(row => <tr key={row.sku} className="border-t border-gray-100 align-top">
          <td className="p-3"><Thumb src={row.image} size="mb-1 h-14 w-14" /><p className="font-semibold">{row.name}</p><p className="text-xs text-gray-500">{row.sku}</p>
            <p className="text-xs text-gray-600">{row.ourPricePerUnit != null ? `฿${row.ourPricePerUnit.toLocaleString('th-TH', { maximumFractionDigits: 2 })}/${row.ourUnitLabel}` : row.offerSummary}</p>
            {row.approx && <span className="mt-1 inline-block rounded-full bg-amber-50 px-2 text-xs font-semibold text-amber-800">Approx · น้ำหนักเป็นช่วง</span>}</td>
          {row.cells.map(original => {
            const k = key(row.sku, original.site);
            const cell = (picked[k] as FilledCell | undefined) ?? original;
            const cellBusy = busy === k || busy === 'batch';
            const search = (replacing?: FilledCell) => <SiteSearch site={cell.site} sku={row.sku} query={row.name.replace(/\s*แช่แข็ง\s*/g, ' ').trim()} busy={cellBusy}
              onClose={() => setSearching('')} onPick={r => void pick(row, cell.site, r, replacing)} />;
            if (cell.state === 'none') return <td key={k} className="p-2">{searching === k
              ? search()
              : <div className="flex flex-col items-start gap-1 rounded-lg border border-dashed border-gray-300 p-2"><span className="text-xs text-gray-500">ระบบหาไม่เจอ</span>
                <button className={button} onClick={() => setSearching(k)}>ค้นหาเองในเว็บนี้</button></div>}</td>;
            const on = cell.state === 'paired' || cell.checked;
            const needsSize = !cell.size;
            return <td key={k} className="p-2">
              <div className={`flex gap-2 rounded-lg border p-2 ${on ? 'border-blue-300 bg-primary-soft' : cell.state === 'proposed' && (cell.confidencePercent ?? 0) < 80 ? 'border-dashed border-amber-300 bg-amber-50/40' : 'border-gray-200 bg-white'}`}>
                <input type="checkbox" aria-label={`${cell.site}: ${cell.title}`} className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={on} disabled={cellBusy || (needsSize && !on)}
                  onChange={e => toggle(row, cell, e.target.checked)} />
                <Thumb src={cell.image} />
                <div className="min-w-0 space-y-0.5">
                  <a className={`block break-words font-medium leading-snug ${on ? 'text-gray-900' : 'text-gray-600'}`} href={cell.url} target="_blank" rel="noopener noreferrer">{cell.title}</a>
                  <p className="text-xs text-gray-600">{cell.packLine}</p>
                  {cell.equivLine && <p className="text-xs text-gray-600">{cell.equivLine}</p>}
                  <span className={`inline-block rounded-full px-2 text-xs font-semibold ${pill[cell.tone]}`}>{cell.verdict}</span>
                  {cell.state === 'proposed' && cell.confidencePercent != null && <p className={`text-xs ${cell.confidencePercent >= 80 ? 'text-gray-500' : 'font-semibold text-amber-800'}`}>
                    {cell.confidencePercent >= 80 ? `ระบบมั่นใจ ${cell.confidencePercent}%` : `ไม่แน่ใจ ${cell.confidencePercent}% — ตรวจก่อนติ๊ก`}</p>}
                  {cell.moreSizes > 0 && <p className="text-xs text-gray-500">ถูกสุดจาก {cell.moreSizes + 1} ขนาด</p>}
                </div></div>
              <div className="mt-1 flex items-center justify-between gap-2 pl-6 text-xs">
                <span className={needsSize ? 'font-semibold text-red-700' : 'text-gray-600'}>ขนาด {cell.size?.text ?? 'ยังไม่ระบุ — ใส่ก่อนติ๊ก'}</span>
                <span className="flex gap-3">
                  <button className="font-semibold text-primary underline" onClick={() => { setEditing(''); setSearching(searching === k ? '' : k); }}>{searching === k ? 'ปิดค้นหา' : 'ไม่ใช่ตัวนี้ — ค้นหาเอง'}</button>
                  <button className="font-semibold text-primary underline" onClick={() => { setSearching(''); setEditing(editing === k ? '' : k); }}>{editing === k ? 'ปิด' : 'แก้ขนาด'}</button></span></div>
              {searching === k && <div className="mt-2">{search(cell)}</div>}
              {editing === k && <SizeEditor initial={cell.size} busy={cellBusy} onCancel={() => setEditing('')}
                onSave={size => void save(row.sku, cell.site, { sku: row.sku, on: true, size, ...(cell.state === 'paired' ? { pairId: cell.pairId ?? undefined } : { itemId: cell.itemId ?? undefined }) })} />}
            </td>;
          })}
        </tr>)}</tbody></table></div>}
    {!!grid.rows.length && <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-gray-600">ชุดที่ {page} จาก {batches} · ช่องที่ไม่ติ๊ก = ไม่ใช่ (ระบบจะไม่เสนอซ้ำ){show === 'todo' ? ' · กดชุดถัดไป = ตัวที่ติ๊กไว้บันทึก และแถวในชุดนี้นับว่าตรวจแล้ว' : ''}</p>
      <button className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50" disabled={!!busy || (show === 'done' && page >= batches)} onClick={() => void nextBatch()}>
        {busy === 'batch' ? 'กำลังบันทึก…' : show === 'done' ? 'ชุดถัดไป →' : grid.total <= grid.pageSize ? `เสร็จหมวด${grid.category} ✓` : `ชุดถัดไป (${grid.pageSize} SKU) →`}</button>
    </div>}
  </div>;
}
