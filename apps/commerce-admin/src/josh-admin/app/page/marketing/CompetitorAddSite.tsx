import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import {
  discoverScrapingWebsite, getScrapingSources, saveScrapingLogin, saveScrapingSource, startScrapingSource,
  type ScrapingDiscovery, type ScrapingLogin,
} from '@josh/shared-api';
import { scrapingError } from './ScrapingSourcesPage';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';
const primary = 'rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50';
const card = 'space-y-3 rounded-xl border border-gray-200 bg-white p-5';

/**
 * Add a competitor site in three steps on one screen: paste a listing link → check what the reader found
 * (and the VAT basis) → start. Uses the same discover/save/start APIs as the detailed settings page.
 */
export function CompetitorAddSite({ onDone }: { onDone: () => void }) {
  const [website, setWebsite] = useState('');
  const [allowed, setAllowed] = useState(false);
  const [login, setLogin] = useState<ScrapingLogin>({ url: '', username: '', password: '' });
  const [needsLogin, setNeedsLogin] = useState(false);
  const [discovery, setDiscovery] = useState<ScrapingDiscovery | null>(null);
  const [vat, setVat] = useState<'included' | 'unsure' | null>(null);
  const [busy, setBusy] = useState<'' | 'reading' | 'starting'>('');
  const [error, setError] = useState('');
  const [started, setStarted] = useState('');
  const loginReady = needsLogin && !!login.url && !!login.username && !!login.password;

  async function read(event: FormEvent) {
    event.preventDefault();
    setBusy('reading'); setError(''); setDiscovery(null); setVat(null); setStarted('');
    try { setDiscovery(await discoverScrapingWebsite(website.trim(), allowed, loginReady ? login : undefined)); }
    catch (err) { setError(scrapingError(err)); } finally { setBusy(''); }
  }
  async function start() {
    if (!discovery?.proposal) return;
    setBusy('starting'); setError('');
    try {
      const existing = (await getScrapingSources()).find(source => source.origin === discovery.proposal!.origin);
      let saved = await saveScrapingSource({ ...discovery.proposal, enabled: true, revision: existing?.revision,
        config: { ...discovery.proposal.config, vatIncluded: vat === 'included' } }, existing?.id);
      if (loginReady) saved = await saveScrapingLogin(saved.id, login);
      await startScrapingSource(saved, true, true);
      setLogin({ url: '', username: '', password: '' }); setDiscovery(null);
      setStarted(saved.config.pagination === 'browser'
        ? `เริ่มเก็บ ${saved.name} แล้ว — กำลังเก็บ 20 หน้าแรกเบื้องหลัง${saved.config.nightOnly ? ' ที่เหลือเก็บคืนนี้ 00:00–06:00' : ''}`
        : `เริ่มเก็บ ${saved.name} แล้ว — ระบบทำงานเบื้องหลัง`);
    } catch (err) { setError(scrapingError(err)); } finally { setBusy(''); }
  }

  const paging = discovery?.paging;
  const hasPrice = !!discovery?.fields.some(field => field.key === 'price');
  return <div className="mx-auto max-w-3xl space-y-4 p-5">
    <div className="flex items-baseline justify-between gap-2"><h2 className="text-xl font-semibold">เพิ่มเว็บคู่แข่ง</h2>
      <Link className="text-sm text-primary underline" to={ADMIN_ROUTES.scrapingSources}>ตั้งค่าแบบละเอียด</Link></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {started && <div role="status" className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <p className="font-semibold">{started}</p><p>ดูจำนวนสินค้าที่ได้ที่หน้าเว็บคู่แข่ง — ปิดหน้านี้ได้</p>
      <button className={primary} onClick={onDone}>ไปหน้าเว็บคู่แข่ง</button></div>}

    <form className={card} onSubmit={e => void read(e)}>
      <label htmlFor="site-url" className="block text-base font-semibold">1. วางลิงก์หน้าที่มีสินค้าหลายตัว</label>
      <p className="text-sm text-gray-600">หน้าค้นหาหรือหน้าหมวดสินค้า เช่น makro.pro/c/search?q=* หรือหน้าหมวดเนื้อหมูของ Lotus's</p>
      <div className="flex flex-wrap gap-2"><input id="site-url" className={`${input} min-w-64 flex-1`} required maxLength={2000} value={website}
        placeholder="https://www.makro.pro/c/search?q=*" onChange={e => setWebsite(e.target.value)} />
        <button className={primary} disabled={!!busy || !allowed || !website.trim()}>{busy === 'reading' ? 'กำลังอ่าน…' : 'ลองอ่านหน้านี้'}</button></div>
      <label className="flex items-start gap-2 text-sm text-gray-700"><input type="checkbox" className="mt-1" checked={allowed} onChange={e => setAllowed(e.target.checked)} />ยืนยันว่าเราได้รับอนุญาตให้เก็บข้อมูลจากเว็บนี้</label>
      <label className="flex items-start gap-2 text-sm text-gray-700"><input type="checkbox" className="mt-1" checked={needsLogin} onChange={e => setNeedsLogin(e.target.checked)} />ต้องล็อกอินถึงเห็นราคา (ใช้บัญชีบริษัท — ราคาที่ได้นับเป็นราคาสมาชิก)</label>
      {needsLogin && <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-sm">หน้าล็อกอิน<input className={input} type="url" value={login.url} onChange={e => setLogin({ ...login, url: e.target.value })} /></label>
        <label className="text-sm">ชื่อผู้ใช้ / อีเมล<input className={input} autoComplete="off" value={login.username} onChange={e => setLogin({ ...login, username: e.target.value })} /></label>
        <label className="text-sm">รหัสผ่าน<input className={input} type="password" autoComplete="new-password" value={login.password} onChange={e => setLogin({ ...login, password: e.target.value })} /></label></div>}
      {busy === 'reading' && <p role="status" className="text-sm text-gray-600">กำลังเปิดเว็บและลองอ่าน 2 หน้า… อาจใช้ 30–60 วินาที</p>}
    </form>

    {discovery && <section aria-label="ผลที่อ่านเจอ" className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-base font-semibold">2. ระบบอ่านเจอแบบนี้ — ถูกไหม?</h3>
        {discovery.ready && <span className={`text-sm font-semibold ${paging?.works ? 'text-emerald-700' : 'text-amber-700'}`}>
          {paging?.works ? `✓ กดหน้าถัดไปได้${paging.totalPages ? ` · ประมาณ ${paging.totalPages.toLocaleString('th-TH')} หน้า` : ''}` : 'อ่านได้เฉพาะหน้านี้ (ไม่พบหน้าถัดไป)'}</span>}</div>
      {!discovery.ready ? <div className="space-y-1 text-sm text-amber-800">
          <p className="font-semibold">ยังอ่านสินค้าจากลิงก์นี้ไม่ได้</p>
          {[...discovery.warnings, ...discovery.scannedPages.map(page => page.error).filter(Boolean)].map((text, i) => <p key={i}>{text}</p>)}
          <p className="text-gray-600">ลองใช้ลิงก์หน้าค้นหาหรือหน้าหมวดสินค้าที่มีหลายตัว หรือใช้ “ตั้งค่าแบบละเอียด”</p></div>
        : <>
          <div className="overflow-x-auto rounded-lg border border-gray-100"><table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="p-2 font-medium">รูป</th><th className="p-2 font-medium">ชื่อสินค้า</th><th className="p-2 text-right font-medium">ราคา</th><th className="p-2 text-right font-medium">น้ำหนัก / ขนาด</th></tr></thead>
            <tbody>{discovery.preview?.items.slice(0, 8).map(item => <tr key={item.url} className="border-t border-gray-100">
              <td className="p-2">{item.fields.image ? <img src={item.fields.image} alt="" loading="lazy" className="h-10 w-10 rounded object-cover" /> : <span className="block h-10 w-10 rounded bg-gray-100" />}</td>
              <td className="p-2">{item.name}</td>
              <td className="p-2 text-right tabular-nums">{item.price != null ? `฿${item.price.toLocaleString('th-TH')}` : item.fields.price || '—'}</td>
              <td className={`p-2 text-right ${item.fields.weight ? '' : 'text-amber-700'}`}>{item.fields.weight || 'ไม่ระบุ'}</td></tr>)}</tbody></table></div>
          <p className="text-xs text-gray-500">น้ำหนักที่ไม่ระบุ ใส่ได้ทีหลังตอนตรวจคู่ (ขั้นที่ 2)</p>
          {discovery.warnings.map((text, i) => <p key={i} className="text-sm text-amber-700">{text}</p>)}
          {hasPrice && <fieldset className="space-y-1 text-sm"><legend className="mb-1 font-semibold">ราคาบนเว็บนี้รวม VAT แล้วหรือยัง?</legend>
            <label className="flex items-center gap-2"><input type="radio" name="vat" checked={vat === 'included'} onChange={() => setVat('included')} />รวม VAT แล้ว (ร้านค้าปลีกส่วนใหญ่) — ใช้เทียบราคาได้</label>
            <label className="flex items-center gap-2"><input type="radio" name="vat" checked={vat === 'unsure'} onChange={() => setVat('unsure')} />ยังไม่รวม VAT หรือไม่แน่ใจ — เก็บไว้ดูอย่างเดียว ยังไม่เอาไปเทียบ</label></fieldset>}
        </>}
    </section>}

    {discovery?.ready && <section className={`${card} flex flex-wrap items-center justify-between gap-4`}>
      <div><h3 className="text-base font-semibold">3. เริ่มเก็บ</h3>
        <p className="text-sm text-gray-600">{paging?.works ? 'เก็บทุกหน้า ทุกคืน 00:00–06:00 · 20 หน้าแรกเก็บให้ทันที' : 'เก็บหน้านี้และลิงก์ที่พบ ทุกวัน'}</p></div>
      <button className={primary} disabled={!!busy || (hasPrice && !vat)} onClick={() => void start()}>{busy === 'starting' ? 'กำลังเริ่ม…' : 'เริ่มเก็บเว็บนี้'}</button>
    </section>}
  </div>;
}
