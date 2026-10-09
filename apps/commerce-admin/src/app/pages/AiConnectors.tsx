// ui-caption-migration: literal captions only
// ui-metadata-migration: static labels and UI notices only
import { useState } from 'react';
import {
  Alert, Button, CopyValue, Empty, ErrorText, Icon, Loading, Page, PageHeader, Panel, PanelHead, SectionTitle,
  Table, TBody, TD, TH, THead, TR, fmt,
} from '@cp/ui';
import { mcpApi, McpConnection } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const TOOL_LABEL: Record<string, string> = {
  get competitor_prices(){return __uiText("เทียบราคาคู่แข่ง");}, get scraped_catalog_search(){return __uiText("ค้นคลังเว็บคู่แข่ง");}, get scraping_sources(){return __uiText("เว็บที่เก็บข้อมูล");},
  get research_topics(){return __uiText("โจทย์ research");}, get research_report(){return __uiText("รายงาน research");}, get catalog_products(){return __uiText("แค็ตตาล็อก josh");},
  get erp_intake_summary(){return __uiText("สรุปข้อมูลจาก ERP");}, get webhook_failures(){return __uiText("event ที่ส่งไม่สำเร็จ");}, get stock_levels(){return __uiText("สต็อกต่อคลัง");},
  get research_create_topic(){return __uiText("สร้างโจทย์ research");}, get research_request_run(){return __uiText("สั่งรัน research");}, get competitor_record_price(){return __uiText("บันทึกราคาคู่แข่ง");},
  get webhook_retry_delivery(){return __uiText("ส่ง event ซ้ำ");}, get erp_replay_ingest(){return __uiText("replay ข้อมูล ERP");},
  get scraping_update_source(){return __uiText("ตั้งค่าเก็บข้อมูลเว็บ");}, get scraping_run(){return __uiText("สั่งเริ่ม/หยุดเก็บข้อมูลเว็บ");}, get stock_adjust(){return __uiText("ปรับสต็อก");},
  get marketing_list(){return __uiText("รายการ setup การตลาด");}, get marketing_fields(){return __uiText("ดู field ที่ต้องกรอก");}, get marketing_save(){return __uiText("สร้าง/แก้ setup การตลาด");},
  get marketing_workflow_pause(){return __uiText("หยุด workflow");}, get product_content_save(){return __uiText("แก้ชื่อ/คำอธิบายสินค้า");},
  get growth_plan_save(){return __uiText("บันทึกแผน Growth");}, get growth_plan_tasks(){return __uiText("แก้งานในแผน Growth");}, get growth_plan_action(){return __uiText("ส่งตรวจ/อนุมัติ/ส่งออกแผน Growth");}, get market_analyse(){return __uiText("วิเคราะห์ตลาด");},
};
const WRITE_TOOLS = new Set(['research_create_topic', 'research_request_run', 'competitor_record_price', 'webhook_retry_delivery', 'erp_replay_ingest', 'scraping_update_source', 'scraping_run', 'stock_adjust',
  'marketing_save', 'marketing_workflow_pause', 'product_content_save', 'growth_plan_save', 'growth_plan_tasks', 'growth_plan_action', 'market_analyse']);
/** Short text for one changed value in the change log. */
const show = (v: unknown) => { const s = v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v); return s.length > 60 ? `${s.slice(0, 60)}…` : s; };
const STEPS = [
  { app: 'Claude (claude.ai / Desktop)', how: 'Settings → Connectors → Add custom connector → วาง URL → Connect' },
  { app: 'ChatGPT', how: 'Settings → Connectors (เปิด developer mode) → Create → วาง URL, Authentication = OAuth' },
  { app: 'Claude Code', how: 'claude mcp add --transport http commerce <URL> แล้วพิมพ์ /mcp เพื่อ login' },
];

