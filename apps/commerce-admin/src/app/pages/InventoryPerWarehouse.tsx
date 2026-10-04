import { FormEvent, useState } from 'react';
import { inventoryOverviewApi } from '../../lib/api';
import { useAsync } from '../hooks';

const num = (v: number) => v.toLocaleString('th-TH');
const when = (v: string | null) => (v ? new Date(v).toLocaleString('th-TH') : '—');
const OWNER = { erp: 'ERP', commerce: 'commerce (คลังเรา)' } as const;

/** Stock by SKU and warehouse code, who owns each warehouse's stock, and the last ledger movement. */
export function InventoryPerWarehouse() {
  const [warehouse, setWarehouse] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const data = useAsync(() => inventoryOverviewApi.get(warehouse, search, page), [warehouse, search, page]);
  const maxPage = data.data ? Math.max(1, Math.ceil(data.data.total / data.data.pageSize)) : 1;
  const pick = (code: string) => { setWarehouse(code); setPage(1); };

  function submit(e: FormEvent) { e.preventDefault(); setPage(1); setSearch(query.trim()); }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Inventory per warehouse</h1>
          <p>สต็อกตาม SKU และคลัง · ERP = ยอดมาจาก ERP (ปรับใน ERP) · commerce = คลังของเรา (ปรับได้ใน commerce)</p>
        </div>
        <button className="btn ghost" type="button" onClick={data.reload}>Refresh</button>
      </div>

      {data.error && <div className="err" style={{ marginBottom: 12 }}>{data.error}</div>}

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        {(data.data?.warehouses ?? []).map((w) => (
          <button key={w.code} type="button" className="stat" onClick={() => pick(warehouse === w.code ? '' : w.code)}
            style={{ textAlign: 'left', cursor: 'pointer', outline: warehouse === w.code ? '2px solid var(--accent)' : undefined }}>
            <div className="label">{w.code} · {OWNER[w.stockSource] ?? w.stockSource}</div>
            <div className="value">{num(w.onHand)}</div>
            <div className="hint">{w.name} · {num(w.skus)} SKU · จอง {num(w.reserved)}</div>
          </button>
        ))}
      </div>

      <section className="panel">
        <form className="panel-head" onSubmit={submit} style={{ flexWrap: 'wrap', gap: 12 }}>
          <span className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field">คลัง
              <select value={warehouse} onChange={(e) => pick(e.target.value)}>
                <option value="">ทุกคลัง</option>
                {(data.data?.warehouses ?? []).map((w) => <option key={w.code} value={w.code}>{w.code} — {w.name}</option>)}
              </select>
            </label>
            <label className="field">ค้นหา
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SKU หรือชื่อสินค้า" />
            </label>
            <button className="btn ghost" type="submit">ค้นหา</button>
          </span>
          <span>
            <span className="hint">{num(data.data?.total ?? 0)} รายการ</span>{' '}
            <button className="btn ghost sm" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>{' '}
            <span className="hint">{page} / {maxPage}</span>{' '}
            <button className="btn ghost sm" type="button" disabled={page >= maxPage} onClick={() => setPage(page + 1)}>ถัดไป</button>
          </span>
        </form>
        {data.loading ? <div className="empty">Loading…</div> : !data.data?.items.length ? <div className="empty">ไม่พบสต็อก</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>SKU</th><th>สินค้า</th><th>คลัง</th><th style={{ textAlign: 'right' }}>คงเหลือ</th><th style={{ textAlign: 'right' }}>จอง</th><th style={{ textAlign: 'right' }}>พร้อมขาย</th><th>เปลี่ยนล่าสุด</th></tr></thead>
              <tbody>
                {data.data.items.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.sku}</td>
                    <td>{r.name}</td>
                    <td><span className="mono">{r.warehouseCode}</span> <span className={r.stockSource === 'commerce' ? 'badge ok' : 'badge muted'}>{OWNER[r.stockSource] ?? r.stockSource}</span></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(r.quantity)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(r.reserved)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: r.available <= 0 ? 'var(--danger)' : undefined }}>{num(r.available)}</td>
                    <td className="hint">{r.lastChangedAt ? <>{when(r.lastChangedAt)}<div>{r.lastSource}{r.lastReason ? ` · ${r.lastReason}` : ''}{r.lastStatus && r.lastStatus !== 'applied' ? ` · ${r.lastStatus}` : ''}</div></> : when(r.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
