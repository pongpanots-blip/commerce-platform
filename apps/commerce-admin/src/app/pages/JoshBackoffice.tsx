import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { backofficeApi, BackofficeColumn } from '../../lib/api';
import { useAsync } from '../hooks';
import { ACTION_VIEWS, RowAction, ViewCreate } from './JoshBackofficeActions';

const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function cell(col: BackofficeColumn, v: unknown) {
  if (v === null || v === undefined || v === '') return <span className="hint">—</span>;
  switch (col.kind) {
    case 'money': return money.format(Number(v));
    case 'number': return Number(v).toLocaleString('th-TH');
    case 'datetime': return new Date(String(v)).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
    case 'date': return String(v).slice(0, 10);
    case 'bool': return v ? '✓' : '—';
    case 'status': return <span className="badge">{String(v)}</span>;
    case 'code': return <span className="mono">{String(v)}</span>;
    default: return String(v);
  }
}

/**
 * josh back-office lists, read-only from josh's replica (KYC, credit, CN/CB, shipments, payments,
 * coupons, campaigns, segments, suppliers, admin access). Columns come from the API, keyed by josh's
 * column names. Changes still happen in josh's web-admin.
 */
export function JoshBackoffice() {
  const { view = 'kyc' } = useParams();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState('');
  useEffect(() => { setSearch(''); setQ(''); setStatus(''); setPage(1); setMsg(''); }, [view]);
  const list = useAsync(() => backofficeApi.list(view, { search: q, status, page }), [view, q, status, page]);
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.limit)) : 1;
  const all = d?.byStatus.reduce((a, s) => a + s.n, 0) ?? 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{d?.title ?? '…'} <span className="hint">(josh)</span></h1>
          <p>{ACTION_VIEWS.has(view) ? 'ดูจาก josh · ปุ่มในตารางสั่งให้ josh ทำ (ตามสิทธิ์ใน josh)' : 'อ่านอย่างเดียวจาก josh'} · แก้ไขอื่นๆ ยังทำที่ web-admin ของ josh{d && <> (<span className="mono">{d.joshPage}</span>)</>} · เบอร์ อีเมล ชื่อคน ถูกปิดบัง</p>
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); setQ(search.trim()); setPage(1); }}>
          <input placeholder="ค้นหา…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="ค้นหา" />
          <button className="btn">ค้นหา</button>
          <button type="button" className="btn ghost" onClick={list.reload}>Refresh</button>
        </form>
      </div>
      <div style={{ marginBottom: 8 }}><ViewCreate key={view} view={view} onDone={(m) => { setMsg(m); list.reload(); }} /></div>
      {msg && <div className="hint" style={{ marginBottom: 8 }}>{msg}</div>}
      {list.error && <div className="err">{list.error}</div>}
      {!!d?.byStatus.length && (
        <div className="row" role="tablist" style={{ margin: '0 0 12px', flexWrap: 'wrap' }}>
          <button className={`btn sm ${status === '' ? '' : 'ghost'}`} aria-selected={status === ''} onClick={() => { setStatus(''); setPage(1); }}>ทั้งหมด ({all})</button>
          {d.byStatus.map((s) => s.status && (
            <button key={s.status} className={`btn sm ${status === s.status ? '' : 'ghost'}`} aria-selected={status === s.status} onClick={() => { setStatus(s.status!); setPage(1); }}>{s.status} ({s.n})</button>
          ))}
        </div>
      )}
      {d && (
        <section className="panel" style={{ overflowX: 'auto' }}>
          {d.items.length ? (
            <table>
              <thead><tr>{ACTION_VIEWS.has(view) && <th></th>}{d.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>{d.items.map((r, i) => <tr key={i}>{ACTION_VIEWS.has(view) && <td><RowAction view={view} row={r} onDone={(m) => { setMsg(m); list.reload(); }} /></td>}{d.columns.map((c) => <td key={c.key}>{cell(c, r[c.key])}</td>)}</tr>)}</tbody>
            </table>
          ) : <div className="empty">ไม่มีรายการ</div>}
        </section>
      )}
      {d && d.total > d.limit && (
        <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
          <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>
          <span className="hint">หน้า {page} / {pages} · {d.total.toLocaleString('th-TH')} รายการ</span>
          <button className="btn ghost sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>ถัดไป</button>
        </div>
      )}
    </div>
  );
}
