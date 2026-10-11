// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { Fragment, useState } from 'react';
import { Alert, Button, Checkbox, Chip, CodeBlock, StatusChip, Empty, ErrorText, ExpandRow, ExpandToggle, Field, FormPanel, Input, Loading, Page, PageHeader, Panel, PanelHead, Select, Span, Table, TBody, TD, TH, THead, TR, Textarea, TogglePill, fmt, ButtonLink, statusLabel, toneOf } from '@cp/ui';
import { flowsApi, WorkflowRow, workflowsApi } from '../../lib/api';
import { useAsync } from '../hooks';
import { MarketingTestersPanel } from './MarketingTestersPanel';
import { itemOf } from './marketing-workflow/palette-items';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const STATUS: Record<WorkflowRow['status'], 'ok' | 'warn' | 'muted'> = { active: 'ok', paused: 'warn', draft: 'muted' };
const STATUS_LABEL: Record<WorkflowRow['status'], string> = { get active(){return __uiText("ทำงาน");}, get paused(){return __uiText("หยุด");}, get draft(){return __uiText("ร่าง");} };
/** What starts a workflow, for display only; unknown codes show as they are. */
const TRIGGER_LABEL: Record<string, () => string> = {
  cart_idle: () => __uiText("ทิ้งของไว้ในตะกร้า"),
  page_affinity: () => __uiText("ดูหน้าเดิมซ้ำ ๆ"),
  session_in_window: () => __uiText("เข้าใช้งานในช่วงเวลาที่กำหนด"),
  first_login: () => __uiText("เข้าแอปครั้งแรก"),
  first_visit: () => __uiText("เข้าเว็บครั้งแรก"),
  custom: () => __uiText("กำหนดเอง"),
  order_milestone: () => __uiText("ยอดสั่งซื้อถึงเป้า"),
  scheduled: () => __uiText("ตามเวลา"),
};
const triggerText = (code: string) => TRIGGER_LABEL[code]?.() ?? itemOf(code)?.label ?? code;
const when = (v: string | null) => (v ? new Date(v).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), { dateStyle: 'short', timeStyle: 'short' }) : '—');
const EDITABLE = ['name', 'trigger_type', 'trigger_config', 'steps', 'schedule', 'cooldown_days', 'holdout_percent', 'conversion_window_days', 'exit_on_goal'];

/**
 * josh marketing automations. Read from josh's replica; activate / pause / edit are done by josh's own
 * MarketingWorkflowService (josh COMMERCE_OWNS_MARKETING_WORKFLOWS=true locks josh admin's editing).
 * Enrolling customers and sending stay in josh; there is no test-send here.
 */