/** AI connectors (MCP): how to connect, who is connected, and what the AI has read. */
export function AiConnectors() {
  __useUiLocale();
  const info = useAsync(() => mcpApi.connections(), []);
  const activity = useAsync(() => mcpApi.activity(50), []);
  const changes = useAsync(() => mcpApi.changes(100), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const admin = info.data?.role === 'admin';

  async function revoke(c: McpConnection) {
    if (!window.confirm(__uiText("ยกเลิกการเชื่อมต่อ {0} ของ {1}? AI จะใช้ข้อมูลต่อไม่ได้ทันที ต้อง login ใหม่ถ้าจะใช้อีก", {"0": c.clientName, "1": c.staffEmail}))) return;
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
        title={__uiText("AI connectors (MCP)")}
        subtitle={__uiText("ให้ Claude หรือ ChatGPT อ่านและสรุปข้อมูลของ commerce ได้")}
        actions={<Button icon="refresh" onClick={() => { info.reload(); activity.reload(); changes.reload(); }}>{__uiText("Refresh")}</Button>}
      />

      {note && <Alert tone={note.ok ? 'ok' : 'danger'}>{note.text}</Alert>}
      <ErrorText error={info.error} />

      <Panel>
        <PanelHead title={__uiText("ขั้นตอนการเชื่อมต่อ")} />
        {info.loading ? (
          <Loading />
        ) : !info.data ? (
          <Empty icon="error">{__uiText("โหลดสถานะไม่สำเร็จ")}</Empty>
        ) : info.data.enabled ? (
          <div className="space-y-4 p-4">
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">{__uiText("MCP URL")}</h3>
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
          <Alert tone="danger">{__uiText("MCP ยังไม่เปิดบนเซิร์ฟเวอร์นี้ — ตั้ง MCP_PUBLIC_URL (ดู docs/mcp.md)")}</Alert>
        )}
      </Panel>

      <Panel>
        <PanelHead title={admin ? __uiText("AI ที่เชื่อมต่อ (ทุกบัญชี)") : __uiText("AI ที่เชื่อมต่อกับบัญชีของคุณ")} />
        {info.loading ? (
          <Loading />
        ) : !info.data?.connections.length ? (
          <Empty>{__uiText("ยังไม่มี AI เชื่อมต่อ")}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText("แอป AI")}</TH>
              {admin && <TH>{__uiText("บัญชี")}</TH>}
              <TH>{__uiText("สถานะ")}</TH>
              <TH right>{__uiText("ใช้ล่าสุด")}</TH>
              <TH right>{__uiText("เรียกข้อมูล")}</TH>
              <TH right>{__uiText("เชื่อมครั้งแรก")}</TH>
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
                          {__uiText("เชื่อมต่ออยู่")}</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.canWrite ? 'bg-[#fef7e0] text-[#b08900]' : 'bg-surface-container text-secondary'}`}>
                          {c.canWrite ? __uiText("แก้ไขได้ (ต้องยืนยัน)") : __uiText("อ่านอย่างเดียว")}
                        </span>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-surface-container text-secondary">{__uiText("หมดอายุ / ยกเลิกแล้ว")}</span>
                    )}
                  </TD>
                  <TD kind="time">{c.lastUsedAt ? fmt.when(c.lastUsedAt) : '—'}</TD>
                  <TD kind="num">{fmt.num(c.toolCalls)}</TD>
                  <TD kind="time">{fmt.when(c.firstSeenAt)}</TD>
                  <TD kind="actions">
                    {c.liveSessions > 0 && (
                      <Button variant="danger-ghost" size="sm" disabled={busy === c.clientId + c.staffUserId} onClick={() => revoke(c)}>
                        {__uiText("ยกเลิก")}</Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      <Panel>
        <PanelHead title={__uiText("AI สร้าง / แก้ไขอะไรไปบ้าง")} sub={__uiText("ใครสั่ง ผ่าน AI ไหน เปลี่ยนอะไร — ล่าสุด 100 รายการ รวมครั้งที่ไม่สำเร็จ")} />
        <ErrorText error={changes.error} />
        {changes.loading ? (
          <Loading />
        ) : !changes.data?.length ? (
          <Empty>{__uiText("AI ยังไม่ได้สร้างหรือแก้ไขอะไร")}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText("เวลา")}</TH>
              <TH>{__uiText("ใครสั่ง")}</TH>
              <TH>{__uiText("สิ่งที่ทำ")}</TH>
              <TH>{__uiText("เปลี่ยนอะไร")}</TH>
              <TH>{__uiText("ผล")}</TH>
            </THead>
            <TBody>
              {changes.data.map((c) => (
                <TR key={c.id}>
                  <TD kind="time">{fmt.when(c.at)}</TD>
                  <TD>
                    <div className="font-medium">{c.staffEmail}</div>
                    <div className="text-[11px] text-on-surface-variant">{__uiText("ผ่าน {0}", { "0": c.clientName })}</div>
                  </TD>
                  <TD>
                    <div>{TOOL_LABEL[c.tool] ?? c.tool}</div>
                    {c.summary && <div className="text-[11px] text-on-surface-variant">{c.summary}</div>}
                    {c.adminUrl && <a href={c.adminUrl} className="text-[11px] text-primary underline">{__uiText("เปิดดูใน admin")}</a>}
                  </TD>
                  <TD className="text-[11px]">
                    {c.changes.length ? (
                      <ul className="space-y-0.5">
                        {c.changes.slice(0, 8).map((ch) => (
                          <li key={ch.field} className="break-words">
                            <span className="font-semibold">{ch.field}</span>{': '}
                            <span className="text-on-surface-variant" title={JSON.stringify(ch.before)}>{show(ch.before)}</span>{' → '}
                            <span title={JSON.stringify(ch.after)}>{show(ch.after)}</span>
                          </li>
                        ))}
                        {c.changes.length > 8 && <li className="text-on-surface-variant">{__uiText("และอีก {0} field", { "0": String(c.changes.length - 8) })}</li>}
                      </ul>
                    ) : '—'}
                  </TD>
                  <TD>
                    {c.error ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fdecea] text-[#b3261e]" title={c.error}>{__uiText("ไม่สำเร็จ")}</span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#e7f5ec] text-[#157347]">{__uiText("สำเร็จ")}</span>
                    )}
                    {c.error && <div className="text-[10px] text-on-surface-variant max-w-[220px] break-words">{show(c.error)}</div>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      <Panel>
        <PanelHead title={__uiText("AI ทำอะไรไปบ้าง")} sub={__uiText("ล่าสุด 50 ครั้ง")} />
        <ErrorText error={activity.error} />
        {activity.loading ? (
          <Loading />
        ) : !activity.data?.length ? (
          <Empty>{__uiText("ยังไม่มีการเรียกข้อมูล")}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText("เวลา")}</TH>
              <TH>{__uiText("สิ่งที่ทำ")}</TH>
              <TH>{__uiText("เงื่อนไข")}</TH>
              <TH>{__uiText("แอป AI")}</TH>
              {admin && <TH>{__uiText("บัญชี")}</TH>}
            </THead>
            <TBody>
              {activity.data.map((a) => (
                <TR key={a.id}>
                  <TD kind="time">{fmt.when(a.at)}</TD>
                  <TD>
                    {a.isWrite && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fef7e0] text-[#b08900] mr-1">{__uiText("แก้ไข")}</span>}
                    <span>{TOOL_LABEL[a.tool] ?? a.tool}</span>
                    {!a.isWrite && WRITE_TOOLS.has(a.tool) && <div className="text-[10px] text-on-surface-variant">{__uiText("ขอดูตัวอย่าง ยังไม่ได้ทำ")}</div>}
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
