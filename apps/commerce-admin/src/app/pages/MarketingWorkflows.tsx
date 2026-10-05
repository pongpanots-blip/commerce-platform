import { FormEvent, Fragment, useState } from 'react';
import { WorkflowRow, workflowsApi } from '../../lib/api';
import { useAsync } from '../hooks';

const STATUS: Record<WorkflowRow['status'], [string, string]> = { active: ['ทำงาน', 'ok'], paused: ['หยุด', 'warn'], draft: ['ร่าง', ''] };
const when = (v: string | null) => (v ? new Date(v).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
/** Fields of josh's UpdateMarketingWorkflowDto that are edited as JSON here. */
const EDITABLE = ['name', 'trigger_type', 'trigger_config', 'steps', 'schedule', 'cooldown_days', 'holdout_percent', 'conversion_window_days', 'exit_on_goal'];

/**
 * josh marketing automations. Read from josh's replica; activate / pause / edit are done by josh's own
 * MarketingWorkflowService (josh COMMERCE_OWNS_MARKETING_WORKFLOWS=true locks josh admin's editing).
 * Enrolling customers and sending stay in josh; there is no test-send here.
 */
export function MarketingWorkflows() {
  const [days, setDays] = useState(30);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const list = useAsync(() => workflowsApi.list(days), [days]);
  const detail = useAsync(() => (open ? workflowsApi.detail(open) : Promise.resolve(null)), [open]);

  async function run(done: string, fn: () => Promise<unknown>) {
    setBusy(true); setMsg('');
    try { await fn(); setMsg(done); setEditing(null); list.reload(); detail.reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const toggle = (w: WorkflowRow) => {
    const action = w.status === 'active' ? 'pause' : 'activate';
    if (!window.confirm(`${action === 'pause' ? 'หยุด' : 'เปิด'} workflow "${w.name}"?\n\n${action === 'activate' ? 'josh จะเริ่มส่งข้อความให้ลูกค้าที่เข้าเงื่อนไขตามรอบของ josh' : 'ลูกค้าที่ค้างอยู่จะไม่ได้ข้อความขั้นต่อไปจนกว่าจะเปิดใหม่'}`)) return;
    run(`${action === 'pause' ? 'หยุด' : 'เปิด'} "${w.name}" แล้ว`, () => workflowsApi.setState(w.id, action));
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Marketing workflows</h1>
          <p>ระบบส่งข้อความอัตโนมัติของ josh · เปิด/หยุด/แก้ที่นี่ → josh บันทึกเอง (ตรวจเงื่อนไข เก็บประวัติแก้ไข) · การส่งจริงยังเป็นรอบของ josh</p>
        </div>
        <label className="row" style={{ gap: 6 }}>ช่วง
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 90].map((d) => <option key={d} value={d}>{d} วัน</option>)}</select>
        </label>
      </div>
      {msg && <div className="hint" role="status">{msg}</div>}
      {list.error && <div className="err">{list.error}</div>}
      {list.data && (
        <section className="panel" style={{ overflowX: 'auto' }}>
          {list.data.length ? (
            <table>
              <thead><tr><th>Workflow</th><th>สถานะ</th><th>เริ่มเมื่อ</th><th>เข้า</th><th>กำลังไป</th><th>ล้มเหลว</th><th>ซื้อ (conversion)</th><th>รอบล่าสุด</th><th></th></tr></thead>
              <tbody>{list.data.map((w) => (
                <Fragment key={w.id}>
                  <tr>
                    <td>{w.name}</td>
                    <td><span className={`badge ${STATUS[w.status]?.[1] ?? ''}`}>{STATUS[w.status]?.[0] ?? w.status}</span></td>
                    <td className="mono">{w.trigger_type}</td>
                    <td>{w.enrolled ?? 0}</td><td>{w.running ?? 0}</td>
                    <td className={w.failed ? 'attn' : ''}>{w.failed ?? 0}</td>
                    <td>{w.converted ?? 0}{w.enrolled ? ` (${Math.round(((w.converted ?? 0) / w.enrolled) * 100)}%)` : ''}</td>
                    <td>{when(w.last_run_at)}{w.failed_runs ? <div className="hint">ล้มเหลว {w.failed_runs} รอบ</div> : null}</td>
                    <td className="row" style={{ gap: 4 }}>
                      <button className="btn ghost sm" onClick={() => setOpen(open === w.id ? null : w.id)}>{open === w.id ? 'ซ่อน' : 'ดู'}</button>
                      <button className="btn ghost sm" disabled={busy} onClick={() => { setOpen(w.id); setEditing(w.id); }}>แก้</button>
                      <button className={`btn sm ${w.status === 'active' ? 'ghost' : ''}`} disabled={busy} onClick={() => toggle(w)}>{w.status === 'active' ? 'หยุด' : 'เปิด'}</button>
                    </td>
                  </tr>
                  {open === w.id && <tr><td colSpan={9}>{detail.error ? <div className="err">{detail.error}</div> : !detail.data ? 'Loading…' : editing === w.id ? (
                    <EditJson initial={JSON.stringify(Object.fromEntries(EDITABLE.filter((k) => k in detail.data!).map((k) => [k, detail.data![k]])), null, 2)}
                      busy={busy} onCancel={() => setEditing(null)} onSave={(v) => run(`บันทึก "${w.name}" แล้ว`, () => workflowsApi.update(w.id, v))} />
                  ) : (
                    <div style={{ display: 'grid', gap: 10 }}>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{detail.data.enrollmentsByStatus.map((s) => <span key={s.status} className="badge">{s.status}: {s.n}</span>)}</div>
                      {!!detail.data.recentFailures.length && <div><div className="hint">ส่งไม่สำเร็จล่าสุด</div>
                        <table><tbody>{detail.data.recentFailures.map((f, i) => <tr key={i}><td>{when(f.created_at)}</td><td className="mono">{f.action_kind}</td><td className="mono">{JSON.stringify(f.detail)}</td></tr>)}</tbody></table></div>}
                      {!!detail.data.recentRuns.length && <div><div className="hint">รอบที่รันล่าสุด</div>
                        <table><tbody>{detail.data.recentRuns.map((r, i) => <tr key={i}><td>{when(r.fired_at)}</td><td>{r.status}</td><td>{r.enrolled_count ?? 0} / {r.audience_count ?? 0} คน</td><td>{r.error_message ?? r.skip_reason ?? ''}</td></tr>)}</tbody></table></div>}
                      <div><div className="hint">ขั้นตอน (steps)</div><pre className="payload">{JSON.stringify(detail.data.steps, null, 2)}</pre></div>
                    </div>)}</td></tr>}
                </Fragment>
              ))}</tbody>
            </table>
          ) : <div className="empty">ยังไม่มี workflow</div>}
        </section>
      )}
    </div>
  );
}

function EditJson({ initial, busy, onSave, onCancel }: { initial: string; busy: boolean; onSave: (v: Record<string, unknown>) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [err, setErr] = useState('');
  function save(e: FormEvent) {
    e.preventDefault();
    let v: unknown;
    try { v = JSON.parse(text); } catch { return setErr('JSON ไม่ถูกต้อง'); }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return setErr('ต้องเป็น object');
    if (!window.confirm('บันทึกการแก้ workflow นี้ไปที่ josh? (josh เก็บฉบับเดิมไว้ใน revisions)')) return;
    onSave(v as Record<string, unknown>);
  }
  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 8 }}>
      <div className="hint">แก้แบบ JSON (รูปแบบเดียวกับ josh) · josh ตรวจเงื่อนไขก่อนบันทึก · ตัวแก้แบบกราฟยังอยู่ที่ josh</div>
      <textarea aria-label="workflow (JSON)" rows={16} className="mono" value={text} onChange={(e) => setText(e.target.value)} />
      {err && <div className="err">{err}</div>}
      <div className="row"><button className="btn sm" disabled={busy}>บันทึก</button><button type="button" className="btn ghost sm" onClick={onCancel}>ยกเลิก</button></div>
    </form>
  );
}
