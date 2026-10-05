import { useState } from 'react';
import { livechatApi } from '../../lib/api';
import { useAsync } from '../hooks';

/**
 * Shop live chat that commerce relays between josh and CS-CRM (josh LIVECHAT_VIA_COMMERCE + CS-CRM
 * pointing its outbound webhook here). Agents keep answering in CS-CRM; this is the record.
 */
export function Livechat() {
  const [visitor, setVisitor] = useState('');
  const [page, setPage] = useState(1);
  const list = useAsync(() => livechatApi.list(visitor, page), [visitor, page]);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / 100)) : 1;
  return (
    <div>
      <div className="page-head"><div><h1>Live chat</h1>
        <p>ข้อความแชตหน้าร้านที่วิ่งผ่าน commerce (ลูกค้า → CS-CRM และคำตอบ → ลูกค้า) · CS ยังตอบใน CS-CRM</p></div></div>
      {visitor && <div className="row" style={{ marginBottom: 8 }}><span className="hint">เฉพาะผู้เยี่ยมชม <span className="mono">{visitor}</span></span>
        <button className="btn ghost sm" onClick={() => { setVisitor(''); setPage(1); }}>ดูทั้งหมด</button></div>}
      {list.error && <div className="err">{list.error}</div>}
      {list.data && (
        <section className="panel" style={{ overflowX: 'auto' }}>
          {list.data.items.length ? (
            <table><thead><tr><th>เวลา</th><th>ทาง</th><th>ผู้เยี่ยมชม</th><th>ข้อความ</th><th>ผล</th></tr></thead>
              <tbody>{list.data.items.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.createdAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' })}</td>
                  <td>{r.direction === 'to_cs_crm' ? 'ลูกค้า → CS' : 'CS → ลูกค้า'}</td>
                  <td>{r.visitorId ? <button className="btn ghost sm mono" onClick={() => { setVisitor(r.visitorId!); setPage(1); }}>{r.visitorId.slice(0, 12)}</button> : '—'}</td>
                  <td>{r.text ?? '—'}</td>
                  <td><span className={`badge ${r.status < 300 ? 'ok' : 'danger'}`}>{r.status}</span></td>
                </tr>
              ))}</tbody></table>
          ) : <div className="empty">ยังไม่มีข้อความผ่าน commerce</div>}
        </section>
      )}
      {pages > 1 && <div className="row" style={{ marginTop: 8, gap: 8 }}>
        <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</button><span className="hint">หน้า {page} / {pages}</span>
        <button className="btn ghost sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>ถัดไป</button></div>}
    </div>
  );
}
