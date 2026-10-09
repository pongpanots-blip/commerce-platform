// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { Fragment, useState } from 'react';
import { Alert, Button, Checkbox, CodeBlock, Empty, ErrorText, ExpandRow, ExpandToggle, Field, FormPanel, Input, Loading, Page, PageHeader, Panel, PanelHead, Select, Span, Table, TBody, TD, TH, THead, TR, Textarea, TogglePill, fmt, ButtonLink } from '@cp/ui';
import { WorkflowRow, workflowsApi } from '../../lib/api';
import { useAsync } from '../hooks';
import { MarketingTestersPanel } from './MarketingTestersPanel';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const STATUS: Record<WorkflowRow['status'], 'ok' | 'warn' | 'muted'> = { active: 'ok', paused: 'warn', draft: 'muted' };
const STATUS_LABEL: Record<WorkflowRow['status'], string> = { get active(){return __uiText("ทำงาน");}, get paused(){return __uiText("หยุด");}, get draft(){return __uiText("ร่าง");} };
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
    if (!window.confirm(__uiText("{0} workflow \"{1}\"?\n\n{2}", {"0": action === 'pause' ? 'หยุด' : 'เปิด', "1": w.name, "2": action === 'activate' ? 'josh จะเริ่มส่งข้อความให้ลูกค้าที่เข้าเงื่อนไขตามรอบของ josh' : 'ลูกค้าที่ค้างอยู่จะไม่ได้ข้อความขั้นต่อไปจนกว่าจะเปิดใหม่'}))) return;
    run(`${action === 'pause' ? 'หยุด' : 'เปิด'} "${w.name}" แล้ว`, () => workflowsApi.setState(w.id, action));
  };

  return (
    <Page>
      <PageHeader
        title={__uiText("Marketing workflows")}
        subtitle={__uiText("ระบบส่งข้อความอัตโนมัติของ josh · เปิด/หยุด/แก้ที่นี่ → josh บันทึกเอง (ตรวจเงื่อนไข เก็บประวัติแก้ไข) · การส่งจริงยังเป็นรอบของ josh")}
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs">
              <span className="text-on-surface-variant">{__uiText("ช่วง")}</span>
              <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="max-w-[120px]">
                {[7, 30, 90].map((d) => <option key={d} value={d}>{d} {__uiText(" วัน")}</option>)}
              </Select>
            </label>
            <ButtonLink variant="primary" icon="add" to="/marketing/workflows/new">{__uiText("สร้าง workflow")}</ButtonLink>
          </div>
        }
      />

      {msg && <Alert tone="ok">{(typeof msg === 'string' ? __uiText(msg) : msg)}</Alert>}
      <ErrorText error={list.error} />

      {list.data && (
        <Panel className="overflow-hidden">
          {list.data.length ? (
            <Table>
              <THead>
                <TH>{__uiText("Workflow")}</TH>
                <TH>{__uiText("สถานะ")}</TH>
                <TH>{__uiText("เริ่มเมื่อ")}</TH>
                <TH right>{__uiText("เข้า")}</TH>
                <TH right>{__uiText("กำลังไป")}</TH>
                <TH right>{__uiText("ล้มเหลว")}</TH>
                <TH right>{__uiText("ซื้อ (conversion)")}</TH>
                <TH>{__uiText("รอบล่าสุด")}</TH>
                <TH className="w-24" />
              </THead>
              <TBody>
                {list.data.map((w) => (
                  <Fragment key={w.id}>
                    <TR>
                      <TD>{w.name}</TD>
                      <TD>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS[w.status] === 'ok' ? 'bg-[#e7f5ec] text-[#157347]' : STATUS[w.status] === 'warn' ? 'bg-[#fef7e0] text-[#b08900]' : 'bg-surface-container text-on-surface-variant'}`}>
                          {STATUS_LABEL[w.status] ?? w.status}
                        </span>
                      </TD>
                      <TD kind="mono">{w.trigger_type}</TD>
                      <TD kind="num">{w.enrolled ?? 0}</TD>
                      <TD kind="num">{w.running ?? 0}</TD>
                      <TD kind="num" className={w.failed ? 'text-[#c2333f]' : ''}>{w.failed ?? 0}</TD>
                      <TD kind="num">{w.converted ?? 0}{w.enrolled ? ` (${Math.round(((w.converted ?? 0) / w.enrolled) * 100)}%)` : ''}</TD>
                      <TD kind="time">
                        {when(w.last_run_at)}
                        {w.failed_runs ? <div className="text-[10px] text-[#c2333f]">{__uiText("ล้มเหลว ")}{w.failed_runs} {__uiText(" รอบ")}</div> : null}
                      </TD>
                      <TD kind="actions">
                        <div className="inline-flex items-center gap-1">
                        <ExpandToggle open={open === w.id} onClick={() => setOpen(open === w.id ? null : w.id)} label={__uiText("ดู")} />
                        <ButtonLink variant="ghost" icon="account_tree" className="!px-2 !py-1 !text-[11px]" to={`/marketing/workflows/${w.id}/edit`}>{__uiText("กราฟ")}</ButtonLink>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setOpen(w.id); setEditing(w.id); }}>{__uiText("แก้ JSON")}</Button>
                        <Button variant={w.status === 'active' ? 'ghost' : 'primary'} size="sm" disabled={busy} onClick={() => toggle(w)}>{w.status === 'active' ? __uiText("หยุด") : __uiText("เปิด")}</Button>
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
                              <div className="text-xs font-semibold text-on-surface-variant mb-2 uppercase tracking-wide">{__uiText("Enrollment")}</div>
                              <div className="flex flex-wrap gap-2">
                                {detail.data.enrollmentsByStatus.map((s) => (
                                  <span key={s.status} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-surface-container text-on-surface">
                                    {s.status}: {fmt.num(s.n)}
                                  </span>
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
                                    <TH>{__uiText("ผู้ใช้")}</TH>
                                    <TH>{__uiText("ข้อความ")}</TH>
                                  </THead>
                                  <TBody>
                                    {detail.data.recentRuns.map((r, i) => (
                                      <TR key={i}>
                                        <TD kind="time">{when(r.fired_at)}</TD>
                                        <TD kind="muted">{r.status}</TD>
                                        <TD kind="num">{r.enrolled_count ?? 0} / {r.audience_count ?? 0}</TD>
                                        <TD kind="muted">{r.error_message ?? r.skip_reason ?? '—'}</TD>
                                      </TR>
                                    ))}
                                  </TBody>
                                </Table>
                              </div>
                            )}
                            <div>
                              <div className="text-xs font-semibold text-on-surface-variant mb-2 uppercase tracking-wide">{__uiText("ขั้นตอน (steps)")}</div>
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
            <div className="px-4 py-8"><Empty icon="automation">{__uiText("ยังไม่มี workflow")}</Empty></div>
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
    if (!window.confirm(__uiText("บันทึกการแก้ workflow นี้ไปที่ josh? (josh เก็บฉบับเดิมไว้ใน revisions)"))) return;
    onSave(v as Record<string, unknown>);
  }
  return (
    <FormPanel
      title={__uiText("แก้ Workflow")}
      icon="edit"
      cols={1}
      description={__uiText("รูปแบบเดียวกับ josh · josh ตรวจเงื่อนไขก่อนบันทึก")}
      busy={busy}
      error={err}
      onSubmit={save}
      onCancel={onCancel}
    >
      <Field label={__uiText("ข้อมูล Workflow (JSON)")}>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} />
      </Field>
    </FormPanel>
  );
}

