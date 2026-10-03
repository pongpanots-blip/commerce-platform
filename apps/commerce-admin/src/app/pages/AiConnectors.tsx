import { useState } from 'react';
import { mcpApi, McpConnection } from '../../lib/api';
import { useAsync } from '../hooks';

const when = (v: string | null) => (v ? new Date(v).toLocaleString('th-TH') : '—');
const TOOL_LABEL: Record<string, string> = {
  competitor_prices: 'เทียบราคาคู่แข่ง', scraped_catalog_search: 'ค้นคลังเว็บคู่แข่ง', scraping_sources: 'เว็บที่เก็บข้อมูล',
  research_topics: 'โจทย์ research', research_report: 'รายงาน research', catalog_products: 'แค็ตตาล็อก josh',
  erp_intake_summary: 'สรุปข้อมูลจาก ERP', webhook_failures: 'event ที่ส่งไม่สำเร็จ', stock_levels: 'สต็อกต่อคลัง',
  research_create_topic: 'สร้างโจทย์ research', research_request_run: 'สั่งรัน research', competitor_record_price: 'บันทึกราคาคู่แข่ง',
  webhook_retry_delivery: 'ส่ง event ซ้ำ', erp_replay_ingest: 'replay ข้อมูล ERP',
};
const WRITE_TOOLS = new Set(['research_create_topic', 'research_request_run', 'competitor_record_price', 'webhook_retry_delivery', 'erp_replay_ingest']);
const STEPS = [
  { app: 'Claude (claude.ai / Desktop)', how: 'Settings → Connectors → Add custom connector → วาง URL → Connect' },
  { app: 'ChatGPT', how: 'Settings → Connectors (เปิด developer mode) → Create → วาง URL, Authentication = OAuth' },
  { app: 'Claude Code', how: 'claude mcp add --transport http commerce <URL> แล้วพิมพ์ /mcp เพื่อ login' },
];

