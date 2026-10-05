import { FormEvent, useState } from 'react';
import { joshPriceApi, JoshRow, staffPricesApi, StaffPriceRow } from '../../lib/api';
import { useAsync } from '../hooks';

type Kind = 'customer' | 'contract';
const KIND: Record<Kind, string> = { customer: 'ราคาลูกค้า (ต่อบริษัท)', contract: 'ราคาสัญญา (ต่อสาขา)' };
const STATUS: Record<string, [string, string]> = { synced: ['josh ใช้แล้ว', 'ok'], pending: ['กำลังส่ง', ''], failed: ['ส่งไม่สำเร็จ', 'danger'] };
const money = (v: number) => v.toLocaleString('th-TH', { minimumFractionDigits: 2 });

/**
 * Customer and branch contract prices owned by commerce. Saved here first, then josh writes its copy
 * with its own services (josh COMMERCE_OWNS_PRICES=true locks josh's own editing).
 */
export function StaffPrices() {
  const [kind, setKind] = useState<Kind>('customer');
  const [scope, setScope] = useState<JoshRow | null>(null);
  const [branchSearch, setBranchSearch] = useState('');
  const [branchQ, setBranchQ] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const summary = useAsync(() => staffPricesApi.summary(), []);
  const branches = useAsync(() => (branchQ ? joshPriceApi.branches(branchQ) : Promise.resolve([] as JoshRow[])), [branchQ]);
  const scopeId = scope ? (kind === 'customer' ? scope.company_id : scope.branch_id) : undefined;
  const list = useAsync(() => staffPricesApi.list({ kind, scopeId, search, status, page }), [kind, scopeId, search, status, page]);
  const count = (k: string, st: string) => summary.data?.rows.find((r) => r.kind === k && r.status === st)?.n ?? 0;
  const reload = () => { summary.reload(); list.reload(); };

  async function run(label: string | ((r: never) => string), fn: () => Promise<unknown>) {
    setBusy(true); setMsg('');
    try {
      const r = await fn() as Partial<StaffPriceRow> | undefined;
      setMsg(r?.status === 'failed' ? `บันทึกใน commerce แล้ว แต่ josh ยังไม่รับ: ${r.syncError}` : typeof label === 'function' ? label(r as never) : label);
      setForm({}); setEditing(null); reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const body = { price: Number(form.price), startDate: form.startDate || undefined, endDate: form.endDate || null, ...(kind === 'contract' ? { contractRef: form.contractRef || undefined } : {}) };
    if (editing) return run('แก้ไขแล้ว และ josh ใช้ราคานี้แล้ว', () => staffPricesApi.update(editing, body));
    if (!scope) { setMsg(kind === 'customer' ? 'เลือกบริษัทก่อน (ค้นหาสาขาแล้วกดเลือก)' : 'เลือกสาขาก่อน'); return; }
    return run('เพิ่มแล้ว และ josh ใช้ราคานี้แล้ว', () => staffPricesApi.create({ kind, ...(kind === 'customer' ? { companyId: scope.company_id } : { branchId: scope.branch_id }), sku: form.sku, ...body }));
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>ราคาลูกค้า / ราคาสัญญา</h1>
          <p>commerce เป็นที่เก็บหลัก · ทุกการแก้ไขจะส่งให้ josh บันทึกผ่านโค้ดของ josh และล้าง cache ราคาให้ · ราคาที่ josh สร้างเอง (ใบเสนอราคาจาก ERP, คำขอราคาจาก CS) จะถูกดึงเข้ามาด้วยปุ่มดึงจาก josh</p>
        </div>
        <div className="row">
          <button className="btn ghost" disabled={busy} onClick={() => run((r: { added: number; changedInJosh: number; removedInJosh: number }) => `ดึงจาก josh: ใหม่ ${r.added} · josh แก้ ${r.changedInJosh} · josh ลบ ${r.removedInJosh}`, staffPricesApi.importFromJosh)}>ดึงจาก josh</button>
          <button className="btn ghost" onClick={reload}>Refresh</button>
        </div>
      </div>
      {msg && <div className="hint" style={{ marginBottom: 8 }}>{msg}</div>}
      {(list.error || summary.error) && <div className="err">{list.error || summary.error}</div>}
      <div className="stat-grid">
        {(Object.keys(KIND) as Kind[]).map((k) => (
          <button key={k} type="button" className="stat" aria-pressed={kind === k} onClick={() => { setKind(k); setPage(1); setEditing(null); }}
            style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', borderColor: kind === k ? 'var(--accent)' : undefined }}>
            <div className="label">{KIND[k]}</div><div className="value">{count(k, 'synced') + count(k, 'pending') + count(k, 'failed')}</div>
            <div className="hint">ส่งไม่สำเร็จ {count(k, 'failed')} · กำลังส่ง {count(k, 'pending')}</div>
          </button>
        ))}
      </div>

      <section className="panel" style={{ marginTop: 12 }}>
        <form className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); setBranchQ(branchSearch.trim()); }}>
          <label className="field">{kind === 'customer' ? 'บริษัท' : 'สาขา'} (ค้นจากชื่อบริษัท / สาขา / รหัสลูกค้า)<input value={branchSearch} onChange={(e) => setBranchSearch(e.target.value)} /></label>
          <button className="btn">ค้นหา</button>
          {scope && <span className="hint">เลือกแล้ว: <b>{kind === 'customer' ? scope.company_name : `${scope.company_name} › ${scope.branch_name}`}</b> <button type="button" className="btn ghost sm" onClick={() => setScope(null)}>ล้าง</button></span>}
        </form>
        {!!branches.data?.length && !scope && (
          <div className="row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
            {branches.data.slice(0, 30).map((b) => <button key={b.branch_id} type="button" className="btn ghost sm" onClick={() => { setScope(b); setPage(1); }}>{b.company_name} › {b.branch_name}</button>)}
          </div>
        )}
      </section>

      <section className="panel" style={{ marginTop: 12 }}>
        <form className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }} onSubmit={save}>
          {!editing && <label className="field">SKU<input required value={form.sku ?? ''} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></label>}
          <label className="field">ราคา (บาท)<input required type="number" min={0} step="0.01" value={form.price ?? ''} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
          <label className="field">เริ่ม<input type="date" value={form.startDate ?? ''} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
          <label className="field">สิ้นสุด (ว่าง = ไม่มีกำหนด)<input type="date" value={form.endDate ?? ''} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
          {kind === 'contract' && <label className="field">เลขสัญญา<input value={form.contractRef ?? ''} onChange={(e) => setForm({ ...form, contractRef: e.target.value })} /></label>}
          <button className="btn" disabled={busy}>{editing ? 'บันทึกการแก้ไข' : `เพิ่ม${KIND[kind]}`}</button>
          {editing && <button type="button" className="btn ghost" onClick={() => { setEditing(null); setForm({}); }}>ยกเลิก</button>}
        </form>
      </section>

      <div className="row" style={{ margin: '12px 0', flexWrap: 'wrap' }}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); setPage(1); }}>
          <input placeholder="ค้น SKU" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="ค้น SKU" />
        </form>
        {[['', 'ทั้งหมด'], ['failed', 'ส่งไม่สำเร็จ'], ['pending', 'กำลังส่ง'], ['synced', 'josh ใช้แล้ว']].map(([k, l]) => (
          <button key={k} className={`btn sm ${status === k ? '' : 'ghost'}`} aria-selected={status === k} onClick={() => { setStatus(k); setPage(1); }}>{l}</button>
        ))}
      </div>
      {list.data && (
        <section className="panel" style={{ overflowX: 'auto' }}>
          {list.data.items.length ? (
            <table>
              <thead><tr><th>SKU</th><th>ราคา</th><th>ช่วงเวลา</th>{kind === 'contract' && <th>เลขสัญญา</th>}<th>สถานะ</th><th>แก้ล่าสุด</th><th></th></tr></thead>
              <tbody>{list.data.items.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.sku ?? r.productInventoryId}</td><td>{money(r.price)}</td><td>{r.startDate} – {r.endDate ?? 'ไม่มีกำหนด'}</td>
                  {kind === 'contract' && <td>{r.contractRef ?? '—'}</td>}
                  <td><span className={`badge ${STATUS[r.status]?.[1] ?? ''}`}>{STATUS[r.status]?.[0] ?? r.status}</span>{r.syncError && <div className="err" style={{ maxWidth: 280 }}>{r.syncError}</div>}</td>
                  <td>{r.updatedBy ?? '—'}<div className="hint">{new Date(r.updatedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</div></td>
                  <td className="row">
                    <button className="btn ghost sm" onClick={() => { setEditing(r.id); setForm({ price: String(r.price), startDate: r.startDate, endDate: r.endDate ?? '', contractRef: r.contractRef ?? '' }); }}>แก้</button>
                    {r.status !== 'synced' && <button className="btn ghost sm" disabled={busy} onClick={() => run('ส่งซ้ำแล้ว', () => staffPricesApi.retry(r.id))}>ส่งซ้ำ</button>}
                    <button className="btn ghost sm" disabled={busy} onClick={() => window.confirm(`ลบราคา ${r.sku} ${money(r.price)}? josh จะเลิกใช้ราคานี้ทันที`) && run('ลบแล้ว', () => staffPricesApi.remove(r.id))}>ลบ</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          ) : <div className="empty">ยังไม่มีราคา · กด "ดึงจาก josh" เพื่อนำราคาปัจจุบันของ josh เข้ามาครั้งแรก</div>}
        </section>
      )}
      {list.data && list.data.total > list.data.limit && (
        <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
          <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>
          <span className="hint">หน้า {page} / {Math.ceil(list.data.total / list.data.limit)}</span>
          <button className="btn ghost sm" disabled={page >= Math.ceil(list.data.total / list.data.limit)} onClick={() => setPage(page + 1)}>ถัดไป</button>
        </div>
      )}
    </div>
  );
}