export function MarketingWorkflows() {
  __useUiLocale();
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
    if (!window.confirm(__uiText("{0} \"{1}\"?\n\n{2}", {"0": action === 'pause' ? __uiText('หยุดข้อความอัตโนมัติ') : __uiText('เปิดข้อความอัตโนมัติ'), "1": w.name, "2": action === 'activate' ? __uiText('ระบบจะเริ่มส่งข้อความให้ลูกค้าที่เข้าเงื่อนไขในรอบถัดไป') : __uiText('ลูกค้าที่ค้างอยู่จะไม่ได้ข้อความขั้นต่อไปจนกว่าจะเปิดใหม่')}))) return;
    run(`${action === 'pause' ? 'หยุด' : 'เปิด'} "${w.name}" แล้ว`, () => workflowsApi.setState(w.id, action));
  };

  return (
    <Page>
      <PageHeader
        title={__uiText("ข้อความอัตโนมัติ")}
        subtitle={__uiText("ข้อความที่ส่งถึงลูกค้าเองตามพฤติกรรม เปิด หยุด หรือแก้ได้ที่นี่ ระบบส่งจริงตามรอบและเก็บประวัติการแก้ไว้ให้")}
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs">
              <span className="text-on-surface-variant">{__uiText("ช่วง")}</span>
              <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="max-w-[120px]">
                {[7, 30, 90].map((d) => <option key={d} value={d}>{d} {__uiText(" วัน")}</option>)}
              </Select>
            </label>
            <ButtonLink variant="primary" icon="add" to="/marketing/flows/new">{__uiText("สร้างข้อความอัตโนมัติ")}</ButtonLink>
          </div>
        }
      />

      {msg && <Alert tone="ok">{(typeof msg === 'string' ? __uiText(msg) : msg)}</Alert>}
      <ErrorText error={list.error} />

      <CommerceFlowsPanel />

      {list.data && (
        <Panel className="overflow-hidden">
          <PanelHead title={__uiText("ข้อความอัตโนมัติชุดเดิม")} sub={__uiText("ทำงานในระบบหลังบ้านเดิม แก้ด้วยหน้าจอแบบกราฟ")} />
          {list.data.length ? (
            <Table>
              <THead>
                <TH>{__uiText("ชื่อ")}</TH>
                <TH>{__uiText("สถานะ")}</TH>
                <TH>{__uiText("เริ่มเมื่อ")}</TH>
                <TH right>{__uiText("ลูกค้าที่เข้า")}</TH>
                <TH right>{__uiText("อยู่ระหว่างขั้นตอน")}</TH>
                <TH right>{__uiText("ล้มเหลว")}</TH>
                <TH right>{__uiText("ซื้อ")}</TH>
                <TH>{__uiText("รอบล่าสุด")}</TH>
                <TH className="w-24" />
              </THead>
              <TBody>
                {list.data.map((w) => (
                  <Fragment key={w.id}>
                    <TR>
                      <TD>{w.name}</TD>
                      <TD>
                        <Chip tone={STATUS[w.status] ?? 'muted'} statusCode={w.status} dot>{STATUS_LABEL[w.status] ?? w.status}</Chip>
                      </TD>
                      <TD>{triggerText(w.trigger_type)}</TD>
                      <TD kind="num">{fmt.num(w.enrolled ?? 0)}</TD>
                      <TD kind="num">{fmt.num(w.running ?? 0)}</TD>
                      <TD kind="num" className={w.failed ? 'text-danger' : ''}>{fmt.num(w.failed ?? 0)}</TD>
                      <TD kind="num">{fmt.num(w.converted ?? 0)}{w.enrolled ? ` (${Math.round(((w.converted ?? 0) / w.enrolled) * 100)}%)` : ''}</TD>
                      <TD kind="time">
                        {when(w.last_run_at)}
                        {w.failed_runs ? <div className="text-[10px] text-danger">{__uiText("ล้มเหลว ")}{w.failed_runs} {__uiText(" รอบ")}</div> : null}
                      </TD>
                      <TD kind="actions">
                        <div className="inline-flex items-center gap-1">
                        <ExpandToggle open={open === w.id} onClick={() => setOpen(open === w.id ? null : w.id)} label={__uiText("ดู")} />
                        <ButtonLink variant="ghost" icon="account_tree" className="!px-2 !py-1 !text-[11px]" to={`/marketing/workflows/${w.id}/edit`}>{__uiText("กราฟ")}</ButtonLink>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setOpen(w.id); setEditing(w.id); }}>{__uiText("แก้ JSON")}</Button>
                        <Button variant={w.status === 'active' ? 'danger-ghost' : 'secondary'} size="sm" disabled={busy} onClick={() => toggle(w)}>{w.status === 'active' ? __uiText("หยุด") : __uiText("เปิด")}</Button>
                        </div>
                      </TD>
                    </TR>
                    {open === w.id && (
                      <ExpandRow colSpan={9}>
                        <ErrorText error={detail.error} />
                        {!detail.data ? (
                          <Loading />
                        ) : editing === w.id ? (
                          <EditJson initial={JSON.stringify(Object.fromEntries(EDITABLE.filter((k) => k in detail.data!).map((k) => [k, detail.data![k]])), null, 2)}
                            busy={busy} onCancel={() => setEditing(null)} onSave={(v) => run(`บันทึก "${w.name}" แล้ว`, () => workflowsApi.update(w.id, v))} />
                        ) : (
                          <div className="space-y-4">
                            <div>
                              <div className="text-xs font-semibold text-on-surface-variant mb-2 uppercase tracking-wide">{__uiText("ลูกค้าในแต่ละสถานะ")}</div>
                              <div className="flex flex-wrap gap-2">
                                {detail.data.enrollmentsByStatus.map((s) => (
                                  <Chip key={s.status} tone={toneOf(s.status)} statusCode={s.status} dot>
                                    {statusLabel(s.status)}: {fmt.num(s.n)}
                                  </Chip>
                                ))}
                              </div>
                            </div>
                            {!!detail.data.recentFailures.length && (
                              <div>
                                <div className="text-xs font-semibold text-on-surface-variant mb-2 uppercase tracking-wide">{__uiText("ส่งไม่สำเร็จล่าสุด")}</div>
                                <Table>
                                  <THead>
                                    <TH>{__uiText("เวลา")}</TH>
                                    <TH>{__uiText("ประเภท")}</TH>
                                    <TH>{__uiText("รายละเอียด")}</TH>
                                  </THead>
                                  <TBody>
                                    {detail.data.recentFailures.map((f, i) => (
                                      <TR key={i}>
                                        <TD kind="time">{when(f.created_at)}</TD>
                                        <TD kind="mono">{f.action_kind}</TD>
                                        <TD kind="mono">{JSON.stringify(f.detail)}</TD>
                                      </TR>
                                    ))}
                                  </TBody>
                                </Table>
                              </div>
                            )}
                            {!!detail.data.recentRuns.length && (
                              <div>
                                <div className="text-xs font-semibold text-on-surface-variant mb-2 uppercase tracking-wide">{__uiText("รอบที่รันล่าสุด")}</div>
                                <Table>
                                  <THead>
                                    <TH>{__uiText("เวลา")}</TH>
                                    <TH>{__uiText("สถานะ")}</TH>
                                    <TH right>{__uiText("ลูกค้าที่เข้า / ทั้งหมด")}</TH>
                                    <TH>{__uiText("ข้อความ")}</TH>
                                  </THead>
                                  <TBody>
                                    {detail.data.recentRuns.map((r, i) => (
                                      <TR key={i}>
                                        <TD kind="time">{when(r.fired_at)}</TD>
                                        <TD><StatusChip status={r.status} /></TD>
                                        <TD kind="num">{fmt.num(r.enrolled_count ?? 0)} / {fmt.num(r.audience_count ?? 0)}</TD>
                                        <TD kind="muted">{r.error_message ?? r.skip_reason ?? '—'}</TD>
                                      </TR>
                                    ))}
                                  </TBody>
                                </Table>
                              </div>
                            )}
                            <div>
                              <div className="text-xs font-semibold text-on-surface-variant mb-2 uppercase tracking-wide">{__uiText("ขั้นตอน")}</div>
                              <CodeBlock value={detail.data.steps} />
                            </div>
                          </div>
                        )}
                      </ExpandRow>
                    )}
                  </Fragment>
                ))}
              </TBody>
            </Table>
          ) : (
            <div className="px-4 py-8"><Empty icon="automation">{__uiText("ยังไม่มีข้อความอัตโนมัติชุดเดิม")}</Empty></div>
          )}
        </Panel>
      )}

      <MarketingTestersPanel />
    </Page>
  );
}

