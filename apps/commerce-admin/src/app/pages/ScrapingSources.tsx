import { CSSProperties, FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { scrapingApi, type ScrapingAutomation, type ScrapingConfig, type ScrapingDiscovery, type ScrapingLogin,
  type ScrapingPreview, type ScrapingSource, type ScrapingSourceInput } from '../../lib/api';

/*
 * Same page as josh web-admin ScrapingSourcesPage.tsx (af81a227): same sections, order, buttons, states and Thai
 * wording, so the two can be compared side by side. josh's Tailwind classes are mapped to commerce-admin's
 * plain CSS (panel / btn / field / hint / err) plus a few inline styles.
 */
export const scrapingError = (error: unknown) => {
  const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(message) ? message.join(', ') : message || (error instanceof Error ? error.message : 'ทำรายการไม่สำเร็จ กรุณาลองใหม่');
};
type Tone = 'amber' | 'green' | 'red' | 'gray';
const tones: Record<Tone, CSSProperties> = {
  amber: { background: '#fbf3d9', color: '#7a5d00', border: '1px solid #f1e2a8' },
  green: { background: '#e6f4ea', color: 'var(--ok)', border: '1px solid #bfe3cb' },
  red: { background: '#fbe4e6', color: 'var(--danger)', border: '1px solid #f3c5ca' },
  gray: { background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--line)' },
};
const box = (tone: Tone, extra: CSSProperties = {}): CSSProperties => ({ ...tones[tone], borderRadius: 8, padding: 12, fontSize: 13, ...extra });
const between: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 };
const inline: CSSProperties = { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 };
const stack = (gap = 12): CSSProperties => ({ display: 'flex', flexDirection: 'column', gap });
const section: CSSProperties = { ...stack(16), padding: 20 };
const amberText: CSSProperties = { color: '#7a5d00' };
const link: CSSProperties = { color: 'var(--accent)', textDecoration: 'underline', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' };

export function ScrapingNavigation() {
  return <nav aria-label="ข้อมูลคู่แข่ง" className="row" style={{ gap: 8, marginBottom: 16 }}>
    <Link className="btn ghost" to="/marketing/scraped-catalog">ข้อมูลจากเว็บ</Link>
    <Link className="btn ghost" to="/marketing/competitor-prices">เทียบราคาคู่แข่ง</Link>
    <Link className="btn ghost" to="/marketing/scraping-sources">ตั้งค่าเว็บ</Link>
  </nav>;
}
/**
 * Sources made before paging existed only follow the links they see (Makro: 40 items), so they look "stopped".
 * One button checks page 2 and switches them to the nightly whole-listing run.
 */
export function OldModeNotice({ source, busy, onUpgrade }: { source: ScrapingSource; busy: boolean; onUpgrade: () => void }) {
  if (source.config.pagination === 'browser') return null;
  return <div style={{ ...box('amber'), ...between }}>
    <p style={{ margin: 0 }}>เว็บนี้ยังเก็บแบบเก่า: อ่านเฉพาะลิงก์ที่เห็น ไม่ได้กดไปหน้าถัดไป จึงได้สินค้าไม่ครบ · กดแล้วเริ่มเก็บเบื้องหลังทันที (20 หน้าแรกตอนนี้ ที่เหลือคืนนี้)</p>
    <button className="btn" type="button" disabled={busy || !source.config.collectionAllowed} onClick={onUpgrade}>{busy ? 'กำลังเริ่ม…' : 'เก็บทุกหน้า'}</button>
  </div>;
}
const defaults: ScrapingSourceInput = { name: '', origin: '', enabled: false, config: { startUrls: [], pathPrefixes: ['/'],
  mode: 'html', itemSelector: '', fields: [], currency: 'THB', vatIncluded: false, priceContext: 'ข้อมูลสาธารณะ ไม่ใช้บัญชีสมาชิก',
  collectionAllowed: false, intervalHours: 24, maxPages: 100, delayMs: 2000 } };
const statuses: Record<ScrapingSource['status'], string> = { idle: 'ยังไม่ได้เก็บ', running: 'กำลังเก็บ', paused: 'พักการเก็บ', completed: 'เก็บครบลิงก์ที่พบในขอบเขต', limited: 'เก็บบางส่วน / ถึงเพดาน' };

export function ScrapingSources() {
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
    try { const [list, switchState] = await Promise.all([scrapingApi.sources(), scrapingApi.automation()]); setSources(list); setAutomation(switchState); } catch (err) { setError(scrapingError(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const running = sources.some(source => source.activity === 'reading' || source.activity === 'queued' || source.activity === 'retrying');
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
      const result = await scrapingApi.discover(website, allowed, loginReady ? login : undefined);
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
      let saved = await scrapingApi.save(input(), editId);
      setEditId(saved.id); setForm({ ...saved });
      if (loginReady) saved = await scrapingApi.saveLogin(saved.id, login);
      await scrapingApi.start(saved, true);
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
    void action(async () => { await scrapingApi.save(input(), editId); setForm(null); });
  }

  const picked = (key: string) => !!discovery?.fields.find(field => field.key === key)?.required || !!form?.config.selectedFields?.includes(key);
  const columns = discovery?.fields.filter(field => field.key !== 'url' && picked(field.key)) || [];

  return <div style={{ ...stack(20), maxWidth: 1280 }}>
    <div>
      <ScrapingNavigation />
      <header className="page-head" style={{ flexWrap: 'wrap', gap: 12, marginBottom: 0 }}><div><h1>ตั้งค่าเก็บข้อมูลจากเว็บ</h1>
        <p>กำหนดหน้าที่เก็บและฟิลด์เองได้ ทั้งสินค้า ราคา รายละเอียด และข้อมูลอื่น</p></div>
        <button className="btn ghost" type="button" disabled={busy} onClick={() => edit()}>+ ตั้งค่าเองแบบละเอียด</button></header>
    </div>
    {automation && <section aria-label="สวิตช์เก็บข้อมูลเบื้องหลัง" style={{ ...box(automation.enabled ? 'green' : 'amber', { padding: 16, color: 'var(--fg)' }), ...between, gap: 12 }}>
      <div><p style={{ margin: 0, fontWeight: 600 }}>การเก็บข้อมูลเบื้องหลัง (ช่วงทดลอง): {automation.enabled ? 'เปิดอยู่' : 'ปิดอยู่'}</p>
        <p className="hint" style={{ margin: 0 }}>{automation.enabled ? 'เว็บที่ตั้งเก็บอัตโนมัติจะทำงานตามรอบ · ปิดแล้วทุกเว็บหยุดหลังหน้าที่กำลังอ่าน ความคืบหน้ายังอยู่' : 'ไม่มีการเก็บเบื้องหลังเลย · “ลองดึงข้อมูล” ยังใช้ได้ · เปิดแล้วเก็บต่อจากที่ค้างไว้'}</p></div>
      <button className={automation.enabled ? 'btn ghost' : 'btn'} type="button" disabled={busy} onClick={() => {
        if (!automation.enabled || window.confirm('ปิดการเก็บข้อมูลเบื้องหลังทุกเว็บ?')) void action(async () => setAutomation(await scrapingApi.setAutomation(!automation.enabled)));
      }}>{automation.enabled ? 'ปิดการเก็บเบื้องหลัง' : 'เปิดการเก็บเบื้องหลัง'}</button>
    </section>}
    {error && <div role="alert" style={box('red')}>{error}</div>}
    <section aria-label="สำรวจเว็บอัตโนมัติ" className="panel" style={section}>
      <div><h2 style={{ fontSize: 17, margin: 0 }}>1. ใส่ลิงก์เว็บ แล้วลองดึงข้อมูล 1 รอบ</h2><p className="hint" style={{ margin: '4px 0 0', fontSize: 13 }}>ระบบเปิดดูไม่เกิน 6 หน้า แล้วบอกว่าเว็บนี้มีข้อมูลอะไร เช่น ชื่อสินค้า ราคา — ยังไม่เริ่มเก็บจริงจนกว่าจะกดยืนยัน</p></div>
      <label className="field">ลิงก์เว็บ (หรือชื่อ Makro PRO, Big C, Freshket)<input maxLength={2000} disabled={busy} value={website} placeholder="เช่น https://example.com/products" onChange={e => { setWebsite(e.target.value); setDiscovery(null); setForm(null); setStarted(''); }} onKeyDown={e => { if (e.key === 'Enter' && !busy && allowed && website.trim()) void discover(); }} /></label>
      <label style={inline}><input type="checkbox" disabled={busy} checked={allowed} onChange={e => setAllowed(e.target.checked)} />เป็นข้อมูลสาธารณะ และเรามีสิทธิ์อ่าน/เก็บข้อมูลจากเว็บนี้</label>
      <details style={{ fontSize: 13 }}><summary className="hint" style={{ cursor: 'pointer', fontSize: 13 }}>เว็บนี้ต้องล็อกอิน? ใช้บัญชีสมาชิกของบริษัท (ไม่บังคับ)</summary>
        <div className="row" style={{ marginTop: 8, gap: 12 }}>
          <label className="field">หน้าล็อกอิน<input type="url" value={login.url} placeholder="https://…/login" onChange={e => setLogin({ ...login, url: e.target.value })} /></label>
          <label className="field">ชื่อผู้ใช้ / อีเมล<input autoComplete="off" value={login.username} onChange={e => setLogin({ ...login, username: e.target.value })} /></label>
          <label className="field">รหัสผ่าน<input type="password" autoComplete="new-password" value={login.password} onChange={e => setLogin({ ...login, password: e.target.value })} /></label>
        </div>
        <p className="hint" style={{ margin: '4px 0 0' }}>ใช้เฉพาะบัญชีของบริษัทเราเอง · รหัสผ่านเก็บแบบเข้ารหัสและจะไม่แสดงอีก · ราคาที่เห็นหลังล็อกอินนับเป็น “ราคาสมาชิก” แยกจากราคาปกติ · เว็บที่มี CAPTCHA/OTP ล็อกอินอัตโนมัติไม่ได้</p>
      </details>
      <div className="row" style={{ alignItems: 'center', gap: 12 }}><button className="btn" type="button" disabled={busy || !allowed || !website.trim()} onClick={() => void discover()}>{busy ? 'กำลังดึงข้อมูล… (อาจใช้ถึง 2 นาที)' : 'ลองดึงข้อมูล'}</button>
        {!busy && website.trim() && !allowed && <span style={{ ...amberText, fontSize: 12 }}>ติ๊กยืนยันสิทธิ์ก่อน</span>}</div>
      {started && <p role="status" style={box('green', { margin: 0 })}>{started}</p>}
      {discovery && <div style={{ ...stack(), fontSize: 13 }}>{discovery.warnings.map((warning, index) => <p key={index} style={{ ...amberText, margin: 0 }}>{warning}</p>)}
        <details><summary className="hint" style={{ cursor: 'pointer', fontSize: 13 }}>ตรวจแล้ว {discovery.scannedPages.length} หน้า · ดูแหล่งที่มา</summary><ul style={{ ...stack(8), marginTop: 8 }}>{discovery.scannedPages.map((page, index) => <li key={index} style={{ wordBreak: 'break-all' }}><a style={link} href={page.url} target="_blank" rel="noopener noreferrer">{page.title || page.url}</a> · {page.error || `พบ ${page.found} รายการ`}</li>)}</ul></details>
      </div>}
    </section>
    {form && <form aria-label="ตั้งค่าเว็บ" className="panel" style={section} onSubmit={submit}>
      <fieldset disabled={busy} style={{ ...stack(20), border: 'none', margin: 0, padding: 0, minWidth: 0 }}>
      {discovery?.ready && <section aria-label="เลือกข้อมูลที่ต้องการเก็บ" style={stack(16)}>
        <h2 style={{ fontSize: 17, margin: 0 }}>2. ตรวจผลดึง ถ้าถูกต้องกดเริ่มเก็บ</h2>
        <fieldset style={{ ...stack(8), border: 'none', margin: 0, padding: 0 }}><legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>เลือกข้อมูลที่จะเก็บ</legend>
          <div className="checks">{discovery.fields.map(field => <label key={field.key} className={`check${picked(field.key) ? ' on' : ''}`}>
            <input type="checkbox" checked={picked(field.key)} disabled={field.required} onChange={e => selectField(field.key, e.target.checked)} />{field.label}</label>)}
            {!discovery.fields.some(field => field.key === 'price') && <span style={box('amber', { padding: '5px 10px' })}>✗ ไม่พบราคา</span>}</div></fieldset>
        {!!discovery.preview?.items.length && <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
          <p className="hint" style={{ margin: 0, padding: '8px 12px', background: 'var(--bg)' }}>ตัวอย่าง {Math.min(discovery.preview.items.length, 5)} จาก {discovery.preview.found} รายการในหน้าแรก <a style={link} href={discovery.preview.url} target="_blank" rel="noopener noreferrer">{discovery.preview.url}</a></p>
          <table><thead><tr>{columns.map(field => <th key={field.key}>{field.label}</th>)}</tr></thead>
            <tbody>{discovery.preview.items.slice(0, 5).map((item, index) => <tr key={index} style={{ verticalAlign: 'top' }}>{columns.map(field => <td key={field.key} style={{ maxWidth: 320, wordBreak: 'break-word', verticalAlign: 'top' }}>
              {field.key === 'name' || field.key === 'title' ? <a style={link} href={item.url} target="_blank" rel="noopener noreferrer">{item.name}</a>
                : field.key === 'image' && item.fields.image ? <img src={item.fields.image} alt={item.name} loading="lazy" style={{ width: 48, height: 48, borderRadius: 4, objectFit: 'cover' }} />
                : field.key === 'price' && item.price != null ? `${item.price.toLocaleString()} ${item.currency}` : (item.fields[field.key] || '—').slice(0, 120)}</td>)}</tr>)}</tbody></table></div>}
        <section aria-label="จำนวนหน้า" style={{ ...box('gray'), ...stack(8) }}>
          {discovery.paging?.works
            ? <p style={{ margin: 0 }}>✓ เลื่อนหน้าเองได้ — {discovery.paging.pages.map(page => `หน้า ${page.page} พบ ${page.found} รายการ${page.page > 1 ? ` (ใหม่ ${page.fresh})` : ''}`).join(' · ')}{discovery.paging.totalPages ? ` · เว็บแจ้งทั้งหมด ${discovery.paging.totalPages.toLocaleString()} หน้า` : ''}</p>
            : <p style={{ ...amberText, margin: 0 }}>เก็บได้เฉพาะหน้านี้และลิงก์ที่พบ — ไม่พบปุ่มหรือลิงก์ไปหน้าถัดไป</p>}
          <label style={{ ...inline, alignItems: 'center', flexWrap: 'wrap' }}>เก็บสูงสุด<input aria-label="จำนวนหน้าสูงสุด" style={{ width: 96 }} type="number" min={1} max={5000} value={form.config.maxPages} onChange={e => config({ maxPages: Math.max(1, Math.min(5000, Number(e.target.value) || 1)) })} />หน้า
            {discovery.paging?.works && <span className="hint" style={{ fontSize: 13 }}>≈ {(form.config.maxPages * (discovery.paging.pages[0]?.found || 0)).toLocaleString()} รายการ · ใช้เวลาประมาณ {Math.ceil(form.config.maxPages * (form.config.delayMs / 1000 + 4) / 60)} นาที</span>}</label>
        </section>
        {discovery.fields.some(field => field.key === 'price') && <fieldset style={{ ...stack(4), border: 'none', margin: 0, padding: 0, fontSize: 13 }}><legend style={{ fontWeight: 600, marginBottom: 4 }}>ราคาที่เห็นบนเว็บนี้ (ต้องเลือก)</legend>
          <label style={inline}><input type="radio" name="vat-basis" checked={vatChoice === 'included'} onChange={() => { setVatChoice('included'); config({ vatIncluded: true }); }} />ราคาที่ลูกค้าจ่ายจริง รวม VAT แล้ว หรือสินค้ายกเว้น VAT — ใช้เทียบราคาได้</label>
          <label style={inline}><input type="radio" name="vat-basis" checked={vatChoice === 'unsure'} onChange={() => { setVatChoice('unsure'); config({ vatIncluded: false }); }} />ไม่รวม VAT หรือไม่แน่ใจ — เก็บไว้ดูอย่างเดียว ยังไม่เอาไปเทียบ</label></fieldset>}
        <fieldset style={{ ...stack(4), border: 'none', margin: 0, padding: 0, fontSize: 13 }}><legend style={{ fontWeight: 600, marginBottom: 4 }}>รอบเก็บ</legend>
          <label style={inline}><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />เก็บซ้ำอัตโนมัติทุกวัน</label>
          <label style={inline}><input type="checkbox" checked={!!form.config.nightOnly} onChange={e => config({ nightOnly: e.target.checked })} />เก็บเฉพาะกลางคืน 00:00–06:00 (แนะนำสำหรับเว็บใหญ่ · เก็บไม่จบจะพักและเก็บต่อคืนถัดไป)</label>
        </fieldset>
        <div className="row"><button type="button" className="btn" disabled={busy || (discovery.fields.some(field => field.key === 'price') && !vatChoice)} onClick={saveAndStart}>ข้อมูลถูกต้อง เริ่มเก็บเบื้องหลัง</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => { setForm(null); setDiscovery(null); }}>ยกเลิก</button></div>
        <p className="hint" style={{ margin: 0 }}>ระบบเก็บต่อเองทีละหน้าเบื้องหลัง ปิดหน้านี้ได้ ดูความคืบหน้าได้ที่การ์ดด้านล่าง</p>
      </section>}
      <details open={!discovery?.ready}><summary className="hint" style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>ตั้งค่าเพิ่มเติม / แก้ฟิลด์ที่ระบบตรวจพบ</summary>
      <div style={{ ...stack(20), marginTop: 16 }}>
      <h2 style={{ fontSize: 17, margin: 0 }}>{editId ? 'แก้ไขเว็บ' : 'เพิ่มเว็บใหม่'}</h2>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
        <label className="field">ชื่อเว็บ<input required maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <label className="field">ที่อยู่เว็บหลัก<input type="url" required disabled={!!editId} value={form.origin} placeholder="https://www.example.com" onChange={e => { setForm({ ...form, origin: e.target.value }); setPreview(null); }} /></label>
        <label className="field">หน้าเริ่มต้น / Sitemap (หนึ่งลิงก์ต่อบรรทัด)<textarea required rows={3} value={seeds} placeholder="https://www.example.com/products/" onChange={e => { setSeeds(e.target.value); setPreview(null); }} /></label>
        <label className="field">ขอบเขต path ที่ตามลิงก์ (หนึ่ง path ต่อบรรทัด)<textarea required rows={3} value={paths} placeholder="/products/" onChange={e => { setPaths(e.target.value); setPreview(null); }} /><span className="hint" style={{ fontWeight: 400 }}>ใช้ / เพื่อรวมทุกหน้าในโดเมน · ลิงก์ภายนอกจะไม่ถูกเก็บ</span></label>
        <label className="field">วิธีเปิดหน้าเว็บ<select value={form.config.mode} onChange={e => config({ mode: e.target.value as ScrapingConfig['mode'] })}><option value="html">HTML — เร็วและใช้ทรัพยากรน้อย</option><option value="browser">เบราว์เซอร์ — เว็บที่โหลดด้วย JavaScript</option></select></label>
        <label className="field">ตัวเลือกแต่ละรายการ (CSS selector)<input value={form.config.itemSelector} placeholder="เช่น .product-card · เว้นว่างเมื่อหนึ่งรายการต่อหน้า" onChange={e => config({ itemSelector: e.target.value })} /></label>
      </div>
      <section style={stack()}><div style={between}><h3 style={{ margin: 0, fontSize: 15 }}>ฟิลด์ที่ต้องการเก็บ</h3>
        <button type="button" className="btn ghost" disabled={form.config.fields.length >= 20} onClick={() => config({ fields: [...form.config.fields, { key: form.config.fields.length ? '' : 'name', label: '', selector: '' }] })}>+ เพิ่มฟิลด์</button></div>
        <p className="hint" style={{ margin: 0 }}>เว้นว่างเพื่ออ่าน Product JSON-LD อัตโนมัติ · เมื่อตั้งเองต้องมี name หรือ title · หน้าหลายรายการต้องมี url</p>
        <datalist id="scraping-field-keys">{['name', 'title', 'url', 'price', 'regularPrice', 'priceType', 'sku', 'weight', 'image', 'description', 'availability', 'currency', 'category'].map(key => <option key={key} value={key} />)}</datalist>
        {form.config.fields.map((field, index) => <div key={index} style={{ ...box('gray'), display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr)) auto', alignItems: 'end' }}>
          <label className="field">ชื่อฟิลด์<input aria-label={`ชื่อฟิลด์ ${index + 1}`} required pattern="[a-z][a-zA-Z0-9_]{0,39}" list="scraping-field-keys" value={field.key} placeholder="price หรือชื่อใหม่" onChange={e => config({ fields: form.config.fields.map((f, i) => i === index ? { ...f, key: e.target.value } : f) })} /></label>
          <label className="field">ป้ายกำกับ<input required value={field.label} placeholder="ราคา" onChange={e => config({ fields: form.config.fields.map((f, i) => i === index ? { ...f, label: e.target.value } : f) })} /></label>
          <label className="field">CSS selector<input aria-label={`Selector ${index + 1}`} required value={field.selector} placeholder=".price หรือ :scope" onChange={e => config({ fields: form.config.fields.map((f, i) => i === index ? { ...f, selector: e.target.value } : f) })} /></label>
          <label className="field">Attribute (ถ้ามี)<input value={field.attribute || ''} placeholder="href / src / content" onChange={e => config({ fields: form.config.fields.map((f, i) => i === index ? { ...f, attribute: e.target.value || undefined } : f) })} /></label>
          <button type="button" aria-label={`ลบฟิลด์ ${index + 1}`} className="btn ghost" onClick={() => config({ fields: form.config.fields.filter((_, i) => i !== index) })}>ลบ</button>
        </div>)}
      </section>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))' }}>
        <label className="field">สกุลเงิน<input required pattern="[A-Z]{3}" maxLength={3} value={form.config.currency} onChange={e => config({ currency: e.target.value.toUpperCase() })} /></label>
        <label className="field">เก็บซ้ำทุก (ชั่วโมง)<input type="number" required min={1} max={168} value={form.config.intervalHours} onChange={e => config({ intervalHours: Number(e.target.value) })} /></label>
        <label className="field">เพดานหน้าต่อรอบ<input type="number" required min={1} max={5000} value={form.config.maxPages} onChange={e => config({ maxPages: Number(e.target.value) })} /></label>
        <label className="field">พักระหว่างหน้า (วินาที)<input type="number" required min={1} max={10} step={1} value={form.config.delayMs / 1000} onChange={e => config({ delayMs: Number(e.target.value) * 1000 })} /></label>
      </div>
      <label className="field">เงื่อนไขข้อมูล / สาขา / ฐานราคา<textarea required maxLength={1000} value={form.config.priceContext} onChange={e => config({ priceContext: e.target.value })} /></label>
      <div style={stack(8)}>
        <label style={inline}><input type="checkbox" checked={form.config.vatIncluded} onChange={e => config({ vatIncluded: e.target.checked })} />ราคาสาธารณะที่เลือกเก็บรวม VAT หรือยกเว้น VAT</label>
        <label style={inline}><input type="checkbox" checked={form.config.collectionAllowed} onChange={e => { config({ collectionAllowed: e.target.checked }); if (!e.target.checked) setForm({ ...form, enabled: false, config: { ...form.config, collectionAllowed: false } }); }} />มีสิทธิ์หรือได้รับอนุญาตให้เก็บข้อมูลจากเว็บนี้</label>
        <label style={inline}><input type="checkbox" disabled={!form.config.collectionAllowed} checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />เปิดเก็บอัตโนมัติตามเวลาที่ตั้ง</label>
      </div>
      <section style={{ ...stack(), border: '1px solid var(--line)', borderRadius: 8, padding: 16 }}><h3 style={{ margin: 0, fontSize: 15 }}>ลองดึงก่อนบันทึก</h3>
        <label className="field">ลิงก์ทดลอง<input type="url" value={sample} placeholder="หน้าสินค้าหรือหน้ารายการ" onChange={e => { setSample(e.target.value); setPreview(null); }} /></label>
        <div><button type="button" className="btn ghost" disabled={busy || !sample || !form.config.collectionAllowed} onClick={() => void action(async () => setPreview(await scrapingApi.preview({ ...input(), sampleUrl: sample })))}>ทดลองดึง</button></div>
        {preview && <div aria-label="ผลทดลองดึง" style={{ ...stack(8), fontSize: 13 }}><p style={{ margin: 0 }}>พบ {preview.found} รายการ · {preview.links} ลิงก์ {preview.sitemap ? '· Sitemap' : ''}</p>
          {preview.message && <p style={{ ...amberText, margin: 0 }}>{preview.message}</p>}{preview.items.map((item, index) => <details key={index} open style={box('gray')}><summary style={{ fontWeight: 600 }}>{item.name} · {item.price == null ? 'ราคาไม่ชัดเจน' : `${item.price} ${item.currency}`}</summary>
            <dl style={{ ...stack(4), marginTop: 8 }}>{Object.entries(item.fields).map(([key, value]) => <div key={key} style={{ display: 'grid', gap: 8, gridTemplateColumns: '140px 1fr', wordBreak: 'break-word' }}><dt className="hint" style={{ fontSize: 13 }}>{key}</dt><dd style={{ margin: 0 }}>{value || '—'}</dd></div>)}</dl></details>)}</div>}
      </section>
      <div className="row"><button className="btn" disabled={busy}>บันทึกการตั้งค่า</button><button type="button" className="btn ghost" disabled={busy} onClick={() => setForm(null)}>ยกเลิก</button></div>
      </div>
      </details>
      </fieldset>
    </form>}
    {loading ? <p role="status">กำลังโหลดเว็บที่ตั้งค่า…</p> : !sources.length ? <div className="panel" style={{ borderStyle: 'dashed', padding: 32, textAlign: 'center' }}><h2 style={{ fontSize: 15, margin: 0 }}>เริ่มจากใส่เว็บด้านบน แล้วกดสำรวจ</h2><p className="hint" style={{ margin: '8px 0 0', fontSize: 13 }}>เลือกฟิลด์ที่อ่านเจอและเริ่มเก็บได้เลย</p></div> : <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))' }}>{sources.map(source => <section key={source.id} className="panel" style={{ ...stack(), padding: 20, margin: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><div><h2 style={{ fontSize: 15, margin: 0 }}>{source.name}</h2><p className="hint" style={{ margin: 0, wordBreak: 'break-all' }}>{source.origin}</p></div><span style={{ fontSize: 12, color: 'var(--accent)' }}>{source.activity === 'waiting_for_night' ? 'รอเก็บคืนนี้ 00:00–06:00' : source.activity === 'retrying' ? 'หลุด — กำลังลองใหม่เอง' : source.activity === 'gave_up' ? 'หลุดกลางคัน' : statuses[source.status]}</span></div>
      <div style={{ ...box('gray'), display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}><p style={{ margin: 0 }}>อ่านแล้ว <strong>{source.progress.pages.toLocaleString()}</strong>{source.config.expectedPages ? ` จาก ~${source.config.expectedPages.toLocaleString()} หน้า` : ''}</p><p style={{ margin: 0 }}>รออ่าน <strong>{source.progress.pending}</strong></p><p style={{ margin: 0 }}>พบ <strong>{source.progress.items}</strong> รายการ</p></div>
      <p className="hint" style={{ margin: 0 }}>สำเร็จ {source.progress.successful} หน้า · ไม่สำเร็จ {source.progress.failed} หน้า · เพดาน {source.config.maxPages} หน้า · {source.enabled ? (source.config.intervalHours === 24 ? 'อัตโนมัติทุกวัน' : `อัตโนมัติทุก ${source.config.intervalHours} ชม.`) : 'เริ่มเก็บด้วยตนเอง'}{source.config.nightOnly ? ' · เก็บเฉพาะ 00:00–06:00' : ''}</p>
      {source.lastError && <p style={{ ...amberText, margin: 0, fontSize: 13 }}>{source.lastError}</p>}
      {(source.activity === 'waiting_for_night' || source.activity === 'gave_up') && <div style={between}><p style={{ margin: 0, fontSize: 13 }}>{source.activity === 'gave_up'
        ? `หยุดที่หน้า ${source.progress.pages.toLocaleString('th-TH')} — กดเก็บต่อจากหน้านี้ได้ สินค้าที่ได้แล้วไม่หาย`
        : `ไม่ได้ค้าง — เก็บแล้ว ${source.progress.pages.toLocaleString('th-TH')} หน้า ที่เหลือเก็บต่อเองคืนนี้ 00:00–06:00 · สินค้าที่ได้แล้วใช้จับคู่ได้เลย`}</p>
        <button className="btn" type="button" disabled={busy} onClick={() => void action(() => scrapingApi.runNow(source))}>เก็บต่อเลยตอนนี้</button></div>}
      <OldModeNotice source={source} busy={busy} onUpgrade={() => void action(() => scrapingApi.enablePaging(source))} />
      <div className="hint">{source.login ? <>🔒 ล็อกอินเป็น {source.login.username} · ราคาที่เก็บนับเป็นราคาสมาชิก</> : 'ไม่ได้ล็อกอิน · ราคาสาธารณะ'}
        {' '}<button type="button" style={link} disabled={busy} onClick={() => setLoginEdit(loginEdit?.sourceId === source.id ? null : { sourceId: source.id, value: { url: source.login?.url || `${source.origin}/`, username: source.login?.username || '', password: '' } })}>{source.login ? 'แก้ล็อกอิน' : 'ตั้งค่าล็อกอิน'}</button></div>
      {loginEdit?.sourceId === source.id && <form aria-label={`ล็อกอิน ${source.name}`} style={{ ...stack(8), border: '1px solid var(--line)', borderRadius: 8, padding: 12, fontSize: 13 }} onSubmit={e => { e.preventDefault();
        void action(async () => { await scrapingApi.saveLogin(source.id, { ...loginEdit.value, password: loginEdit.value.password || undefined }); setLoginEdit(null); }); }}>
        <label className="field">หน้าล็อกอิน<input type="url" required value={loginEdit.value.url} onChange={e => setLoginEdit({ ...loginEdit, value: { ...loginEdit.value, url: e.target.value } })} /></label>
        <label className="field">ชื่อผู้ใช้ / อีเมล<input required autoComplete="off" value={loginEdit.value.username} onChange={e => setLoginEdit({ ...loginEdit, value: { ...loginEdit.value, username: e.target.value } })} /></label>
        <label className="field">รหัสผ่าน<input type="password" autoComplete="new-password" required={!source.login?.hasPassword} placeholder={source.login?.hasPassword ? 'เว้นว่าง = ใช้รหัสเดิม' : ''} value={loginEdit.value.password} onChange={e => setLoginEdit({ ...loginEdit, value: { ...loginEdit.value, password: e.target.value } })} /></label>
        <p className="hint" style={{ margin: 0 }}>บันทึกแล้วต้องกด “เริ่มรอบใหม่” เพื่อเก็บด้วยบัญชีนี้</p>
        <div className="row"><button className="btn" disabled={busy}>บันทึกล็อกอิน</button>
          {source.login && <button type="button" className="btn ghost" disabled={busy} onClick={() => { if (window.confirm(`ลบล็อกอินของ ${source.name}?`)) void action(async () => { await scrapingApi.clearLogin(source.id); setLoginEdit(null); }); }}>ลบล็อกอิน</button>}
          <button type="button" className="btn ghost" onClick={() => setLoginEdit(null)}>ยกเลิก</button></div>
      </form>}
      <div className="row" style={{ gap: 8 }}><button className="btn ghost" type="button" disabled={busy} onClick={() => edit(source)}>ตั้งค่า</button>
        {source.status === 'running' ? <button className="btn ghost" type="button" disabled={busy} onClick={() => void action(() => scrapingApi.stop(source))}>หยุดเก็บ</button> : <>{source.activity !== 'gave_up' && <button className="btn" type="button" disabled={busy || !source.config.collectionAllowed} onClick={() => void action(() => scrapingApi.start(source, false))}>{source.progress.pending ? 'เก็บต่อ' : 'เริ่มเก็บ'}</button>}
          {!!source.progress.pages && <button className="btn ghost" type="button" disabled={busy || !source.config.collectionAllowed} onClick={() => void action(() => scrapingApi.start(source, true))}>เริ่มรอบใหม่</button>}</>}
        <Link className="btn ghost" to={`/marketing/scraped-catalog?sourceId=${source.id}`}>ดูรายการ</Link></div>
    </section>)}</div>}
  </div>;
}
