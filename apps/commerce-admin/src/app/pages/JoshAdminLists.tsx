import { FormEvent, Fragment, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { joshAdmin } from '../../lib/api';
import { useAsync } from '../hooks';

type Row = Record<string, unknown>;
type Write = 'PATCH' | 'PUT';

/** One josh admin list driven through josh's own routes (josh validates every save). */
interface ListDef {
  title: string; hint: string; list: string; item: (id: string) => string; update: Write;
  /** Starting JSON for "สร้างใหม่" when there is no row to copy. */
  blank: Row;
  /** Fields shown in the table, in order (josh's names); the rest are in "แก้". */
  columns: string[];
  /** Fields a copy / edit leaves out (josh sets them). */
  readOnly?: string[];
}

export const JOSH_LISTS: Record<string, ListDef> = {
  'product-sets': {
    title: 'Product Set', hint: 'ชุดสินค้าที่โปรโมชันอ้างถึง (SKU / หมวด / แบรนด์)', list: '/admin/promotion-product-sets',
    item: (id) => `/admin/promotion-product-sets/${id}`, update: 'PATCH', columns: ['name', 'is_active', 'description', 'updated_at'],
    blank: { name: '', description: '', is_active: true, skus: [], category_ids: [], brand_ids: [] },
  },
  'promotion-pages': {
    title: 'หน้าโปรโมชัน', hint: 'หน้า landing ของโปร (slug, ช่วงเวลา, โปรที่ผูก)', list: '/promotion-pages',
    item: (id) => `/promotion-pages/${id}`, update: 'PUT', columns: ['slug', 'name', 'is_active', 'start_date', 'end_date', 'published_at'],
    blank: { slug: '', name: '', is_active: false },
  },
  coupons: {
    title: 'คูปอง', hint: 'สร้าง / แก้คูปอง (เปิด-ปิดอย่างเดียวทำที่ josh › Coupons ก็ได้)', list: '/coupon',
    item: (id) => `/coupon/${id}`, update: 'PATCH', columns: ['coupon_code', 'title', 'status', 'is_active', 'discount_type', 'discount_value', 'global_used_count', 'start_date', 'end_date'],
    readOnly: ['global_used_count'],
    blank: { coupon_code: '', title: '', discount_type: 'fixed', discount_value: 0, is_active: false },
  },
  campaigns: {
    title: 'Campaigns', hint: 'แคมเปญ (ช่วงเวลาที่โปรและคูปองผูกด้วย)', list: '/campaigns',
    item: (id) => `/campaigns/${id}`, update: 'PATCH', columns: ['name', 'is_active', 'start_at', 'end_at', 'updated_at'],
    blank: { name: '', start_at: '', end_at: '', is_active: false },
  },
  segments: {
    title: 'Segments', hint: 'กลุ่มลูกค้า (ใช้กับคูปอง / push / โปร)', list: '/user-segments',
    item: (id) => `/user-segments/${id}`, update: 'PATCH', columns: ['name', 'rule_type', 'is_active', 'member_count', 'updated_at'],
    readOnly: ['member_count', 'last_scheduled_run', 'frozen_at'],
    blank: { name: '', description: '', rule_type: '', rule_config: {} },
  },
  'bot-intents': {
    title: 'Bot · intent rules', hint: 'คำ/ประโยคที่ bot จับแล้วตอบตามกฎ (bot ยังตอบลูกค้าจาก josh)', list: '/admin/bot/intent-rules',
    item: (id) => `/admin/bot/intent-rules/${id}`, update: 'PATCH', columns: ['intent', 'pattern', 'active', 'updatedAt'],
    readOnly: ['createdAt', 'updatedAt'],
    blank: { intent: '', pattern: '', active: false },
  },
  'bot-workflows': {
    title: 'Bot · workflows', hint: 'ลำดับคำถาม/คำตอบของ bot', list: '/admin/bot/workflows',
    item: (id) => `/admin/bot/workflows/${id}`, update: 'PATCH', columns: ['name', 'intent', 'triggerEvent', 'active', 'updatedAt'],
    readOnly: ['createdAt', 'updatedAt'],
    blank: { name: '', intent: '', active: false, steps: [] },
  },
  'bot-templates': {
    title: 'Bot · templates', hint: 'ข้อความสำเร็จรูปของ bot', list: '/admin/bot/templates',
    item: (id) => `/admin/bot/templates/${id}`, update: 'PATCH', columns: ['name', 'type', 'active', 'updatedAt'],
    readOnly: ['createdAt', 'updatedAt'],
    blank: { name: '', type: '', schema: {}, example: {}, active: false },
  },
};

const META = ['id', 'created_at', 'updated_at', 'createdAt', 'updatedAt', 'created_by', 'updated_by', 'deleted_at'];
/** josh answers lists as an array, `{ data }`, `{ data: { items } }` or `{ items }`. */
export function rowsOf(answer: unknown): Row[] {
  const a = answer as { data?: unknown; items?: unknown } | unknown[] | null;
  if (Array.isArray(a)) return a as Row[];
  const d = a?.data as { items?: unknown; data?: unknown } | unknown[] | undefined;
  if (Array.isArray(d)) return d as Row[];
  if (Array.isArray(d?.items)) return d.items as Row[];
  if (Array.isArray(d?.data)) return d.data as Row[];
  if (Array.isArray(a?.items)) return a.items as Row[];
  return [];
}
const idOf = (r: Row) => String(r.id ?? r[Object.keys(r).find((k) => k.endsWith('_id') && typeof r[k] === 'string') ?? 'id'] ?? '');
const cell = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'boolean' ? (v ? '✓' : '—') : typeof v === 'object' ? JSON.stringify(v).slice(0, 60)
  : /^\d{4}-\d\d-\d\dT/.test(String(v)) ? new Date(String(v)).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : String(v));
