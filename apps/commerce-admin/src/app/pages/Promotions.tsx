import { FormEvent, Fragment, useState } from 'react';
import { PromotionRow, promotionsApi } from '../../lib/api';
import { useAsync } from '../hooks';

const STATE: Record<PromotionRow['state'], [string, string]> = {
  running: ['กำลังใช้', 'ok'], scheduled: ['รอเริ่ม', ''], ended: ['จบแล้ว', ''], sold_out: ['ครบโควตา', 'warn'], off: ['ปิด', 'danger'],
};
const when = (v: string | null) => (v ? new Date(v).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
/** ISO → the value a datetime-local input shows (local time). */
const local = (v: string) => { const d = new Date(v); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

/**
 * josh promotion mechanics. Read from josh's replica; every change is done by josh's own
 * PromotionMechanicService (josh COMMERCE_OWNS_PROMOTIONS=true locks josh admin's mechanic editing).
 * Product sets and promotion pages stay in josh admin.
 */
export function Promotions() {
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<PromotionRow | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const list = useAsync(() => promotionsApi.list({ state, search }), [state, search]);
  const shadow = useAsync(() => promotionsApi.shadow(7), []);
  const detail = useAsync(() => (open ? promotionsApi.detail(open) : Promise.resolve(null)), [open]);
  const sh = shadow.data;

  async function run(done: string, fn: () => Promise<unknown>) {
    setBusy(true); setMsg('');
    try { await fn(); setMsg(done); setEditing(null); setCreating(null); list.reload(); detail.reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const toggle = (p: PromotionRow) => window.confirm(`${p.is_active ? 'ปิด' : 'เปิด'}โปร "${p.name}"? หน้าร้านเห็นทันที`)
    && run(`${p.is_active ? 'ปิด' : 'เปิด'} "${p.name}" แล้ว`, () => promotionsApi.update(p.id, { is_active: !p.is_active }));
  const remove = (p: PromotionRow) => window.confirm(`ลบโปร "${p.name}" ถาวร?\n\nราคาจะกลับเป็นราคาปกติทันที — ถ้าแค่หยุดชั่วคราวให้กด "ปิด" แทน`)
    && run(`ลบ "${p.name}" แล้ว`, () => promotionsApi.remove(p.id));
  /** josh's CreatePromotionMechanicDto from an existing promotion — the starting point for a new one. */
  const copyOf = (p: PromotionRow) => JSON.stringify({
    name: `${p.name} (สำเนา)`, start_date: p.start_date, end_date: p.end_date, value: p.value, badge_text: p.badge_text, badge_text_en: p.badge_text_en,
    product_set_ids: p.product_set_ids, max_units: p.max_units, audience: p.audience === 'companies' ? 'all' : p.audience, is_active: false,
  }, null, 2);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>โปรโมชัน</h1>
          <p>โปรของ josh (promotion mechanics) · แก้ที่นี่ → josh บันทึกด้วยระบบของ josh เอง (ตรวจราคา/SKU ซ้ำ ล้าง cache) · Product Set และหน้าโปรยังแก้ที่ josh</p>
        </div>
        <button className="btn sm" onClick={() => setCreating(list.data?.[0] ? copyOf(list.data[0]) : '{\n  "name": "",\n  "start_date": "",\n  "end_date": "",\n  "value": {},\n  "product_set_ids": []\n}')}>สร้างโปรใหม่</button>
      </div>
      {sh && (
        <div className="stat-grid">
          <div className="stat"><div className="label">ทดลองคู่กัน: เลือกโปรตรง josh (7 วัน)</div>
            <div className={`value${sh.sameMechanicRate != null && sh.sameMechanicRate < 100 ? ' attn' : ''}`}>{sh.sameMechanicRate == null ? '—' : `${sh.sameMechanicRate}%`}</div>
            <div className="hint">{sh.same_mechanic} / {sh.lines} บรรทัด order ที่มีโปร · จาก "ราคา: commerce คิดคู่กัน"</div></div>
        </div>
      )}
      {msg && <div className="hint" role="status">{msg}</div>}
      {(list.error || shadow.error) && <div className="err">{list.error || shadow.error}</div>}
      {creating !== null && <CreateForm initial={creating} busy={busy} onCancel={() => setCreating(null)}
        onSave={(m) => run(`สร้าง "${String(m.name)}" แล้ว`, () => promotionsApi.create(m))} />}
      <div className="row" style={{ margin: '12px 0', gap: 8, flexWrap: 'wrap' }}>
        {[['', 'ทั้งหมด'], ...Object.entries(STATE).map(([k, [label]]) => [k, label])].map(([k, label]) => (
          <button key={k} className={`btn sm ${state === k ? '' : 'ghost'}`} aria-pressed={state === k} onClick={() => setState(k)}>{label}</button>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }} className="row" style={{ gap: 6 }}>
          <input aria-label="ค้นหาชื่อโปร" placeholder="ชื่อโปร" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn ghost sm">ค้นหา</button>
        </form>
      </div>
      {list.data && (
        <section className="panel">
          {list.data.length ? (
            <table>
              <thead><tr><th>โปร</th><th>สถานะ</th><th>ช่วงเวลา</th><th>ขายแล้ว / โควตา</th><th>SKU</th><th>ลูกค้า</th><th></th></tr></thead>
              <tbody>{list.data.map((p) => (
                <Fragment key={p.id}>
                  <tr>
                    <td>{p.name}{p.badge_text && <div className="hint">{p.badge_text}</div>}{p.campaign_name && <div className="hint">แคมเปญ: {p.campaign_name}</div>}</td>
                    <td><span className={`badge ${STATE[p.state][1]}`}>{STATE[p.state][0]}</span></td>
                    <td>{when(p.start_date)} – {when(p.end_date)}</td>
                    <td>{p.sold_units}{p.max_units ? ` / ${p.max_units}` : ''}</td>
                    <td>{p.sku_count}</td>
                    <td>{p.audience === 'companies' ? `${p.audience_companies} บริษัท` : p.audience}</td>
                    <td className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                      <button className="btn ghost sm" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? 'ซ่อน' : 'ดู'}</button>
                      <button className="btn ghost sm" disabled={busy} onClick={() => setEditing(p)}>แก้</button>
                      <button className="btn ghost sm" disabled={busy} onClick={() => toggle(p)}>{p.is_active ? 'ปิด' : 'เปิด'}</button>
                      <button className="btn ghost sm" disabled={busy} onClick={() => setCreating(copyOf(p))}>คัดลอก</button>
                      <button className="btn ghost sm" disabled={busy} onClick={() => remove(p)}>ลบ</button>
                    </td>
                  </tr>
                  {editing?.id === p.id && <tr><td colSpan={7}><EditForm p={p} busy={busy} onCancel={() => setEditing(null)}
                    onSave={(changes) => run(`บันทึก "${p.name}" แล้ว`, () => promotionsApi.update(p.id, changes))} /></td></tr>}
                  {open === p.id && <tr><td colSpan={7}>{detail.error ? <div className="err">{detail.error}</div> : !detail.data ? 'Loading…' : (
                    <div style={{ display: 'grid', gap: 8 }}>
                      <div><div className="hint">เงื่อนไข (value)</div><pre className="payload">{JSON.stringify(detail.data.value, null, 2)}</pre></div>
                      <table>
                        <thead><tr><th>SKU</th><th>สินค้า</th><th>ป้าย</th><th>ราคา/ขั้น</th></tr></thead>
                        <tbody>{detail.data.skus.map((s) => (
                          <tr key={s.sku}><td className="mono">{s.sku}</td><td>{s.name_th ?? '—'}</td><td>{s.badge_text ?? '—'}</td>
                            <td className="mono">{JSON.stringify(s.value ?? s.quantity_rules)}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>)}</td></tr>}
                </Fragment>
              ))}</tbody>
            </table>
          ) : <div className="empty">ไม่พบโปร</div>}
        </section>
      )}
    </div>
  );
}

/** The everyday edits: name, badges, window, unit cap. Conditions and product sets: copy into a new promotion. */
function EditForm({ p, busy, onSave, onCancel }: { p: PromotionRow; busy: boolean; onSave: (c: Record<string, unknown>) => void; onCancel: () => void }) {
  const [v, setV] = useState({ name: p.name, badge_text: p.badge_text ?? '', badge_text_en: p.badge_text_en ?? '', start_date: local(p.start_date),
    end_date: local(p.end_date), max_units: p.max_units == null ? '' : String(p.max_units) });
  const [err, setErr] = useState('');
  function save(e: FormEvent) {
    e.preventDefault();
    if (!v.name.trim()) return setErr('ต้องมีชื่อโปร');
    if (new Date(v.end_date) <= new Date(v.start_date)) return setErr('วันจบต้องหลังวันเริ่ม');
    const cap = v.max_units.trim() === '' ? null : Number(v.max_units);
    if (cap !== null && (!Number.isInteger(cap) || cap < 1)) return setErr('โควตาต้องเป็นจำนวนเต็มตั้งแต่ 1 หรือเว้นว่าง');
    const changes: Record<string, unknown> = {};
    if (v.name.trim() !== p.name) changes.name = v.name.trim();
    if (v.badge_text !== (p.badge_text ?? '')) changes.badge_text = v.badge_text || null;
    if (v.badge_text_en !== (p.badge_text_en ?? '')) changes.badge_text_en = v.badge_text_en || null;
    if (v.start_date !== local(p.start_date)) changes.start_date = new Date(v.start_date).toISOString();
    if (v.end_date !== local(p.end_date)) changes.end_date = new Date(v.end_date).toISOString();
    if (cap !== p.max_units) changes.max_units = cap;
    if (!Object.keys(changes).length) return onCancel();
    onSave(changes);
  }
  const field = (k: keyof typeof v, label: string, type = 'text') => (
    <label>{label}<input type={type} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>
  );
  return (
    <form onSubmit={save} className="panel" style={{ display: 'grid', gap: 10, padding: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        {field('name', 'ชื่อโปร')}{field('badge_text', 'ป้าย (ไทย)')}{field('badge_text_en', 'ป้าย (อังกฤษ)')}
        {field('start_date', 'เริ่ม', 'datetime-local')}{field('end_date', 'จบ', 'datetime-local')}{field('max_units', 'โควตา (ชิ้น, เว้นว่าง = ไม่จำกัด)', 'number')}
      </div>
      {p.campaign_id && <div className="hint">โปรนี้อยู่ในแคมเปญ "{p.campaign_name}" — ช่วงเวลาที่ใช้จริงมาจากแคมเปญ</div>}
      {err && <div className="err">{err}</div>}
      <div className="row"><button className="btn sm" disabled={busy}>บันทึก</button><button type="button" className="btn ghost sm" onClick={onCancel}>ยกเลิก</button></div>
    </form>
  );
}

/** New promotion as josh's CreatePromotionMechanicDto JSON (prefilled from an existing one, created switched off). */
function CreateForm({ initial, busy, onSave, onCancel }: { initial: string; busy: boolean; onSave: (m: Record<string, unknown>) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [err, setErr] = useState('');
  const sets = useAsync(() => promotionsApi.productSets(), []);
  function save(e: FormEvent) {
    e.preventDefault();
    let m: unknown;
    try { m = JSON.parse(text); } catch { return setErr('JSON ไม่ถูกต้อง'); }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return setErr('ต้องเป็น object');
    setErr('');
    onSave(m as Record<string, unknown>);
  }
  return (
    <form onSubmit={save} className="panel" style={{ display: 'grid', gap: 8, padding: 12, marginTop: 12 }}>
      <div className="hint">โปรใหม่ (รูปแบบเดียวกับ josh) · ตั้งต้นจากโปรที่เลือกและปิดไว้ก่อน (<span className="mono">is_active: false</span>) · josh ตรวจเงื่อนไขและ SKU ซ้ำให้</div>
      <textarea aria-label="ข้อมูลโปร (JSON)" rows={14} className="mono" value={text} onChange={(e) => setText(e.target.value)} />
      {sets.data && <details><summary className="hint">Product Set ที่มี ({sets.data.length}) — ใส่ id ใน product_set_ids</summary>
        <table><tbody>{sets.data.map((s) => <tr key={s.id}><td className="mono">{s.id}</td><td>{s.name}</td><td>{s.products} สินค้า</td><td>{s.is_active ? '' : 'ปิด'}</td></tr>)}</tbody></table>
      </details>}
      {err && <div className="err">{err}</div>}
      <div className="row"><button className="btn sm" disabled={busy}>สร้าง</button><button type="button" className="btn ghost sm" onClick={onCancel}>ยกเลิก</button></div>
    </form>
  );
}
