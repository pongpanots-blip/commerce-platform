import { FormEvent, useState } from 'react';
import { scrapingApi } from '../../lib/api';
import { useAsync } from '../hooks';

// Competitor price comparison stays in josh web-admin (it uses our own catalog prices).
const JOSH_ADMIN_URL = ((import.meta as unknown as { env: Record<string, string> }).env?.VITE_JOSH_ADMIN_URL ?? '').replace(/\/$/, '');
const money = (v: number | null) => (v == null ? '—' : `฿${v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** Products collected from competitor sites (moved from josh). */
export function ScrapedCatalog() {
  const sources = useAsync(() => scrapingApi.sources(), []);
  const [sourceId, setSourceId] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const items = useAsync(() => scrapingApi.items(sourceId, search, page), [sourceId, search, page]);

  function submit(e: FormEvent) { e.preventDefault(); setPage(1); setSearch(query.trim()); }
  const maxPage = items.data ? Math.max(1, Math.ceil(items.data.total / items.data.pageSize)) : 1;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>คลังข้อมูลเว็บคู่แข่ง</h1>
          <p>สินค้าและราคาที่เก็บจากเว็บสาธารณะ · จับคู่กับ SKU ของเราที่หน้าเทียบราคาใน josh admin</p>
        </div>
        <button className="btn ghost" type="button" onClick={items.reload}>Refresh</button>
      </div>

      <section className="panel">
        <form className="panel-head" onSubmit={submit} style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field">เว็บ
              <select value={sourceId} onChange={(e) => { setSourceId(e.target.value); setPage(1); }}>
                <option value="">ทั้งหมด</option>
                {(sources.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="field">ค้นหา
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ชื่อสินค้าหรือ SKU" />
            </label>
            <button className="btn ghost" type="submit">ค้นหา</button>
          </div>
          <span>
            <span className="hint">{items.data?.total ?? 0} รายการ</span>{' '}
            <button className="btn ghost sm" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>{' '}
            <span className="hint">{page} / {maxPage}</span>{' '}
            <button className="btn ghost sm" type="button" disabled={page >= maxPage} onClick={() => setPage(page + 1)}>ถัดไป</button>
          </span>
        </form>
        {items.error && <div className="err" style={{ padding: 16 }}>{items.error}</div>}
        {items.loading ? <div className="empty">Loading…</div> : !items.data?.items.length ? <div className="empty">ยังไม่มีข้อมูล</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>สินค้า</th><th>เว็บ</th><th>ราคา (รวม VAT)</th><th>น้ำหนัก</th><th>พบเมื่อ</th><th></th></tr></thead>
              <tbody>
                {items.data.items.map((item) => (
                  <tr key={item.id}>
                    <td><a href={item.url} target="_blank" rel="noreferrer">{item.name}</a>{item.sku && <div className="hint mono">{item.sku}</div>}{!item.configCurrent && <div className="hint">ตั้งค่าเว็บเปลี่ยนหลังเก็บ — ควรเก็บใหม่</div>}</td>
                    <td>{item.source?.name ?? '—'}</td>
                    <td>{item.currency === 'THB' ? money(item.priceIncVat) : `${item.priceIncVat ?? '—'} ${item.currency}`}</td>
                    <td>{item.weightKg == null ? 'ไม่ชัดเจน' : `${item.weightKg} กก.`}</td>
                    <td>{new Date(item.observedAt).toLocaleString('th-TH')}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {JOSH_ADMIN_URL
                        ? <a className="btn ghost sm" href={`${JOSH_ADMIN_URL}/marketing/competitor-prices?catalogItem=${item.id}`}>จับคู่ SKU ของเรา ↗</a>
                        : <span className="hint">ตั้ง VITE_JOSH_ADMIN_URL</span>}
                    </td>
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
