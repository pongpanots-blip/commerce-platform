import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { enableScrapingPaging, getScrapingSources, runScrapingSourceNow, type ScrapingSource } from '@josh/shared-api';
import { OldModeNotice, scrapingError, scrapingPrimary } from './ScrapingSourcesPage';

/** Step 1 — which sites we collect from, how much we have, and a one-click fix for sites still on the old link crawl. */
export function StepSources({ onNext, onAdd }: { onNext: () => void; onAdd: () => void }) {
  const [sources, setSources] = useState<ScrapingSource[] | null>(null);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => getScrapingSources().then(setSources).catch(err => { setSources([]); setError(scrapingError(err)); }), []);
  useEffect(() => { void load(); }, [load]);
  // While a site is collecting, refresh every 5 s so the item count grows on screen.
  const running = !!sources?.some(source => source.activity === 'reading' || source.activity === 'catching_up' || source.activity === 'queued' || source.activity === 'retrying');
  useEffect(() => { if (!running) return; const timer = setInterval(() => void load(), 5000); return () => clearInterval(timer); }, [running, load]);
  async function act(source: ScrapingSource, work: (s: ScrapingSource) => Promise<unknown>) {
    setBusyId(source.id); setError('');
    try { await work(source); await load(); } catch (err) { setError(scrapingError(err)); } finally { setBusyId(''); }
  }
  /** One word per site: what a merchandiser needs to know about its data. */
  const chip = (s: ScrapingSource) => s.config.pagination !== 'browser' ? { text: 'เก็บไม่ครบ', cls: 'bg-amber-50 text-amber-800', card: 'border-amber-200' }
    : s.activity === 'gave_up' ? { text: 'หลุดกลางคัน', cls: 'bg-red-50 text-red-700', card: 'border-red-200' }
    : s.activity === 'retrying' ? { text: 'กำลังลองใหม่', cls: 'bg-amber-50 text-amber-800', card: 'border-amber-200' }
    : s.lastError && !s.progress.items ? { text: 'อ่านไม่ได้', cls: 'bg-red-50 text-red-700', card: 'border-red-200' }
    : s.activity === 'waiting_for_night' ? { text: 'รอเก็บคืนนี้', cls: 'bg-gray-100 text-gray-700', card: 'border-gray-200' }
    : s.status === 'running' ? { text: 'กำลังเก็บ', cls: 'bg-primary-soft text-primary', card: 'border-gray-200' }
    : { text: s.status === 'completed' ? 'ครบแล้ว' : 'พร้อม', cls: 'bg-emerald-50 text-emerald-800', card: 'border-gray-200' };
  const coverage = (s: ScrapingSource) => s.config.expectedPages ? Math.min(100, Math.round(s.progress.pages / s.config.expectedPages * 100)) : s.status === 'completed' ? 100 : 0;
  return <div className="space-y-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">เว็บที่เราเก็บราคา</h2>
      <button className={scrapingPrimary} onClick={onAdd}>+ เพิ่มเว็บ</button></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {sources == null ? <p role="status" className="text-sm text-gray-500">กำลังโหลดเว็บ…</p>
      : !sources.length ? <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center"><p className="font-medium">เพิ่มเว็บคู่แข่งเว็บแรก</p>
        <p className="mt-1 text-sm text-gray-500">ใส่ลิงก์หน้าค้นหาหรือหมวดสินค้า ระบบจะลองอ่านให้ดูก่อนเริ่มเก็บ</p>
        <button className={`${scrapingPrimary} mt-3`} onClick={onAdd}>เพิ่มเว็บ</button></div>
      : <ul aria-label="เว็บคู่แข่ง" className="grid gap-3 md:grid-cols-2">{sources.map(source => { const c = chip(source); return <li key={source.id} className={`flex flex-col gap-3 rounded-xl border bg-white p-4 ${c.card}`}>
        <div className="flex items-baseline justify-between gap-2"><div><p className="text-base font-semibold">{source.name}</p><p className="text-xs text-gray-500">{source.origin.replace(/^https:\/\/(www\.)?/, '')} · {source.login ? 'ราคาสมาชิก' : 'ราคาสาธารณะ'}</p></div>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.cls}`}>{c.text}</span></div>
        <div><div className="flex justify-between text-sm"><span><strong className="text-lg tabular-nums">{source.progress.items.toLocaleString('th-TH')}</strong> สินค้า</span>
          <span className="text-gray-500">{source.config.expectedPages ? `หน้า ${source.progress.pages.toLocaleString('th-TH')} จาก ~${source.config.expectedPages.toLocaleString('th-TH')}` : `อ่านแล้ว ${source.progress.pages.toLocaleString('th-TH')} หน้า`}</span></div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100"><div className={`h-2 ${c.text === 'เก็บไม่ครบ' ? 'bg-amber-500' : c.text === 'ครบแล้ว' ? 'bg-emerald-600' : 'bg-primary'}`} style={{ width: `${Math.max(2, coverage(source))}%` }} /></div></div>
        {source.config.pagination === 'browser' && (source.activity === 'waiting_for_night' || source.activity === 'gave_up'
          ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 p-3">
            <p role="status" className="text-sm text-gray-700">{source.activity === 'gave_up'
              ? <>ได้แล้ว <strong className="tabular-nums">{source.progress.items.toLocaleString('th-TH')}</strong> สินค้า · หยุดที่หน้า {source.progress.pages.toLocaleString('th-TH')} — กดเก็บต่อจากหน้านี้ได้</>
              : <>เก็บตัวอย่างแล้ว <strong className="tabular-nums">{source.progress.items.toLocaleString('th-TH')}</strong> สินค้า · ที่เหลือจะเก็บต่อเองคืนนี้ 00:00–06:00 (ไม่ได้ค้าง) — ใช้สินค้าที่ได้จับคู่ได้เลย</>}</p>
            <button className={scrapingPrimary} disabled={busyId === source.id} title="เก็บที่เหลือตอนนี้เลย เว็บใหญ่ใช้เวลาหลายชั่วโมงและเปิดเว็บคู่แข่งระหว่างวัน"
              onClick={() => void act(source, runScrapingSourceNow)}>{busyId === source.id ? 'กำลังเริ่ม…' : 'เก็บต่อเลยตอนนี้'}</button></div>
          : source.activity === 'catching_up'
          ? <p role="status" className="text-sm text-primary">กำลังเปิดย้อนไปหน้าที่ค้าง · หน้า {source.progress.catchUp?.toLocaleString('th-TH')} จาก {source.progress.pages.toLocaleString('th-TH')} — เว็บนี้ต้องกดทีละหน้า ไม่ได้ค้าง เลยหน้า {source.progress.pages.toLocaleString('th-TH')} แล้วจำนวนจะขึ้นต่อ</p>
          : source.status === 'running'
          ? <p role="status" className="text-sm text-primary">กำลังเก็บเบื้องหลัง · ได้แล้ว <strong className="tabular-nums">{source.progress.items.toLocaleString('th-TH')}</strong> สินค้า — ปิดหน้านี้ได้{source.config.nightOnly ? ' · ส่วนที่เหลือเก็บต่อคืนนี้ 00:00–06:00' : ''}</p>
          : <p className="text-sm text-gray-600">{source.config.nightOnly ? 'เก็บทุกคืน 00:00–06:00' : 'เก็บอัตโนมัติ'}</p>)}
        {source.lastError && <p className="text-sm text-amber-700">{source.lastError}</p>}
        <OldModeNotice source={source} busy={busyId === source.id} onUpgrade={() => void act(source, enableScrapingPaging)} />
        <div className="flex flex-wrap gap-3 text-sm"><Link className="text-primary underline" to={`${ADMIN_ROUTES.scrapedCatalog}?sourceId=${source.id}`}>ดูสินค้าที่เก็บ</Link>
          <Link className="text-primary underline" to={ADMIN_ROUTES.scrapingSources}>ตั้งค่า</Link></div>
      </li>; })}</ul>}
    <div className="flex justify-end"><button className={scrapingPrimary} onClick={onNext}>ถัดไป: ตรวจคู่ SKU →</button></div>
  </div>;
}