const editable = (r: Row, def: ListDef) => Object.fromEntries(Object.entries(r).filter(([k]) => !META.includes(k) && !(def.readOnly ?? []).includes(k)));

/**
 * josh admin lists commerce now owns (josh COMMERCE_OWNS_* switches lock josh's own editing).
 * Data and every save go through josh's own admin routes (POST /api/josh/admin-call), so josh's rules
 * apply unchanged; edits are josh's JSON, prefilled from the row.
 */
export function JoshAdminLists() {
  const { kind = 'coupons' } = useParams();
  const def = JOSH_LISTS[kind];
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const list = useAsync(() => (def ? joshAdmin.get(def.list, kind === 'coupons' ? { limit: 200 } : undefined) : Promise.resolve(null)), [kind]);
  useEffect(() => { setEditing(null); setMsg(''); setQ(''); }, [kind]);
  if (!def) return <div className="empty">ไม่รู้จักรายการ {kind}</div>;
  const rows = rowsOf(list.data).filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));

  async function run(done: string, fn: () => Promise<unknown>) {
    setBusy(true); setMsg('');
    try { await fn(); setMsg(done); setEditing(null); list.reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  function save(e: FormEvent) {
    e.preventDefault();
    let body: unknown;
    try { body = JSON.parse(editing!.text); } catch { return setMsg('JSON ไม่ถูกต้อง'); }
    const id = editing!.id;
    if (!window.confirm(`${id ? 'บันทึกการแก้' : 'สร้าง'} ${def.title} นี้ที่ josh?`)) return;
    run(id ? 'บันทึกแล้ว' : 'สร้างแล้ว', () => (id ? joshAdmin.call(def.update, def.item(id), body) : joshAdmin.call('POST', def.list, body)));
  }
  const remove = (r: Row) => window.confirm(`ลบ "${String(r.name ?? r.title ?? r.coupon_code ?? r.slug ?? idOf(r))}" ที่ josh? ย้อนกลับไม่ได้`)
    && run('ลบแล้ว', () => joshAdmin.call('DELETE', def.item(idOf(r))));

  return (
    <div>
      <div className="page-head">
        <div><h1>{def.title} <span className="hint">(josh)</span></h1><p>{def.hint} · บันทึกด้วยระบบของ josh ในชื่อบัญชี josh ที่อีเมลตรงกับคุณ</p></div>
        <div className="row" style={{ gap: 6 }}>
          <input aria-label="ค้นหา" placeholder="ค้นหา…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn sm" onClick={() => setEditing({ id: null, text: JSON.stringify(def.blank, null, 2) })}>สร้างใหม่</button>
        </div>
      </div>
      {msg && <div className="hint" role="status">{msg}</div>}
      {list.error && <div className="err">{list.error}</div>}
      {editing && editing.id === null && <JsonForm text={editing.text} busy={busy} onChange={(text) => setEditing({ ...editing, text })} onSubmit={save} onCancel={() => setEditing(null)} label="สร้าง" />}
      {!list.data && !list.error ? <div className="hint">Loading…</div> : (
        <section className="panel" style={{ overflowX: 'auto' }}>
          {rows.length ? (
            <table>
              <thead><tr>{def.columns.map((c) => <th key={c}>{c}</th>)}<th></th></tr></thead>
              <tbody>{rows.map((r) => (
                <Fragment key={idOf(r)}>
                  <tr>
                    {def.columns.map((c) => <td key={c}>{cell(r[c])}</td>)}
                    <td className="row" style={{ gap: 4 }}>
                      <button className="btn ghost sm" onClick={() => setEditing({ id: idOf(r), text: JSON.stringify(editable(r, def), null, 2) })}>แก้</button>
                      <button className="btn ghost sm" onClick={() => setEditing({ id: null, text: JSON.stringify({ ...editable(r, def), ...('is_active' in r ? { is_active: false } : {}) }, null, 2) })}>คัดลอก</button>
                      <button className="btn ghost sm danger" disabled={busy} onClick={() => remove(r)}>ลบ</button>
                    </td>
                  </tr>
                  {editing?.id === idOf(r) && <tr><td colSpan={def.columns.length + 1}>
                    <JsonForm text={editing.text} busy={busy} onChange={(text) => setEditing({ ...editing, text })} onSubmit={save} onCancel={() => setEditing(null)} label="บันทึก" />
                  </td></tr>}
                </Fragment>
              ))}</tbody>
            </table>
          ) : <div className="empty">ไม่มีรายการ</div>}
        </section>
      )}
    </div>
  );
}

function JsonForm({ text, busy, label, onChange, onSubmit, onCancel }: { text: string; busy: boolean; label: string; onChange: (t: string) => void; onSubmit: (e: FormEvent) => void; onCancel: () => void }) {
  return (
    <form onSubmit={onSubmit} className="panel" style={{ display: 'grid', gap: 8, padding: 12, margin: '8px 0' }}>
      <div className="hint">ข้อมูลตามรูปแบบของ josh · josh ตรวจก่อนบันทึก ถ้าไม่ผ่านจะแสดงเหตุผลของ josh</div>
      <textarea aria-label="ข้อมูล (JSON)" rows={14} className="mono" value={text} onChange={(e) => onChange(e.target.value)} />
      <div className="row"><button className="btn sm" disabled={busy}>{busy ? 'กำลังส่ง…' : label}</button><button type="button" className="btn ghost sm" onClick={onCancel}>ยกเลิก</button></div>
    </form>
  );
}
