import { useState } from 'react';
import { orderQuoteApi, priceShadowApi } from '../../lib/api';
import { useAsync } from '../hooks';

const when = (v: string | null) => (v ? new Date(v).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const money = (v: string | null) => (v == null ? '—' : Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2 }));
const DIFF: Record<string, string> = { price: 'ราคา', source: 'แหล่งราคา', mechanic: 'โปรโมชัน' };

/**
 * Step 3 trial: commerce re-prices every new josh order line with josh's own price code (copied)
 * and compares with what josh charged. Nothing is written to josh.
 */
export function PriceShadow() {
  const [days, setDays] = useState(7);
  const [filter, setFilter] = useState('mismatched');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const summary = useAsync(() => priceShadowApi.summary(days), [days]);
  const list = useAsync(() => priceShadowApi.list(filter, page), [filter, page]);
  const s = summary.data;
  const refresh = () => { summary.reload(); list.reload(); };

  async function act(label: string, fn: () => Promise<unknown>, done: (r: never) => string) {
    setBusy(label); setMsg('');
    try { setMsg(done((await fn()) as never)); refresh(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>ราคา · commerce คิดคู่กับ josh (ทดลอง)</h1>
          <p>ทุกบรรทัดใน order ใหม่ของ josh · commerce คิดราคาใหม่ด้วยโค้ดราคาของ josh (สำเนา) ตามบริษัท สาขา จำนวน และเวลาที่สั่ง แล้วเทียบกับที่ josh เก็บจริง · <b>ไม่แก้อะไรใน josh</b></p>
        </div>
        <div className="row">
          <button className="btn" disabled={!!busy} onClick={() => act('run', priceShadowApi.run, (r: { checked: number }) => `ตรวจเพิ่ม ${r.checked} บรรทัด`)}>{busy === 'run' ? 'กำลังตรวจ…' : 'ตรวจตอนนี้'}</button>
          <button className="btn ghost" onClick={refresh}>Refresh</button>
        </div>
      </div>
      {msg && <div className="hint" style={{ marginBottom: 8 }}>{msg}</div>}
      {(summary.error || list.error) && <div className="err">{summary.error || list.error}</div>}
      {s && (
        <div className="stat-grid">
          <div className="stat"><div className="label">ตรง ({days} วัน)</div><div className="value">{s.matchRate == null ? '—' : `${s.matchRate}%`}</div><div className="hint">{s.matched} / {s.checked} บรรทัด</div></div>
          <div className="stat"><div className="label">ไม่ตรง</div><div className={`value${s.mismatched ? ' attn' : ''}`}>{s.mismatched}</div><div className="hint">ในนี้ {s.changed_after} บรรทัดราคาถูกแก้หลังสั่ง</div></div>
          <div className="stat"><div className="label">commerce คิดไม่ได้</div><div className={`value${s.could_not_price ? ' attn' : ''}`}>{s.could_not_price}</div></div>
          <div className="stat"><div className="label">ช่วงที่ตรวจ</div><div className="hint" style={{ marginTop: 10 }}>{when(s.first_at)} – {when(s.last_at)}</div>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ marginTop: 6 }}>{[1, 7, 30].map((d) => <option key={d} value={d}>{d} วัน</option>)}</select></div>
        </div>
      )}
      {!!s?.mismatchBySource.length && <p className="hint" style={{ marginTop: 8 }}>ไม่ตรงบ่อย: {s.mismatchBySource.map((m) => `josh ${m.josh_source ?? '—'} → commerce ${m.commerce_source ?? '—'} (${m.n})`).join(' · ')}</p>}
      <div className="row" role="tablist" style={{ margin: '12px 0' }}>
        {[['mismatched', 'ไม่ตรง / คิดไม่ได้'], ['matched', 'ตรง'], ['all', 'ทั้งหมด']].map(([k, label]) => (
          <button key={k} className={`btn sm ${filter === k ? '' : 'ghost'}`} aria-selected={filter === k} onClick={() => { setFilter(k); setPage(1); }}>{label}</button>
        ))}
      </div>
      {list.data && (
        <section className="panel" style={{ overflowX: 'auto' }}>
          {list.data.items.length ? (
            <table>
              <thead><tr><th>Order</th><th>SKU</th><th>จำนวน</th><th>สั่งเมื่อ</th><th>josh</th><th>commerce</th><th>ผล</th><th></th></tr></thead>
              <tbody>{list.data.items.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.orderNumber}</td><td className="mono">{r.sku}</td><td>{r.quantity}</td><td>{when(r.orderedAt)}</td>
                  <td>{money(r.joshUnitPrice)} <span className="hint">{r.joshSource ?? '—'}</span></td>
                  <td>{money(r.commerceUnitPrice)} <span className="hint">{r.commerceSource ?? '—'}</span></td>
                  <td><span className={`badge ${r.matched ? 'ok' : 'danger'}`}>{r.matched ? 'ตรง' : `ต่าง: ${r.diffs.map((d) => DIFF[d] ?? d).join(', ') || 'คิดไม่ได้'}`}</span>{r.note && <div className="hint">{r.note}</div>}</td>
                  <td><button className="btn ghost sm" disabled={!!busy} onClick={() => act(r.id, () => priceShadowApi.recheck(r.joshOrderItemId), (x: { matched: boolean }) => `ตรวจซ้ำ: ${x.matched ? 'ตรง' : 'ยังไม่ตรง'}`)}>ตรวจซ้ำ</button></td>
                </tr>
              ))}</tbody>
            </table>
          ) : <div className="empty">{filter === 'mismatched' ? 'ไม่มีบรรทัดที่ไม่ตรง' : 'ยังไม่มีรายการ'}</div>}
        </section>
      )}
      {list.data && list.data.total > 50 && (
        <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
          <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>
          <span className="hint">หน้า {page} / {Math.ceil(list.data.total / 50)}</span>
          <button className="btn ghost sm" disabled={page >= Math.ceil(list.data.total / 50)} onClick={() => setPage(page + 1)}>ถัดไป</button>
        </div>
      )}
      <OrderQuotes />
    </div>
  );
}

