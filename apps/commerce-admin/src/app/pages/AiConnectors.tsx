import { useState } from 'react';
import {
  Alert, Button, CopyValue, Empty, ErrorText, Icon, Loading, Page, PageHeader, Panel, PanelHead, SectionTitle,
  Table, TBody, TD, TH, THead, TR, fmt,
} from '@cp/ui';
import { mcpApi, McpConnection } from '../../lib/api';
import { useAsync } from '../hooks';

const TOOL_LABEL: Record<string, string> = {
  competitor_prices: 'เทียบราคาคู่แข่ง', scraped_catalog_search: 'ค้นคลังเว็บคู่แข่ง', scraping_sources: 'เว็บที่เก็บข้อมูล',
  research_topics: 'โจทย์ research', research_report: 'รายงาน research', catalog_products: 'แค็ตตาล็อก josh',
  erp_intake_summary: 'สรุปข้อมูลจาก ERP', webhook_failures: 'event ที่ส่งไม่สำเร็จ', stock_levels: 'สต็อกต่อคลัง',
  research_create_topic: 'สร้างโจทย์ research', research_request_run: 'สั่งรัน research', competitor_record_price: 'บันทึกราคาคู่แข่ง',
  webhook_retry_delivery: 'ส่ง event ซ้ำ', erp_replay_ingest: 'replay ข้อมูล ERP',
  scraping_update_source: 'ตั้งค่าเก็บข้อมูลเว็บ', scraping_run: 'สั่งเริ่ม/หยุดเก็บข้อมูลเว็บ', stock_adjust: 'ปรับสต็อก',
};
const WRITE_TOOLS = new Set(['research_create_topic', 'research_request_run', 'competitor_record_price', 'webhook_retry_delivery', 'erp_replay_ingest', 'scraping_update_source', 'scraping_run', 'stock_adjust']);
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

  return (
    <Page>
      <PageHeader
        title="AI connectors (MCP)"
        subtitle="ให้ Claude หรือ ChatGPT อ่านและสรุปข้อมูลของ commerce ได้"
        actions={<Button icon="refresh" onClick={() => { info.reload(); activity.reload(); }}>Refresh</Button>}
      />

      {note && <Alert tone={note.ok ? 'ok' : 'danger'}>{note.text}</Alert>}
      <ErrorText error={info.error} />

      <Panel>
        <PanelHead title="ขั้นตอนการเชื่อมต่อ" />
        {info.loading ? (
          <Loading />
        ) : !info.data ? (
          <Empty icon="error">โหลดสถานะไม่สำเร็จ</Empty>
        ) : info.data.enabled ? (
          <div className="space-y-4 p-4">
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">MCP URL</h3>
              <CopyValue value={info.data.mcpUrl!} className="flex" />
            </div>
            <div className="space-y-3">
              {STEPS.map((s, i) => (
                <div key={s.app}>
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-on-primary flex-shrink-0">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-on-surface">{s.app}</p>
                      <p className="text-[11px] text-on-surface-variant mt-0.5">{s.how}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Alert tone="danger">MCP ยังไม่เปิดบนเซิร์ฟเวอร์นี้ — ตั้ง MCP_PUBLIC_URL (ดู docs/mcp.md)</Alert>
        )}
      </Panel>

      <Panel>
        <PanelHead title={admin ? 'AI ที่เชื่อมต่อ (ทุกบัญชี)' : 'AI ที่เชื่อมต่อกับบัญชีของคุณ'} />
        {info.loading ? (
          <Loading />
        ) : !info.data?.connections.length ? (
          <Empty>ยังไม่มี AI เชื่อมต่อ</Empty>
        ) : (
          <Table>
            <THead>
              <TH>แอป AI</TH>
              {admin && <TH>บัญชี</TH>}
              <TH>สถานะ</TH>
              <TH right>ใช้ล่าสุด</TH>
              <TH right>เรียกข้อมูล</TH>
              <TH right>เชื่อมครั้งแรก</TH>
              <TH right />
            </THead>
            <TBody>
              {info.data.connections.map((c) => (
                <TR key={c.clientId + c.staffUserId}>
                  <TD>
                    <div className="font-medium">{c.clientName}</div>
                    <div className="text-[10px] font-mono text-on-surface-variant">{c.clientId.slice(0, 8)}</div>
                  </TD>
                  {admin && <TD>{c.staffEmail}</TD>}
                  <TD>
                    {c.liveSessions > 0 ? (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#e7f5ec] text-[#157347]">
                          <Icon name="check_circle" size={12} />
                          เชื่อมต่ออยู่
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.canWrite ? 'bg-[#fef7e0] text-[#b08900]' : 'bg-surface-container text-secondary'}`}>
                          {c.canWrite ? 'แก้ไขได้ (ต้องยืนยัน)' : 'อ่านอย่างเดียว'}
                        </span>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-surface-container text-secondary">หมดอายุ / ยกเลิกแล้ว</span>
                    )}
                  </TD>
                  <TD kind="time">{c.lastUsedAt ? fmt.when(c.lastUsedAt) : '—'}</TD>
                  <TD kind="num">{fmt.num(c.toolCalls)}</TD>
                  <TD kind="time">{fmt.when(c.firstSeenAt)}</TD>
                  <TD kind="actions">
                    {c.liveSessions > 0 && (
                      <Button variant="danger-ghost" size="sm" disabled={busy === c.clientId + c.staffUserId} onClick={() => revoke(c)}>
                        ยกเลิก
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      <Panel>
        <PanelHead title="AI ทำอะไรไปบ้าง" sub="ล่าสุด 50 ครั้ง" />
        <ErrorText error={activity.error} />
        {activity.loading ? (
          <Loading />
        ) : !activity.data?.length ? (
          <Empty>ยังไม่มีการเรียกข้อมูล</Empty>
        ) : (
          <Table>
            <THead>
              <TH>เวลา</TH>
              <TH>สิ่งที่ทำ</TH>
              <TH>เงื่อนไข</TH>
              <TH>แอป AI</TH>
              {admin && <TH>บัญชี</TH>}
            </THead>
            <TBody>
              {activity.data.map((a) => (
                <TR key={a.id}>
                  <TD kind="time">{fmt.when(a.at)}</TD>
                  <TD>
                    {a.isWrite && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fef7e0] text-[#b08900] mr-1">แก้ไข</span>}
                    <span>{TOOL_LABEL[a.tool] ?? a.tool}</span>
                    {!a.isWrite && WRITE_TOOLS.has(a.tool) && <div className="text-[10px] text-on-surface-variant">ขอดูตัวอย่าง ยังไม่ได้ทำ</div>}
                    <div className="text-[11px] font-mono text-on-surface-variant">{a.tool}</div>
                  </TD>
                  <TD kind="muted" className="font-mono text-[11px]">
                    {a.args && Object.keys(a.args).length ? JSON.stringify(a.args).slice(0, 50) : '—'}
                  </TD>
                  <TD>{a.clientName}</TD>
                  {admin && <TD>{a.staffEmail}</TD>}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </Page>
  );
}