/** AI connectors (MCP): how to connect, who is connected, and what the AI has read. */
export function AiConnectors() {
  const info = useAsync(() => mcpApi.connections(), []);
  const activity = useAsync(() => mcpApi.activity(50), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const admin = info.data?.role === 'admin';

  async function revoke(c: McpConnection) {
    if (!window.confirm(`ยกเลิกการเชื่อมต่อ ${c.clientName} ของ ${c.staffEmail}? AI จะใช้ข้อมูลต่อไม่ได้ทันที ต้อง login ใหม่ถ้าจะใช้อีก`)) return;
    setBusy(c.clientId + c.staffUserId); setNote(null);
    try {
      const r = await mcpApi.revoke(c);
      setNote({ ok: true, text: `ยกเลิกแล้ว (${r.revoked} token)` });
      info.reload();
    } catch (e) { setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: the URL is selectable */ }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>AI connectors (MCP)</h1>
          <p>ให้ Claude หรือ ChatGPT อ่านและสรุปข้อมูลของ commerce ได้ · อ่านอย่างเดียว แก้ไขหรือสั่งงานไม่ได้ · เห็นข้อมูลตามสิทธิ์ของบัญชีที่ login</p>
        </div>
        <button className="btn ghost" type="button" onClick={() => { info.reload(); activity.reload(); }}>Refresh</button>
      </div>

      {note && <div className={note.ok ? 'hint' : 'err'} role="status" style={{ marginBottom: 12 }}>{note.text}</div>}
      {info.error && <div className="err" style={{ marginBottom: 12 }}>{info.error}</div>}

      <section className="panel">
        <div className="panel-head">เชื่อมต่อ</div>
        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          {info.loading || !info.data ? <div className="hint">{info.loading ? 'Loading…' : 'โหลดสถานะไม่สำเร็จ'}</div> : info.data.enabled ? (
            <div className="row" style={{ alignItems: 'center' }}>
              <code className="mono" style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6, userSelect: 'all', wordBreak: 'break-all' }}>{info.data.mcpUrl}</code>
              <button className="btn sm" type="button" onClick={() => copy(info.data!.mcpUrl!)}>{copied ? 'คัดลอกแล้ว' : 'คัดลอก URL'}</button>
            </div>
          ) : <div className="err">MCP ยังไม่เปิดบนเซิร์ฟเวอร์นี้ — ตั้ง MCP_PUBLIC_URL (ดู docs/mcp.md)</div>}
          <table>
            <tbody>{STEPS.map((s) => <tr key={s.app}><td style={{ whiteSpace: 'nowrap' }}><strong>{s.app}</strong></td><td className="hint">{s.how}</td></tr>)}</tbody>
          </table>
          <div className="hint">ตอนเชื่อมต่อจะเปิดหน้า login ของ commerce — ใช้บัญชี staff เดียวกับหน้านี้ · ติ๊ก "อนุญาตให้แก้ไข" ถ้าต้องการให้ AI สร้าง/สั่งรัน research, บันทึกราคาคู่แข่ง{admin ? ', ส่ง event ซ้ำ, replay ERP' : ''} (ทุกครั้ง AI ต้องแสดงสิ่งที่จะทำและรอคุณยืนยัน) · ใช้ได้: เทียบราคาคู่แข่ง, คลังเว็บ, research, แค็ตตาล็อก{admin ? ' และของ admin: ERP, dead-letter, สต็อกต่อคลัง' : ''}</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">{admin ? 'AI ที่เชื่อมต่อ (ทุกบัญชี)' : 'AI ที่เชื่อมต่อกับบัญชีของคุณ'}</div>
        {info.loading ? <div className="empty">Loading…</div> : !info.data?.connections.length ? <div className="empty">ยังไม่มี AI เชื่อมต่อ</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>แอป AI</th>{admin && <th>บัญชี</th>}<th>สถานะ</th><th>ใช้ล่าสุด</th><th>เรียกข้อมูล</th><th>เชื่อมครั้งแรก</th><th></th></tr></thead>
              <tbody>
                {info.data.connections.map((c) => (
                  <tr key={c.clientId + c.staffUserId}>
                    <td><strong>{c.clientName}</strong><div className="hint mono">{c.clientId.slice(0, 8)}</div></td>
                    {admin && <td>{c.staffEmail}</td>}
                    <td>{c.liveSessions > 0 ? <><span className="badge ok">เชื่อมต่ออยู่</span>{' '}<span className={c.canWrite ? 'badge warn' : 'badge muted'}>{c.canWrite ? 'แก้ไขได้ (ต้องยืนยัน)' : 'อ่านอย่างเดียว'}</span></> : <span className="badge muted">หมดอายุ / ยกเลิกแล้ว</span>}</td>
                    <td>{when(c.lastUsedAt)}</td>
                    <td className="mono">{c.toolCalls.toLocaleString()} ครั้ง</td>
                    <td>{when(c.firstSeenAt)}</td>
                    <td style={{ textAlign: 'right' }}>{c.liveSessions > 0 && (
                      <button className="btn ghost sm" type="button" style={{ color: 'var(--danger)' }} disabled={busy === c.clientId + c.staffUserId} onClick={() => revoke(c)}>ยกเลิกการเชื่อมต่อ</button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">AI ทำอะไรไปบ้าง (ล่าสุด 50 ครั้ง)</div>
        {activity.error && <div className="err" style={{ padding: 16 }}>{activity.error}</div>}
        {activity.loading ? <div className="empty">Loading…</div> : !activity.data?.length ? <div className="empty">ยังไม่มีการเรียกข้อมูล</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>เวลา</th><th>สิ่งที่ทำ</th><th>เงื่อนไข</th><th>แอป AI</th>{admin && <th>บัญชี</th>}</tr></thead>
              <tbody>
                {activity.data.map((a) => (
                  <tr key={a.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{when(a.at)}</td>
                    <td>{a.isWrite && <><span className="badge warn">แก้ไข</span>{' '}</>}{TOOL_LABEL[a.tool] ?? a.tool}{!a.isWrite && WRITE_TOOLS.has(a.tool) && <span className="hint"> · ขอดูตัวอย่าง ยังไม่ได้ทำ</span>}<div className="hint mono">{a.tool}</div></td>
                    <td className="hint mono" style={{ maxWidth: 320, wordBreak: 'break-word' }}>{a.args && Object.keys(a.args).length ? JSON.stringify(a.args) : '—'}</td>
                    <td>{a.clientName}</td>
                    {admin && <td>{a.staffEmail}</td>}
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