function EditJson({ initial, busy, onSave, onCancel }: { initial: string; busy: boolean; onSave: (v: Record<string, unknown>) => void; onCancel: () => void }) {
  __useUiLocale();
  const [text, setText] = useState(initial);
  const [err, setErr] = useState('');
  function save() {
    let v: unknown;
    try { v = JSON.parse(text); } catch { return setErr('JSON ไม่ถูกต้อง'); }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return setErr('ต้องเป็น object');
    if (!window.confirm(__uiText("บันทึกการแก้ข้อความอัตโนมัตินี้? ระบบเก็บฉบับเดิมไว้ให้ย้อนกลับได้"))) return;
    onSave(v as Record<string, unknown>);
  }
  return (
    <FormPanel
      title={__uiText("แก้ข้อความอัตโนมัติ")}
      icon="edit"
      cols={1}
      description={__uiText("ระบบตรวจเงื่อนไขก่อนบันทึก และเก็บฉบับเดิมไว้ย้อนกลับได้")}
      busy={busy}
      error={err}
      onSubmit={save}
      onCancel={onCancel}
    >
      <Field label={__uiText("ข้อมูลข้อความอัตโนมัติ (JSON)")}>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} />
      </Field>
    </FormPanel>
  );
}


/** Workflows commerce runs itself (spec 2026-10-10) — built with the journey editor at /marketing/flows/:id. */
function CommerceFlowsPanel() {
  __useUiLocale();
  const flows = useAsync(() => flowsApi.list(), []);
  return (
    <Panel className="overflow-hidden">
      <PanelHead title={__uiText("ข้อความอัตโนมัติชุดใหม่")} sub={__uiText("สร้างด้วยการลากวางขั้นตอน แบ่งกลุ่มทดลองได้")} />
      <ErrorText error={flows.error} onRetry={flows.reload} />
      {flows.loading && !flows.data ? <Loading variant="table" /> : flows.data?.length ? (
        <Table>
          <THead><TH>{__uiText("ชื่อ")}</TH><TH>{__uiText("สถานะ")}</TH><TH>{__uiText("เริ่มเมื่อ")}</TH>
            <TH kind="num">{__uiText("ลูกค้าที่เข้า 30 วัน")}</TH><TH kind="num">{__uiText("ซื้อ")}</TH><TH kind="time">{__uiText("แก้ล่าสุด")}</TH><TH kind="actions" /></THead>
          <TBody>
            {flows.data.map((w) => (
              <TR key={w.id}>
                <TD>{w.name}</TD><TD><StatusChip status={w.status} /></TD><TD>{triggerText(w.triggerType)}</TD>
                <TD kind="num">{fmt.num(w.enrolled30d)}</TD><TD kind="num">{fmt.num(w.converted30d)}</TD><TD kind="time">{when(w.updatedAt)}</TD>
                <TD kind="actions"><ButtonLink to={`/marketing/flows/${w.id}`} icon="edit">{__uiText("เปิด")}</ButtonLink></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : <div className="px-4 py-8"><Empty icon="automation">{__uiText("ยังไม่มีข้อความอัตโนมัติชุดใหม่ — กด \"สร้างข้อความอัตโนมัติ\" เพื่อเริ่ม")}</Empty></div>}
    </Panel>
  );
}
