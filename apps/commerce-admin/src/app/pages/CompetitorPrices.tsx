import { FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CompetitorCatalogProduct, CompetitorPriceComparison, CompetitorPriceInput, CompetitorSkuSuggestion, competitorPricesApi } from '../../lib/api';
import { useAsync } from '../hooks';

const money = (v: number | null) => (v == null ? '—' : `฿${v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const date = (v: string | null) => (v ? new Date(v).toLocaleString('th-TH') : 'ยังไม่มีราคา');
const blank: CompetitorPriceInput = { sku: '', ourWeightKg: 1, sourceUrl: '', competitorName: '', competitorSku: '', competitorWeightKg: 1,
  sourceContext: '', vatIncluded: false, collectionAllowed: false, autoRefresh: false };
const weightLabels: Record<CompetitorSkuSuggestion['weightMatch'], string> = { same: 'น้ำหนักตรง', different: 'น้ำหนักต่างกัน', unknown: 'ไม่ทราบน้ำหนัก', per_kg: 'เราขายต่อกก.' };
const localNow = () => { const n = new Date(); return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 19); };

/** Competitor price comparison (MER) — moved from josh web-admin; same rules and data. */
export function CompetitorPrices() {
  const [params] = useSearchParams();
  const catalogItemId = params.get('catalogItem');
  const rows = useAsync(() => competitorPricesApi.list(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState<CompetitorPriceInput | null>(null);
  const [editId, setEditId] = useState<string>();
  const [preview, setPreview] = useState<CompetitorCatalogProduct | null>(null);
  const [suggestions, setSuggestions] = useState<CompetitorSkuSuggestion[] | null>(null);
  const [panel, setPanel] = useState<'review' | 'price' | null>(null);
  const [matchNote, setMatchNote] = useState('');
  const [price, setPrice] = useState('');
  const [observedAt, setObservedAt] = useState('');
  const all = rows.data ?? [];
  const selected = all.find((r) => r.id === selectedId) ?? all[0];

  // Arrived from the scraped catalog ("จับคู่ SKU ของเรา"): pre-fill a new pair.
  useEffect(() => {
    if (!catalogItemId) return;
    let active = true;
    competitorPricesApi.catalogItem(catalogItemId).then((item) => {
      if (!active) return;
      setEditId(undefined); setPreview(null);
      setForm({ ...blank, catalogItemId: item.id, sourceUrl: item.url, competitorName: item.name, competitorSku: item.sku,
        competitorWeightKg: item.weightKg || 0, sourceContext: item.source.config.priceContext,
        vatIncluded: !!item.source.config.vatIncluded, collectionAllowed: !!item.source.config.collectionAllowed });
    }).catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    setSuggestions(null);
    competitorPricesApi.suggestions(catalogItemId).then((r) => { if (active) setSuggestions(r.suggestions); })
      .catch((e) => { if (active) { setSuggestions([]); setError(e instanceof Error ? e.message : String(e)); } });
    return () => { active = false; };
  }, [catalogItemId]);
  useEffect(() => { setPanel(null); setMatchNote(''); setPrice(''); }, [selected?.id, selected?.revision, selected?.ourProductVersion]);

  async function action(work: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { rows.reload(); setBusy(false); }
  }

  function edit(row?: CompetitorPriceComparison) {
    setPanel(null); setEditId(row?.id); setPreview(row?.ourProduct ?? null);
    setForm(row ? { revision: row.revision, sku: row.ourProduct.sku, ourWeightKg: row.ourWeightKg, sourceUrl: row.sourceUrl,
      competitorName: row.competitorName, competitorSku: row.competitorSku, competitorWeightKg: row.competitorWeightKg,
      sourceContext: row.sourceContext, vatIncluded: row.vatIncluded, collectionAllowed: row.collectionAllowed, autoRefresh: row.autoRefresh } : { ...blank });
  }

  function openPanel(kind: 'review' | 'price') {
    setForm(null); setPanel(kind); setMatchNote(selected?.matchNote ?? ''); setPrice(''); setObservedAt(localNow());
  }

  const visible = all.filter((r) => (filter === 'all' || (filter === 'review' ? !r.verified : r.comparisonReady))
    && `${r.ourProduct.sku} ${r.ourProduct.name} ${r.competitorName} ${r.sourceName}`.toLowerCase().includes(search.toLowerCase()));
  const cheaper = all.filter((r) => r.comparisonReady && (r.differencePerKgIncVat ?? 0) > 0).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>เทียบราคาคู่แข่ง</h1>
          <p>เทียบราคาต่อกิโลกับแค็ตตาล็อก Josh (สำเนาที่ commerce ซิงก์ทุก 15 นาที) · รวม VAT ไม่รวมค่าส่ง</p>
        </div>
        <div className="row">
          <Link className="btn ghost" to="/marketing/scraped-catalog">เลือกจากคลังเว็บ</Link>
          <button className="btn ghost" type="button" disabled={busy} onClick={rows.reload}>Refresh</button>
          <button className="btn" type="button" disabled={busy} onClick={() => edit()}>+ เพิ่มคู่สินค้า</button>
        </div>
      </div>

      {(error || rows.error) && <div role="alert" className="err" style={{ marginBottom: 12 }}>{error || rows.error}</div>}

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="label">คู่ที่ติดตาม</div><div className="value">{all.length}</div></div>
        <div className="stat"><div className="label">รอยืนยันคู่สินค้า</div><div className="value attn">{all.filter((r) => !r.verified).length}</div></div>
        <div className="stat"><div className="label">เราถูกกว่าคู่แข่ง</div><div className="value">{cheaper}</div></div>
      </div>

      {form && (
        <form className="panel" aria-label="เพิ่มหรือแก้ไขคู่สินค้า" onSubmit={(e: FormEvent) => { e.preventDefault(); void action(async () => {
          const saved = await competitorPricesApi.save(form, editId); setSelectedId(saved.id); setForm(null);
        }); }}>
          <div className="panel-head">{editId ? 'แก้ไขคู่สินค้า' : 'เพิ่มคู่สินค้า'}
            <span className="hint">เปลี่ยน SKU ลิงก์ น้ำหนัก หรือเงื่อนไขราคา จะล้างราคาเดิมและต้องยืนยันคู่ใหม่</span></div>
          <div style={{ padding: 16, display: 'grid', gap: 12 }}>
            {form.catalogItemId && (
              <section aria-label="SKU ที่น่าจะตรงกัน">
                <strong>SKU ของเราที่น่าจะตรงกับ “{form.competitorName}”</strong>
                {suggestions == null ? <div role="status" className="hint">กำลังหา SKU ที่ชื่อใกล้เคียง…</div>
                  : !suggestions.length ? <div className="hint">ไม่พบ SKU ที่ชื่อใกล้เคียง กรอก SKU เองด้านล่าง</div>
                  : <table><tbody>{suggestions.map((s) => (
                    <tr key={s.sku}>
                      <td><strong>{s.name}</strong><div className="hint mono">{s.sku} · {s.brand || 'ไม่ระบุแบรนด์'} · {money(s.sellingUnitPriceIncVat)}/{s.sellingUnit || 'หน่วย'}</div></td>
                      <td><span className="badge muted">ชื่อคล้าย {s.similarityPercent}%</span>{' '}
                        <span className={s.weightMatch === 'different' ? 'badge warn' : s.weightMatch === 'unknown' ? 'badge muted' : 'badge ok'}>{weightLabels[s.weightMatch]}{s.ourWeightKg != null && s.weightMatch !== 'per_kg' ? ` (${s.ourWeightKg} กก.)` : ''}</span></td>
                      <td style={{ textAlign: 'right' }}><button type="button" className="btn ghost sm" disabled={busy || form.sku === s.sku}
                        onClick={() => { setForm({ ...form, sku: s.sku, ourWeightKg: s.ourWeightKg ?? form.ourWeightKg }); setPreview(s); }}>{form.sku === s.sku ? 'เลือกแล้ว' : 'ใช้ SKU นี้'}</button></td>
                    </tr>))}</tbody></table>}
                <div className="hint">ระบบเสนอจากชื่อและน้ำหนักเท่านั้น ตรวจแบรนด์ แพ็ก และสเปกก่อนบันทึก แล้วยืนยันคู่สินค้าตามขั้นตอนเดิม</div>
              </section>
            )}
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <label className="field">SKU ของเรา
                <input required maxLength={100} value={form.sku} onChange={(e) => { setForm({ ...form, sku: e.target.value }); setPreview(null); }} />
              </label>
              <button type="button" className="btn ghost" disabled={busy || !form.sku.trim()}
                onClick={() => void action(async () => setPreview(await competitorPricesApi.catalog(form.sku)))}>ตรวจ SKU</button>
              <label className="field">น้ำหนักต่อหน่วยขายของเรา (กก.)
                <input type="number" min="0.0001" max="100000" step="0.0001" required value={form.ourWeightKg}
                  onChange={(e) => setForm({ ...form, ourWeightKg: Number(e.target.value) })} />
              </label>
            </div>
            <span className="hint">SKU ที่ขายต่อ KG: ระบุจำนวนกิโลที่ต้องการเทียบ</span>
            {preview && <div className="panel" style={{ padding: 12 }}><strong>{preview.name}</strong> · <span className="mono">{preview.sku}</span>
              <div className="hint">{preview.brand || 'ไม่ระบุแบรนด์'} · {preview.country || 'ไม่ระบุประเทศ'} · {preview.storage || 'ไม่ระบุการเก็บรักษา'} · {preview.packSize || 'ไม่ระบุแพ็ก'} · ราคาฐาน {money(preview.sellingUnitPriceIncVat)}/{preview.sellingUnit || 'ไม่ระบุหน่วย'}</div></div>}
            <div className="row">
              <label className="field">ชื่อสินค้าคู่แข่งตรงตามหน้าเว็บ<input required maxLength={500} value={form.competitorName} onChange={(e) => setForm({ ...form, competitorName: e.target.value })} /></label>
              <label className="field">SKU คู่แข่ง (ถ้ามี)<input maxLength={100} value={form.competitorSku} onChange={(e) => setForm({ ...form, competitorSku: e.target.value })} /></label>
            </div>
            <div className="row">
              <label className="field">ลิงก์หน้าสินค้า (เว็บที่ตั้งค่า หรือ Makro PRO / Big C / Freshket)
                <input type="url" required maxLength={2000} value={form.sourceUrl} placeholder="https://…" onChange={(e) => setForm({ ...form, sourceUrl: e.target.value, catalogItemId: undefined })} /></label>
              <label className="field">น้ำหนักสุทธิต่อแพ็กคู่แข่ง (กก.)
                <input type="number" min="0.0001" max="100000" step="0.0001" required value={form.competitorWeightKg} onChange={(e) => setForm({ ...form, competitorWeightKg: Number(e.target.value) })} /></label>
            </div>
            <label className="field">เงื่อนไขราคา / สาขา / โปรโมชั่น
              <textarea required maxLength={1000} value={form.sourceContext} placeholder="เช่น ราคาปกติ สาขา… ไม่มีคูปองสมาชิก ไม่รวมค่าส่ง" onChange={(e) => setForm({ ...form, sourceContext: e.target.value })} /></label>
            <div className="checks">
              <label className="check"><input type="checkbox" checked={form.vatIncluded} onChange={(e) => setForm({ ...form, vatIncluded: e.target.checked, autoRefresh: e.target.checked && form.autoRefresh })} />ตรวจแล้วว่าราคาคู่แข่งรวม VAT หรือสินค้ายกเว้น VAT</label>
              <label className="check"><input type="checkbox" checked={form.collectionAllowed} onChange={(e) => setForm({ ...form, collectionAllowed: e.target.checked, autoRefresh: e.target.checked && form.autoRefresh })} />มีสิทธิ์หรือได้รับอนุญาตให้ดึงข้อมูลอัตโนมัติจากแหล่งนี้</label>
              <label className="check"><input type="checkbox" disabled={!form.vatIncluded || !form.collectionAllowed} checked={form.autoRefresh} onChange={(e) => setForm({ ...form, autoRefresh: e.target.checked })} />ดึงราคาอัตโนมัติวันละครั้ง หลังยืนยันคู่สินค้า</label>
            </div>
            <div className="row"><button type="submit" className="btn" disabled={busy}>บันทึกคู่สินค้า</button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => setForm(null)}>ยกเลิก</button></div>
          </div>
        </form>
      )}

      {selected && (
        <section className="panel" aria-label="รายละเอียดเปรียบเทียบ">
          <div className="panel-head">
            <span>{selected.ourProduct.name} <span className="hint mono">SKU {selected.ourProduct.sku}</span>{' '}
              <span className={selected.verified ? 'badge ok' : 'badge warn'}>{selected.verified ? 'ยืนยันคู่แล้ว' : 'รอยืนยันคู่สินค้า'}</span></span>
            <button className="btn ghost sm" type="button" disabled={busy} onClick={() => edit(selected)}>แก้ไขคู่สินค้า</button>
          </div>
          <div className="stat-grid" style={{ padding: 16 }}>
            <div className="stat"><div className="label">ราคาของเรา · แค็ตตาล็อก Josh</div>
              <div className="value">{money(selected.ourPricePerKgIncVat)}<span className="hint">/กก.</span></div>
              <div>{selected.ourWeightKg} กก. = {money(selected.ourPackPriceIncVat)}</div>
              <div className="hint">แค็ตตาล็อกอัปเดต {date(selected.ourProduct.updatedAt)}</div></div>
            <div className="stat"><div className="label">{selected.sourceName}</div>
              <div className="value">{money(selected.competitorPricePerKgIncVat)}<span className="hint">/กก.</span></div>
              <div>{selected.competitorWeightKg} กก. = {money(selected.competitorPackPriceIncVat)}</div>
              <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">{selected.competitorName} ↗</a>
              <div className="hint">พบราคา {date(selected.observedAt)} · {selected.captureMethod === 'automatic' ? 'ดึงอัตโนมัติ' : selected.captureMethod === 'manual' ? 'บันทึกจากแหล่งที่มา' : 'ยังไม่ได้บันทึก'}</div></div>
            <div className="stat"><div className="label">{!selected.comparisonReady ? 'ยังคำนวณส่วนต่างไม่ได้' : selected.differencePerKgIncVat === 0 ? 'ราคาเท่ากัน' : (selected.differencePerKgIncVat ?? 0) > 0 ? 'เราถูกกว่า' : 'เราแพงกว่า'}</div>
              {selected.comparisonReady ? <>
                <div className="value" style={{ color: (selected.differencePerKgIncVat ?? 0) >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{money(Math.abs(selected.differencePerKgIncVat ?? 0))}<span className="hint">/กก.</span></div>
                <div>{selected.ourWeightKg} กก. ต่างกัน {money(Math.abs(selected.differenceForOurWeightIncVat ?? 0))}</div>
                <div className="hint">{Math.abs(selected.differencePercent ?? 0)}% เทียบกับราคาคู่แข่ง</div>
              </> : <div className="value attn" style={{ fontSize: 14 }}>{selected.comparisonReason}</div>}</div>
          </div>
          <div style={{ padding: '0 16px 16px' }}>
            <p className="hint">เงื่อนไขราคา: {selected.sourceContext}</p>
            <div className="row">
              <button className="btn ghost" type="button" disabled={busy} onClick={() => openPanel('review')}>ตรวจคู่สินค้า</button>
              <button className="btn ghost" type="button" disabled={busy || !selected.vatIncluded} onClick={() => openPanel('price')}>บันทึกราคาจากแหล่งที่มา</button>
              <button className="btn" type="button" disabled={busy || !selected.canRefresh} title={selected.refreshReason ?? undefined}
                onClick={() => void action(() => competitorPricesApi.refresh(selected.id))}>ดึงราคาตอนนี้</button>
            </div>
            {selected.refreshReason && <p className="hint">{selected.refreshReason}</p>}
            {selected.lastError && <p className="err">{selected.lastError}</p>}
            {!selected.vatIncluded && <p className="hint">แก้ไขคู่สินค้าเพื่อยืนยัน VAT ก่อนบันทึกราคา</p>}
          </div>
          {panel === 'review' && (
            <form aria-label="ตรวจคู่สินค้า" style={{ padding: 16, borderTop: '1px solid var(--line)', display: 'grid', gap: 10 }}
              onSubmit={(e) => { e.preventDefault(); void action(async () => { await competitorPricesApi.verify(selected, matchNote); setPanel(null); }); }}>
              <strong>ตรวจว่าเป็นสินค้าเทียบเคียงกัน</strong>
              <span className="hint">SKU คนละร้านไม่จำเป็นต้องเหมือนกัน ตรวจชนิด / ส่วนตัด เกรด แบรนด์ ประเทศ และแช่เย็นหรือแช่แข็งจากหน้าสินค้าก่อนยืนยัน</span>
              <div className="row">
                <div className="panel" style={{ padding: 12, flex: '1 1 260px' }}><strong>{selected.ourProduct.name}</strong>
                  <div className="hint">{selected.ourProduct.brand || 'ไม่ระบุแบรนด์'} · {selected.ourProduct.country || 'ไม่ระบุประเทศ'} · {selected.ourProduct.storage || 'ไม่ระบุการเก็บรักษา'}</div>
                  <div className="hint">แพ็ก: {selected.ourProduct.packSize || 'ไม่ระบุ'} · หน่วยขาย: {selected.ourProduct.sellingUnit || 'ไม่ระบุ'} · น้ำหนักที่ยืนยัน {selected.ourWeightKg} กก.</div></div>
                <div className="panel" style={{ padding: 12, flex: '1 1 260px' }}><strong>{selected.competitorName}</strong>
                  <div className="hint">SKU {selected.competitorSku || 'ไม่ระบุ'} · {selected.competitorWeightKg} กก.</div>
                  <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">ตรวจหน้าสินค้าต้นทาง ↗</a></div>
              </div>
              <label className="field">เหตุผลและสเปกที่ตรงกัน
                <textarea required minLength={10} maxLength={1000} value={matchNote} onChange={(e) => setMatchNote(e.target.value)} placeholder="ระบุชนิด ส่วนตัด เกรด ประเทศ สภาพการเก็บรักษา และเหตุผลที่เทียบได้" /></label>
              <label className="check"><input type="checkbox" required />ตรวจสเปกจากแหล่งที่มาแล้ว และยืนยันน้ำหนักต่อหน่วยขายของเรา</label>
              <span className="hint">ยืนยันล่าสุด {date(selected.verifiedAt)}{selected.verifiedBy ? ` · ผู้ยืนยัน ${selected.verifiedBy}` : ''}</span>
              <div className="row"><button className="btn" disabled={busy}>ยืนยันคู่สินค้า</button>
                <button type="button" className="btn ghost" disabled={busy} onClick={() => setPanel(null)}>ปิด</button></div>
            </form>
          )}
          {panel === 'price' && (
            <form aria-label="บันทึกราคา" style={{ padding: 16, borderTop: '1px solid var(--line)', display: 'grid', gap: 10 }}
              onSubmit={(e) => { e.preventDefault(); void action(async () => { await competitorPricesApi.capture(selected, Number(price), new Date(observedAt).toISOString()); setPanel(null); }); }}>
              <strong>บันทึกราคาที่พบจาก {selected.sourceName}</strong>
              <div className="row">
                <label className="field">ราคาเต็มแพ็ก {selected.competitorWeightKg} กก. (บาท รวม VAT)
                  <input type="number" required min="0.01" max="9999999999.99" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
                <label className="field">เวลาที่พบราคา
                  <input type="datetime-local" step="1" required value={observedAt} onChange={(e) => setObservedAt(e.target.value)} /></label>
              </div>
              <span className="hint mono" style={{ wordBreak: 'break-all' }}>แหล่งที่มา: {selected.sourceUrl}</span>
              <div className="row"><button className="btn" disabled={busy}>บันทึกราคา</button>
                <button type="button" className="btn ghost" disabled={busy} onClick={() => setPanel(null)}>ปิด</button></div>
            </form>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <span>สินค้าที่ติดตาม</span>
          <span className="row">
            <input aria-label="ค้นหาคู่สินค้า" type="search" placeholder="ค้นหา SKU / ชื่อสินค้า / ร้าน" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select aria-label="กรองสถานะ" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">ทั้งหมด</option><option value="review">รอยืนยันคู่</option><option value="ready">เทียบราคาได้</option>
            </select>
          </span>
        </div>
        {rows.loading ? <div className="empty">กำลังโหลดคู่สินค้า…</div> : !visible.length ? (
          <div className="empty">{all.length ? 'ไม่พบคู่สินค้าที่ตรงตัวกรอง' : 'ยังไม่มีคู่สินค้าที่ติดตาม — เพิ่ม SKU ของเราและลิงก์คู่แข่ง แล้วตรวจคู่สินค้าเพื่อเริ่มเทียบราคา'}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>สินค้าของเรา</th><th>คู่แข่ง / แหล่งที่มา</th><th>เรา / กก.</th><th>คู่แข่ง / กก.</th><th>ส่วนต่าง / กก.</th><th>สถานะ</th><th></th></tr></thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} style={selected?.id === r.id ? { background: 'var(--chip)' } : undefined}>
                    <td><button className="btn ghost sm" type="button" onClick={() => { setSelectedId(r.id); setPanel(null); setForm(null); }}>{r.ourProduct.name}</button>
                      <div className="hint mono">{r.ourProduct.sku} · {r.ourWeightKg} กก.</div></td>
                    <td><a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">{r.sourceName} ↗</a>
                      <div className="hint">{r.competitorName} · {r.competitorWeightKg} กก.</div><div className="hint">{date(r.observedAt)}</div></td>
                    <td className="mono">{money(r.ourPricePerKgIncVat)}</td>
                    <td className="mono">{money(r.competitorPricePerKgIncVat)}</td>
                    <td className="mono" style={{ color: (r.differencePerKgIncVat ?? 0) > 0 ? 'var(--ok)' : 'var(--danger)' }}>
                      {r.comparisonReady ? `${(r.differencePerKgIncVat ?? 0) > 0 ? '+' : ''}${money(r.differencePerKgIncVat)}` : '—'}</td>
                    <td className="hint">{r.comparisonReady ? 'ยืนยันคู่แล้ว · เทียบได้' : r.comparisonReason}<div>{r.autoRefresh ? 'ดึงอัตโนมัติ' : 'บันทึกเอง'}</div></td>
                    <td><button className="btn ghost sm" type="button" disabled={busy} style={{ color: 'var(--danger)' }}
                      onClick={() => { if (window.confirm(`ลบคู่ ${r.ourProduct.sku} กับ ${r.sourceName}?`)) void action(async () => { await competitorPricesApi.remove(r.id); if (selectedId === r.id) setSelectedId(null); }); }}>ลบคู่</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="hint">ราคาเกิน 24 ชั่วโมงหรือดึงครั้งล่าสุดไม่สำเร็จ จะพักการเทียบส่วนต่างจนกว่าจะอัปเดตสำเร็จ · ใช้ราคาฐานแค็ตตาล็อก ไม่มีราคาสัญญารายลูกค้า</p>
    </div>
  );
}
