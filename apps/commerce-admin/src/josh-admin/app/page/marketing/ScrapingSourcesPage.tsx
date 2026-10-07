import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { getScrapingSources, previewScrapingSource, saveScrapingSource, startScrapingSource, stopScrapingSource, enableScrapingPaging, runScrapingSourceNow, discoverScrapingWebsite, saveScrapingLogin, clearScrapingLogin, getScrapingAutomation, setScrapingAutomation,
  type ScrapingLogin, type ScrapingAutomation,
  type ScrapingConfig, type ScrapingSource, type ScrapingSourceInput, type ScrapingPreview, type ScrapingDiscovery } from '@josh/shared-api';

export const scrapingInput = 'mt-1 w-full rounded-lg border border-gray-300 bg-white p-2 text-sm focus:ring-2 focus:ring-primary';
export const scrapingButton = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50';
export const scrapingPrimary = 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50';
export const scrapingError = (error: unknown) => {
  const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(message) ? message.join(', ') : message || (error instanceof Error ? error.message : 'ทำรายการไม่สำเร็จ กรุณาลองใหม่');
};
export function ScrapingNavigation() {
  return <nav aria-label="ข้อมูลคู่แข่ง" className="flex flex-wrap gap-2 text-sm">
    <Link className={scrapingButton} to={ADMIN_ROUTES.scrapedCatalog}>ข้อมูลจากเว็บ</Link>
    <Link className={scrapingButton} to={ADMIN_ROUTES.competitorPrices}>เทียบราคาคู่แข่ง</Link>
    <Link className={scrapingButton} to={ADMIN_ROUTES.scrapingSources}>ตั้งค่าเว็บ</Link>
  </nav>;
}
/**
 * Sources made before paging existed only follow the links they see (Makro: 40 items), so they look "stopped".
 * One button checks page 2 and switches them to the nightly whole-listing run.
 */
export function OldModeNotice({ source, busy, onUpgrade }: { source: ScrapingSource; busy: boolean; onUpgrade: () => void }) {
  if (source.config.pagination === 'browser') return null;
  return <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
    <p>เว็บนี้ยังเก็บแบบเก่า: อ่านเฉพาะลิงก์ที่เห็น ไม่ได้กดไปหน้าถัดไป จึงได้สินค้าไม่ครบ · กดแล้วเริ่มเก็บเบื้องหลังทันที (20 หน้าแรกตอนนี้ ที่เหลือคืนนี้)</p>
    <button className={scrapingPrimary} disabled={busy || !source.config.collectionAllowed} onClick={onUpgrade}>{busy ? 'กำลังเริ่ม…' : 'เก็บทุกหน้า'}</button>
  </div>;
}
const defaults: ScrapingSourceInput = { name: '', origin: '', enabled: false, config: { startUrls: [], pathPrefixes: ['/'],
  mode: 'html', itemSelector: '', fields: [], currency: 'THB', vatIncluded: false, priceContext: 'ข้อมูลสาธารณะ ไม่ใช้บัญชีสมาชิก',
  collectionAllowed: false, intervalHours: 24, maxPages: 100, delayMs: 2000 } };
const statuses: Record<ScrapingSource['status'], string> = { idle: 'ยังไม่ได้เก็บ', running: 'กำลังเก็บ', paused: 'พักการเก็บ', completed: 'เก็บครบลิงก์ที่พบในขอบเขต', limited: 'เก็บบางส่วน / ถึงเพดาน' };