const FIELD: Record<string, string> = { total_price: 'ยอดสุทธิ', subtotal_ex_vat: 'ยอดก่อน VAT', vat_amount: 'VAT', delivery_fee: 'ค่าส่ง',
  discount_amount: 'ส่วนลด (ก่อน VAT)', discount_inc_vat: 'ส่วนลด (รวม VAT)', product_discount_ex_vat: 'ส่วนลดสินค้า', gross_ex_vat: 'ยอดก่อนส่วนลด' };

/**
 * Checkout step 1 (shadow quote): each josh order's totals rebuilt with josh's checkout math — VAT split,
 * groups by fulfillment type, delivery fee rule, discount spread. Line prices are the section above.
 */
function OrderQuotes() {
  const [filter, setFilter] = useState('mismatched');
  const [busy, setBusy] = useState(false);
  const summary = useAsync(() => orderQuoteApi.summary(7), []);
  const list = useAsync(() => orderQuoteApi.list(filter, 1), [filter]);
  const s = summary.data;
  async function runNow() {
    setBusy(true);
    try { await orderQuoteApi.run(); summary.reload(); list.reload(); } finally { setBusy(false); }
  }
  return (
    <section style={{ marginTop: 28 }}>
      <div className="page-head">
        <div>
          <h2>ยอดรวม order · commerce คิดคู่กับ josh</h2>
          <p>commerce คิดยอดของทุก order ใหม่ของ josh ด้วยสูตร checkout ของ josh (VAT ค่าส่ง ส่วนลด ยอดสุทธิ) แล้วเทียบ · ส่วนลดคูปองใช้ตัวเลขที่ josh คิด · ไม่ส่งอะไรให้ josh</p>
        </div>
        <button className="btn sm" disabled={busy} onClick={runNow}>{busy ? 'กำลังคิด…' : 'คิดตอนนี้'}</button>
      </div>
      {(summary.error || list.error) && <div className="err">{summary.error || list.error}</div>}
      {s && (
        <div className="stat-grid">
          <div className="stat"><div className="label">ตรงกัน (7 วัน)</div><div className={`value${s.matchRate != null && s.matchRate < 100 ? ' attn' : ''}`}>{s.matchRate == null ? '—' : `${s.matchRate}%`}</div><div className="hint">{s.matched} / {s.checked} order</div></div>
          <div className="stat"><div className="label">ไม่ตรง</div><div className="value">{s.mismatched}</div>
            <div className="hint">{s.mismatchByField.map((f) => `${FIELD[f.field] ?? f.field} ${f.n}`).join(' · ') || '—'}</div></div>
        </div>
      )}
      <div className="row" style={{ margin: '12px 0' }}>
        {[['mismatched', 'ไม่ตรง'], ['matched', 'ตรง'], ['all', 'ทั้งหมด']].map(([k, label]) => (
          <button key={k} className={`btn sm ${filter === k ? '' : 'ghost'}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      {list.data && (
        <section className="panel">
          {list.data.items.length ? (
            <table>
              <thead><tr><th>Order</th><th>สั่งเมื่อ</th><th>ช่องที่ต่าง (josh → commerce)</th><th>หมายเหตุ</th></tr></thead>
              <tbody>{list.data.items.map((r) => (
                <tr key={r.id}><td className="mono">{r.orderNumber ?? r.joshOrderId}</td><td>{new Date(r.orderedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{r.matched ? <span className="badge ok">ตรง</span> : r.diffs.map((d) => `${FIELD[d.field] ?? d.field}: ${d.josh} → ${d.commerce}`).join(' · ')}</td><td>{r.note ?? '—'}</td></tr>
              ))}</tbody>
            </table>
          ) : <div className="empty">ไม่มีรายการ</div>}
        </section>
      )}
    </section>
  );
}