export default function ScrapingSourcesPage() {
  const [sources, setSources] = useState<ScrapingSource[]>([]);
  const [form, setForm] = useState<ScrapingSourceInput | null>(null);
  const [editId, setEditId] = useState<string>();
  const [seeds, setSeeds] = useState('');
  const [paths, setPaths] = useState('/');
  const [sample, setSample] = useState('');
  const [preview, setPreview] = useState<ScrapingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [website, setWebsite] = useState('');
  const [allowed, setAllowed] = useState(false);
  const [discovery, setDiscovery] = useState<ScrapingDiscovery | null>(null);
  const [started, setStarted] = useState('');
  const [vatChoice, setVatChoice] = useState<'included' | 'unsure' | null>(null);
  // Our own member account for sites that need login; the password is sent once and never shown again.
  const [login, setLogin] = useState<ScrapingLogin>({ url: '', username: '', password: '' });
  const [loginEdit, setLoginEdit] = useState<{ sourceId: string; value: ScrapingLogin } | null>(null);
  const loginReady = !!(login.url.trim() && login.username.trim() && login.password);
  const [automation, setAutomation] = useState<ScrapingAutomation | null>(null);
  const load = useCallback(async () => {
    try { const [list, switchState] = await Promise.all([getScrapingSources(), getScrapingAutomation()]); setSources(list); setAutomation(switchState); } catch (err) { setError(scrapingError(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const running = sources.some(source => source.activity === 'reading' || source.activity === 'catching_up' || source.activity === 'queued' || source.activity === 'retrying');
  useEffect(() => { if (running) { const timer = setInterval(() => void load(), 5000); return () => clearInterval(timer); } }, [running, load]);

  function edit(source?: ScrapingSource) {
    setDiscovery(null);
    setEditId(source?.id); setForm(source ? structuredClone(source) : structuredClone(defaults));
    setSeeds(source?.config.startUrls.join('\n') || ''); setPaths(source?.config.pathPrefixes.join('\n') || '/');
    setSample(source?.config.startUrls[0] || ''); setPreview(null); setError('');
  }
  async function discover() {
    setForm(null); setEditId(undefined); setDiscovery(null); setPreview(null); setStarted(''); setVatChoice(null);
    await action(async () => {
      const result = await discoverScrapingWebsite(website, allowed, loginReady ? login : undefined);
      setDiscovery(result);
      if (result.proposal) {
        const existing = sources.find(source => source.origin === result.proposal!.origin);
        setEditId(existing?.id);
        // Daily automatic collection by default; the person can untick it in step 2.
        setForm({ ...result.proposal, enabled: true, ...(existing ? { revision: existing.revision } : {}) });
        setSeeds(result.proposal.config.startUrls.join('\n')); setPaths(result.proposal.config.pathPrefixes.join('\n'));
        setSample(result.preview?.url || ''); setPreview(result.preview);
      }
    });
  }
  function selectField(key: string, checked: boolean) {
    if (!form) return;
    const selected = new Set(form.config.selectedFields || []);
    if (checked) selected.add(key); else selected.delete(key);
    config({ selectedFields: [...selected] });
  }
  function saveAndStart() {
    void action(async () => {
      let saved = await saveScrapingSource(input(), editId);
      setEditId(saved.id); setForm({ ...saved });
      if (loginReady) saved = await saveScrapingLogin(saved.id, login);
      await startScrapingSource(saved, true);
      setLogin({ url: '', username: '', password: '' });
      setForm(null); setDiscovery(null);
      setStarted(saved.config.nightOnly ? `ตั้งค่า ${saved.name} แล้ว — จะเก็บช่วง 00:00–06:00 เบื้องหลัง ดูความคืบหน้าด้านล่าง` : `เริ่มเก็บ ${saved.name} แล้ว — ระบบทำงานเบื้องหลัง ดูความคืบหน้าด้านล่าง`);
    });
  }
  function config(change: Partial<ScrapingConfig>) {
    if (form) {
      if (change.fields) setDiscovery(null);
      setForm({ ...form, config: { ...form.config, ...change, ...(change.fields ? { selectedFields: undefined } : {}) } }); setPreview(null);
    }
  }
  function input(): ScrapingSourceInput {
    return { ...form!, config: { ...form!.config,
      startUrls: seeds.split('\n').map(s => s.trim()).filter(Boolean), pathPrefixes: paths.split('\n').map(s => s.trim()).filter(Boolean) } };
  }
  async function action(work: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await work(); } catch (err) { setError(scrapingError(err)); }
    finally { await load(); setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void action(async () => { await saveScrapingSource(input(), editId); setForm(null); });
  }

  const picked = (key: string) => !!discovery?.fields.find(field => field.key === key)?.required || !!form?.config.selectedFields?.includes(key);
  const columns = discovery?.fields.filter(field => field.key !== 'url' && picked(field.key)) || [];

  return <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
    <ScrapingNavigation />
    <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-semibold">ตั้งค่าเก็บข้อมูลจากเว็บ</h1>
      <p className="mt-1 text-sm text-gray-500">กำหนดหน้าที่เก็บและฟิลด์เองได้ ทั้งสินค้า ราคา รายละเอียด และข้อมูลอื่น</p></div>
      <button className={scrapingButton} disabled={busy} onClick={() => edit()}>+ ตั้งค่าเองแบบละเอียด</button></header>
    {automation && <section aria-label="สวิตช์เก็บข้อมูลเบื้องหลัง" className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${automation.enabled ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
      <div><p className="font-medium">การเก็บข้อมูลเบื้องหลัง (ช่วงทดลอง): {automation.enabled ? 'เปิดอยู่' : 'ปิดอยู่'}</p>
        <p className="text-xs text-gray-600">{automation.enabled ? 'เว็บที่ตั้งเก็บอัตโนมัติจะทำงานตามรอบ · ปิดแล้วทุกเว็บหยุดหลังหน้าที่กำลังอ่าน ความคืบหน้ายังอยู่' : 'ไม่มีการเก็บเบื้องหลังเลย · “ลองดึงข้อมูล” ยังใช้ได้ · เปิดแล้วเก็บต่อจากที่ค้างไว้'}</p></div>
      <button className={automation.enabled ? scrapingButton : scrapingPrimary} disabled={busy} onClick={() => {
        if (!automation.enabled || window.confirm('ปิดการเก็บข้อมูลเบื้องหลังทุกเว็บ?')) void action(async () => setAutomation(await setScrapingAutomation(!automation.enabled)));
      }}>{automation.enabled ? 'ปิดการเก็บเบื้องหลัง' : 'เปิดการเก็บเบื้องหลัง'}</button>
    </section>}
    {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <section aria-label="สำรวจเว็บอัตโนมัติ" className="space-y-4 rounded-xl border border-primary-border bg-white p-5">
      <div><h2 className="text-lg font-semibold">1. ใส่ลิงก์เว็บ แล้วลองดึงข้อมูล 1 รอบ</h2><p className="mt-1 text-sm text-gray-500">ระบบเปิดดูไม่เกิน 6 หน้า แล้วบอกว่าเว็บนี้มีข้อมูลอะไร เช่น ชื่อสินค้า ราคา — ยังไม่เริ่มเก็บจริงจนกว่าจะกดยืนยัน</p></div>
      <label className="block text-sm">ลิงก์เว็บ (หรือชื่อ Makro PRO, Big C, Freshket)<input className={scrapingInput} maxLength={2000} disabled={busy} value={website} placeholder="เช่น https://example.com/products" onChange={e => { setWebsite(e.target.value); setDiscovery(null); setForm(null); setStarted(''); }} onKeyDown={e => { if (e.key === 'Enter' && !busy && allowed && website.trim()) void discover(); }} /></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" disabled={busy} checked={allowed} onChange={e => setAllowed(e.target.checked)} />เป็นข้อมูลสาธารณะ และเรามีสิทธิ์อ่าน/เก็บข้อมูลจากเว็บนี้</label>
      <details className="text-sm"><summary className="cursor-pointer text-gray-600">เว็บนี้ต้องล็อกอิน? ใช้บัญชีสมาชิกของบริษัท (ไม่บังคับ)</summary>
        <div className="mt-2 grid gap-3 md:grid-cols-3">
          <label>หน้าล็อกอิน<input className={scrapingInput} type="url" value={login.url} placeholder="https://…/login" onChange={e => setLogin({ ...login, url: e.target.value })} /></label>
          <label>ชื่อผู้ใช้ / อีเมล<input className={scrapingInput} autoComplete="off" value={login.username} onChange={e => setLogin({ ...login, username: e.target.value })} /></label>
          <label>รหัสผ่าน<input className={scrapingInput} type="password" autoComplete="new-password" value={login.password} onChange={e => setLogin({ ...login, password: e.target.value })} /></label>
        </div>
        <p className="mt-1 text-xs text-gray-500">ใช้เฉพาะบัญชีของบริษัทเราเอง · รหัสผ่านเก็บแบบเข้ารหัสและจะไม่แสดงอีก · ราคาที่เห็นหลังล็อกอินนับเป็น “ราคาสมาชิก” แยกจากราคาปกติ · เว็บที่มี CAPTCHA/OTP ล็อกอินอัตโนมัติไม่ได้</p>
      </details>
      <div className="flex flex-wrap items-center gap-3"><button className={scrapingPrimary} disabled={busy || !allowed || !website.trim()} onClick={() => void discover()}>{busy ? 'กำลังดึงข้อมูล… (อาจใช้ถึง 2 นาที)' : 'ลองดึงข้อมูล'}</button>
        {!busy && website.trim() && !allowed && <span className="text-xs text-amber-700">ติ๊กยืนยันสิทธิ์ก่อน</span>}</div>
      {started && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{started}</p>}
      {discovery && <div className="space-y-3 text-sm">{discovery.warnings.map((warning, index) => <p key={index} className="text-amber-700">{warning}</p>)}
        <details><summary className="cursor-pointer text-gray-600">ตรวจแล้ว {discovery.scannedPages.length} หน้า · ดูแหล่งที่มา</summary><ul className="mt-2 space-y-2">{discovery.scannedPages.map((page, index) => <li key={index} className="break-all"><a className="text-primary underline" href={page.url} target="_blank" rel="noopener noreferrer">{page.title || page.url}</a> · {page.error || `พบ ${page.found} รายการ`}</li>)}</ul></details>
      </div>}
    </section>
    {form && <form aria-label="ตั้งค่าเว็บ" className="space-y-5 rounded-xl border border-primary-border bg-white p-5" onSubmit={submit}>
      <fieldset disabled={busy} className="space-y-5">
      {discovery?.ready && <section aria-label="เลือกข้อมูลที่ต้องการเก็บ" className="space-y-4">
        <h2 className="text-lg font-semibold">2. ตรวจผลดึง ถ้าถูกต้องกดเริ่มเก็บ</h2>
        <fieldset className="space-y-2"><legend className="text-sm font-medium">เลือกข้อมูลที่จะเก็บ</legend>
          <div className="flex flex-wrap gap-2">{discovery.fields.map(field => <label key={field.key} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm">
            <input type="checkbox" checked={picked(field.key)} disabled={field.required} onChange={e => selectField(field.key, e.target.checked)} />{field.label}</label>)}
            {!discovery.fields.some(field => field.key === 'price') && <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-800">✗ ไม่พบราคา</span>}</div></fieldset>
        {!!discovery.preview?.items.length && <div className="overflow-x-auto rounded-lg border border-gray-200">
          <p className="bg-gray-50 px-3 py-2 text-xs text-gray-500">ตัวอย่าง {Math.min(discovery.preview.items.length, 5)} จาก {discovery.preview.found} รายการในหน้าแรก <a className="text-primary underline" href={discovery.preview.url} target="_blank" rel="noopener noreferrer">{discovery.preview.url}</a></p>
          <table className="w-full text-left text-sm"><thead className="text-xs text-gray-500"><tr>{columns.map(field => <th key={field.key} className="px-3 py-2 font-medium">{field.label}</th>)}</tr></thead>
            <tbody>{discovery.preview.items.slice(0, 5).map((item, index) => <tr key={index} className="border-t border-gray-100 align-top">{columns.map(field => <td key={field.key} className="max-w-xs break-words px-3 py-2">
              {field.key === 'name' || field.key === 'title' ? <a className="text-primary underline" href={item.url} target="_blank" rel="noopener noreferrer">{item.name}</a>
                : field.key === 'image' && item.fields.image ? <img src={item.fields.image} alt={item.name} loading="lazy" className="h-12 w-12 rounded object-cover" />
                : field.key === 'price' && item.price != null ? `${item.price.toLocaleString()} ${item.currency}` : (item.fields[field.key] || '—').slice(0, 120)}</td>)}</tr>)}</tbody></table></div>}
        <section aria-label="จำนวนหน้า" className="space-y-2 rounded-lg bg-gray-50 p-3 text-sm">
          {discovery.paging?.works
            ? <p>✓ เลื่อนหน้าเองได้ — {discovery.paging.pages.map(page => `หน้า ${page.page} พบ ${page.found} รายการ${page.page > 1 ? ` (ใหม่ ${page.fresh})` : ''}`).join(' · ')}{discovery.paging.totalPages ? ` · เว็บแจ้งทั้งหมด ${discovery.paging.totalPages.toLocaleString()} หน้า` : ''}</p>
            : <p className="text-amber-700">เก็บได้เฉพาะหน้านี้และลิงก์ที่พบ — ไม่พบปุ่มหรือลิงก์ไปหน้าถัดไป</p>}
          <label className="flex flex-wrap items-center gap-2">เก็บสูงสุด<input aria-label="จำนวนหน้าสูงสุด" className={`${scrapingInput} mt-0 w-24`} type="number" min={1} max={5000} value={form.config.maxPages} onChange={e => config({ maxPages: Math.max(1, Math.min(5000, Number(e.target.value) || 1)) })} />หน้า
            {discovery.paging?.works && <span className="text-gray-500">≈ {(form.config.maxPages * (discovery.paging.pages[0]?.found || 0)).toLocaleString()} รายการ · ใช้เวลาประมาณ {Math.ceil(form.config.maxPages * (form.config.delayMs / 1000 + 4) / 60)} นาที</span>}</label>
        </section>
        {discovery.fields.some(field => field.key === 'price') && <fieldset className="space-y-1 text-sm"><legend className="font-medium">ราคาที่เห็นบนเว็บนี้ (ต้องเลือก)</legend>
          <label className="flex gap-2"><input type="radio" name="vat-basis" checked={vatChoice === 'included'} onChange={() => { setVatChoice('included'); config({ vatIncluded: true }); }} />ราคาที่ลูกค้าจ่ายจริง รวม VAT แล้ว หรือสินค้ายกเว้น VAT — ใช้เทียบราคาได้</label>
          <label className="flex gap-2"><input type="radio" name="vat-basis" checked={vatChoice === 'unsure'} onChange={() => { setVatChoice('unsure'); config({ vatIncluded: false }); }} />ไม่รวม VAT หรือไม่แน่ใจ — เก็บไว้ดูอย่างเดียว ยังไม่เอาไปเทียบ</label></fieldset>}
        <fieldset className="space-y-1 text-sm"><legend className="font-medium">รอบเก็บ</legend>
          <label className="flex gap-2"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />เก็บซ้ำอัตโนมัติทุกวัน</label>
          <label className="flex gap-2"><input type="checkbox" checked={!!form.config.nightOnly} onChange={e => config({ nightOnly: e.target.checked })} />เก็บเฉพาะกลางคืน 00:00–06:00 (แนะนำสำหรับเว็บใหญ่ · เก็บไม่จบจะพักและเก็บต่อคืนถัดไป)</label>
        </fieldset>
        <div className="flex flex-wrap gap-2"><button type="button" className={scrapingPrimary} disabled={busy || (discovery.fields.some(field => field.key === 'price') && !vatChoice)} onClick={saveAndStart}>ข้อมูลถูกต้อง เริ่มเก็บเบื้องหลัง</button>
          <button type="button" className={scrapingButton} disabled={busy} onClick={() => { setForm(null); setDiscovery(null); }}>ยกเลิก</button></div>
        <p className="text-xs text-gray-500">ระบบเก็บต่อเองทีละหน้าเบื้องหลัง ปิดหน้านี้ได้ ดูความคืบหน้าได้ที่การ์ดด้านล่าง</p>
      </section>}
      <details open={!discovery?.ready} className="space-y-5"><summary className="cursor-pointer text-sm font-medium text-gray-600">ตั้งค่าเพิ่มเติม / แก้ฟิลด์ที่ระบบตรวจพบ</summary>
      <h2 className="text-lg font-semibold">{editId ? 'แก้ไขเว็บ' : 'เพิ่มเว็บใหม่'}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm">ชื่อเว็บ<input className={scrapingInput} required maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <label className="text-sm">ที่อยู่เว็บหลัก<input className={scrapingInput} type="url" required disabled={!!editId} value={form.origin} placeholder="https://www.example.com" onChange={e => { setForm({ ...form, origin: e.target.value }); setPreview(null); }} /></label>
        <label className="text-sm">หน้าเริ่มต้น / Sitemap (หนึ่งลิงก์ต่อบรรทัด)<textarea className={scrapingInput} required rows={3} value={seeds} placeholder="https://www.example.com/products/" onChange={e => { setSeeds(e.target.value); setPreview(null); }} /></label>
        <label className="text-sm">ขอบเขต path ที่ตามลิงก์ (หนึ่ง path ต่อบรรทัด)<textarea className={scrapingInput} required rows={3} value={paths} placeholder="/products/" onChange={e => { setPaths(e.target.value); setPreview(null); }} /><span className="text-xs text-gray-500">ใช้ / เพื่อรวมทุกหน้าในโดเมน · ลิงก์ภายนอกจะไม่ถูกเก็บ</span></label>
        <label className="text-sm">วิธีเปิดหน้าเว็บ<select className={scrapingInput} value={form.config.mode} onChange={e => config({ mode: e.target.value as ScrapingConfig['mode'] })}><option value="html">HTML — เร็วและใช้ทรัพยากรน้อย</option><option value="browser">เบราว์เซอร์ — เว็บที่โหลดด้วย JavaScript</option></select></label>
        <label className="text-sm">ตัวเลือกแต่ละรายการ (CSS selector)<input className={scrapingInput} value={form.config.itemSelector} placeholder="เช่น .product-card · เว้นว่างเมื่อหนึ่งรายการต่อหน้า" onChange={e => config({ itemSelector: e.target.value })} /></label>
      </div>
      <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">ฟิลด์ที่ต้องการเก็บ</h3>
        <button type="button" className={scrapingButton} disabled={form.config.fields.length >= 20} onClick={() => config({ fields: [...form.config.fields, { key: form.config.fields.length ? '' : 'name', label: '', selector: '' }] })}>+ เพิ่มฟิลด์</button></div>
        <p className="text-xs text-gray-500">เว้นว่างเพื่ออ่าน Product JSON-LD อัตโนมัติ · เมื่อตั้งเองต้องมี name หรือ title · หน้าหลายรายการต้องมี url</p>
        <datalist id="scraping-field-keys">{['name', 'title', 'url', 'price', 'regularPrice', 'priceType', 'sku', 'weight', 'image', 'description', 'availability', 'currency', 'category'].map(key => <option key={key} value={key} />)}</datalist>
        {form.config.fields.map((field, index) => <div key={index} className="grid gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-[1fr_1fr_2fr_1fr_auto]">
          <label className="text-xs">ชื่อฟิลด์<input aria-label={`ชื่อฟิลด์ ${index + 1}`} className={scrapingInput} required pattern="[a-z][a-zA-Z0-9_]{0,39}" list="scraping-field-keys" value={field.key} placeholder="price หรือชื่อใหม่" onChange={e => config({ fields: form.config.fields.map((f, i) => i === index ? { ...f, key: e.target.value } : f) })} /></label>
          <label className="text-xs">ป้ายกำกับ<input className={scrapingInput} required value={field.label} placeholder="ราคา" onChange={e => config({ fields: form.config.fields.map((f, i) => i === index ? { ...f, label: e.target.value } : f) })} /></label>
          <label className="text-xs">CSS selector<input aria-label={`Selector ${index + 1}`} className={scrapingInput} required value={field.selector} placeholder=".price หรือ :scope" onChange={e => config({ fields: form.config.fields.map((f, i) => i === index ? { ...f, selector: e.target.value } : f) })} /></label>
          <label className="text-xs">Attribute (ถ้ามี)<input className={scrapingInput} value={field.attribute || ''} placeholder="href / src / content" onChange={e => config({ fields: form.config.fields.map((f, i) => i === index ? { ...f, attribute: e.target.value || undefined } : f) })} /></label>
          <button type="button" aria-label={`ลบฟิลด์ ${index + 1}`} className={`${scrapingButton} self-end`} onClick={() => config({ fields: form.config.fields.filter((_, i) => i !== index) })}>ลบ</button>
        </div>)}
      </section>
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <label className="text-sm">สกุลเงิน<input className={scrapingInput} required pattern="[A-Z]{3}" maxLength={3} value={form.config.currency} onChange={e => config({ currency: e.target.value.toUpperCase() })} /></label>
        <label className="text-sm">เก็บซ้ำทุก (ชั่วโมง)<input className={scrapingInput} type="number" required min={1} max={168} value={form.config.intervalHours} onChange={e => config({ intervalHours: Number(e.target.value) })} /></label>
        <label className="text-sm">เพดานหน้าต่อรอบ<input className={scrapingInput} type="number" required min={1} max={5000} value={form.config.maxPages} onChange={e => config({ maxPages: Number(e.target.value) })} /></label>
        <label className="text-sm">พักระหว่างหน้า (วินาที)<input className={scrapingInput} type="number" required min={1} max={10} step={1} value={form.config.delayMs / 1000} onChange={e => config({ delayMs: Number(e.target.value) * 1000 })} /></label>
      </div>
      <label className="block text-sm">เงื่อนไขข้อมูล / สาขา / ฐานราคา<textarea className={scrapingInput} required maxLength={1000} value={form.config.priceContext} onChange={e => config({ priceContext: e.target.value })} /></label>
      <div className="space-y-2 text-sm">
        <label className="flex gap-2"><input type="checkbox" checked={form.config.vatIncluded} onChange={e => config({ vatIncluded: e.target.checked })} />ราคาสาธารณะที่เลือกเก็บรวม VAT หรือยกเว้น VAT</label>
        <label className="flex gap-2"><input type="checkbox" checked={form.config.collectionAllowed} onChange={e => { config({ collectionAllowed: e.target.checked }); if (!e.target.checked) setForm({ ...form, enabled: false, config: { ...form.config, collectionAllowed: false } }); }} />มีสิทธิ์หรือได้รับอนุญาตให้เก็บข้อมูลจากเว็บนี้</label>
        <label className="flex gap-2"><input type="checkbox" disabled={!form.config.collectionAllowed} checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />เปิดเก็บอัตโนมัติตามเวลาที่ตั้ง</label>
      </div>
      <section className="space-y-3 rounded-lg border border-gray-200 p-4"><h3 className="font-semibold">ลองดึงก่อนบันทึก</h3>
        <label className="block text-sm">ลิงก์ทดลอง<input className={scrapingInput} type="url" value={sample} placeholder="หน้าสินค้าหรือหน้ารายการ" onChange={e => { setSample(e.target.value); setPreview(null); }} /></label>
        <button type="button" className={scrapingButton} disabled={busy || !sample || !form.config.collectionAllowed} onClick={() => void action(async () => setPreview(await previewScrapingSource({ ...input(), sampleUrl: sample })))}>ทดลองดึง</button>
        {preview && <div aria-label="ผลทดลองดึง" className="space-y-2 text-sm"><p>พบ {preview.found} รายการ · {preview.links} ลิงก์ {preview.sitemap ? '· Sitemap' : ''}</p>
          {preview.message && <p className="text-amber-700">{preview.message}</p>}{preview.items.map((item, index) => <details key={index} open className="rounded-lg bg-gray-50 p-3"><summary className="font-medium">{item.name} · {item.price == null ? 'ราคาไม่ชัดเจน' : `${item.price} ${item.currency}`}</summary>
            <dl className="mt-2 space-y-1">{Object.entries(item.fields).map(([key, value]) => <div key={key} className="grid gap-2 break-words sm:grid-cols-[140px_1fr]"><dt className="text-gray-500">{key}</dt><dd>{value || '—'}</dd></div>)}</dl></details>)}</div>}
      </section>
      <div className="flex gap-2"><button className={scrapingPrimary} disabled={busy}>บันทึกการตั้งค่า</button><button type="button" className={scrapingButton} disabled={busy} onClick={() => setForm(null)}>ยกเลิก</button></div>
      </details>
      </fieldset>
    </form>}
    {loading ? <p role="status">กำลังโหลดเว็บที่ตั้งค่า…</p> : !sources.length ? <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center"><h2 className="font-semibold">เริ่มจากใส่เว็บด้านบน แล้วกดสำรวจ</h2><p className="mt-2 text-sm text-gray-500">เลือกฟิลด์ที่อ่านเจอและเริ่มเก็บได้เลย</p></div> : <div className="grid gap-4 lg:grid-cols-2">{sources.map(source => <section key={source.id} className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex justify-between gap-2"><div><h2 className="font-semibold">{source.name}</h2><p className="break-all text-xs text-gray-500">{source.origin}</p></div><span className="text-xs text-primary">{source.activity === 'waiting_for_night' ? 'รอเก็บคืนนี้ 00:00–06:00' : source.activity === 'catching_up' ? `กำลังเปิดย้อนไปหน้าที่ค้าง · หน้า ${source.progress.catchUp ?? 0} จาก ${source.progress.pages}` : source.activity === 'retrying' ? 'หลุด — กำลังลองใหม่เอง' : source.activity === 'gave_up' ? 'หลุดกลางคัน' : statuses[source.status]}</span></div>
      <div className="grid grid-cols-3 gap-2 rounded-lg bg-gray-50 p-3 text-sm"><p>อ่านแล้ว <strong>{source.progress.pages.toLocaleString()}</strong>{source.config.expectedPages ? ` จาก ~${source.config.expectedPages.toLocaleString()} หน้า` : ''}</p><p>รออ่าน <strong>{source.progress.pending}</strong></p><p>พบ <strong>{source.progress.items}</strong> รายการ</p></div>
      <p className="text-xs text-gray-500">สำเร็จ {source.progress.successful} หน้า · ไม่สำเร็จ {source.progress.failed} หน้า · เพดาน {source.config.maxPages} หน้า · {source.enabled ? (source.config.intervalHours === 24 ? 'อัตโนมัติทุกวัน' : `อัตโนมัติทุก ${source.config.intervalHours} ชม.`) : 'เริ่มเก็บด้วยตนเอง'}{source.config.nightOnly ? ' · เก็บเฉพาะ 00:00–06:00' : ''}</p>
      {source.lastError && <p className="text-sm text-amber-700">{source.lastError}</p>}
      {(source.activity === 'waiting_for_night' || source.activity === 'gave_up') && <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-gray-700">{source.activity === 'gave_up'
        ? `หยุดที่หน้า ${source.progress.pages.toLocaleString('th-TH')} — กดเก็บต่อจากหน้านี้ได้ สินค้าที่ได้แล้วไม่หาย`
        : `ไม่ได้ค้าง — เก็บแล้ว ${source.progress.pages.toLocaleString('th-TH')} หน้า ที่เหลือเก็บต่อเองคืนนี้ 00:00–06:00 · สินค้าที่ได้แล้วใช้จับคู่ได้เลย`}</p>
        <button className={scrapingPrimary} disabled={busy} onClick={() => void action(() => runScrapingSourceNow(source))}>เก็บต่อเลยตอนนี้</button></div>}
      <OldModeNotice source={source} busy={busy} onUpgrade={() => void action(() => enableScrapingPaging(source))} />
      <div className="text-xs text-gray-600">{source.login ? <>🔒 ล็อกอินเป็น {source.login.username} · ราคาที่เก็บนับเป็นราคาสมาชิก</> : 'ไม่ได้ล็อกอิน · ราคาสาธารณะ'}
        {' '}<button className="text-primary underline" disabled={busy} onClick={() => setLoginEdit(loginEdit?.sourceId === source.id ? null : { sourceId: source.id, value: { url: source.login?.url || `${source.origin}/`, username: source.login?.username || '', password: '' } })}>{source.login ? 'แก้ล็อกอิน' : 'ตั้งค่าล็อกอิน'}</button></div>
      {loginEdit?.sourceId === source.id && <form aria-label={`ล็อกอิน ${source.name}`} className="space-y-2 rounded-lg border border-gray-200 p-3 text-sm" onSubmit={e => { e.preventDefault();
        void action(async () => { await saveScrapingLogin(source.id, { ...loginEdit.value, password: loginEdit.value.password || undefined }); setLoginEdit(null); }); }}>
        <label className="block">หน้าล็อกอิน<input className={scrapingInput} type="url" required value={loginEdit.value.url} onChange={e => setLoginEdit({ ...loginEdit, value: { ...loginEdit.value, url: e.target.value } })} /></label>
        <label className="block">ชื่อผู้ใช้ / อีเมล<input className={scrapingInput} required autoComplete="off" value={loginEdit.value.username} onChange={e => setLoginEdit({ ...loginEdit, value: { ...loginEdit.value, username: e.target.value } })} /></label>
        <label className="block">รหัสผ่าน<input className={scrapingInput} type="password" autoComplete="new-password" required={!source.login?.hasPassword} placeholder={source.login?.hasPassword ? 'เว้นว่าง = ใช้รหัสเดิม' : ''} value={loginEdit.value.password} onChange={e => setLoginEdit({ ...loginEdit, value: { ...loginEdit.value, password: e.target.value } })} /></label>
        <p className="text-xs text-gray-500">บันทึกแล้วต้องกด “เริ่มรอบใหม่” เพื่อเก็บด้วยบัญชีนี้</p>
        <div className="flex gap-2"><button className={scrapingPrimary} disabled={busy}>บันทึกล็อกอิน</button>
          {source.login && <button type="button" className={scrapingButton} disabled={busy} onClick={() => { if (window.confirm(`ลบล็อกอินของ ${source.name}?`)) void action(async () => { await clearScrapingLogin(source.id); setLoginEdit(null); }); }}>ลบล็อกอิน</button>}
          <button type="button" className={scrapingButton} onClick={() => setLoginEdit(null)}>ยกเลิก</button></div>
      </form>}
      <div className="flex flex-wrap gap-2"><button className={scrapingButton} disabled={busy} onClick={() => edit(source)}>ตั้งค่า</button>
        {source.status === 'running' ? <button className={scrapingButton} disabled={busy} onClick={() => void action(() => stopScrapingSource(source))}>หยุดเก็บ</button> : <>{source.activity !== 'gave_up' && <button className={scrapingPrimary} disabled={busy || !source.config.collectionAllowed} onClick={() => void action(() => startScrapingSource(source, false))}>{source.progress.pending ? 'เก็บต่อ' : 'เริ่มเก็บ'}</button>}
          {!!source.progress.pages && <button className={scrapingButton} disabled={busy || !source.config.collectionAllowed} onClick={() => void action(() => startScrapingSource(source, true))}>เริ่มรอบใหม่</button>}</>}
        <Link className={scrapingButton} to={`${ADMIN_ROUTES.scrapedCatalog}?sourceId=${source.id}`}>ดูรายการ</Link></div>
    </section>)}</div>}
  </div>;
}
