import { Fragment, useState } from 'react';
import { Alert, Button, Checkbox, CodeBlock, Empty, ErrorText, ExpandRow, ExpandToggle, Field, FormPanel, Input, Loading, Page, PageHeader, Panel, PanelHead, Select, Span, Table, TBody, TD, TH, THead, TR, Textarea, TogglePill, fmt } from '@cp/ui';
import { WorkflowRow, workflowsApi } from '../../lib/api';
import { useAsync } from '../hooks';

const STATUS: Record<WorkflowRow['status'], 'ok' | 'warn' | 'muted'> = { active: 'ok', paused: 'warn', draft: 'muted' };
const STATUS_LABEL: Record<WorkflowRow['status'], string> = { active: 'ทำงาน', paused: 'หยุด', draft: 'ร่าง' };
const when = (v: string | null) => (v ? new Date(v).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
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
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const list = useAsync(() => workflowsApi.list(days), [days]);
  const detail = useAsync(() => (open ? workflowsApi.detail(open) : Promise.resolve(null)), [open]);

  async function run(done: string, fn: () => Promise<unknown>) {
    setBusy(true); setMsg('');
    try { await fn(); setMsg(done); setEditing(null); setCreating(false); list.reload(); detail.reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const toggle = (w: WorkflowRow) => {
    const action = w.status === 'active' ? 'pause' : 'activate';
    if (!window.confirm(`${action === 'pause' ? 'หยุด' : 'เปิด'} workflow "${w.name}"?\n\n${action === 'activate' ? 'josh จะเริ่มส่งข้อความให้ลูกค้าที่เข้าเงื่อนไขตามรอบของ josh' : 'ลูกค้าที่ค้างอยู่จะไม่ได้ข้อความขั้นต่อไปจนกว่าจะเปิดใหม่'}`)) return;
    run(`${action === 'pause' ? 'หยุด' : 'เปิด'} "${w.name}" แล้ว`, () => workflowsApi.setState(w.id, action));
  };

  const template = {
    name: '',
    trigger_type: 'scheduled',
    trigger_config: {},
    steps: [],
    schedule: { timezone: 'Asia/Bangkok', daysOfWeek: [1, 2, 3, 4, 5, 6, 0], startTime: '00:00', endTime: '23:59' },
    cooldown_days: 0,
    holdout_percent: 0,
    conversion_window_days: 30,
    exit_on_goal: null,
  };

  return (
    <Page>
      <PageHeader
        title="Marketing workflows"
        subtitle="ระบบส่งข้อความอัตโนมัติของ josh · เปิด/หยุด/แก้ที่นี่ → josh บันทึกเอง (ตรวจเงื่อนไข เก็บประวัติแก้ไข) · การส่งจริงยังเป็นรอบของ josh"
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs">
              <span className="text-on-surface-variant">ช่วง</span>
              <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="max-w-[120px]">
                {[7, 30, 90].map((d) => <option key={d} value={d}>{d} วัน</option>)}
              </Select>
            </label>
            <Button variant="primary" icon="add" onClick={() => setCreating(true)}>สร้าง workflow</Button>
          </div>
        }
      />

      {msg && <Alert tone="ok">{msg}</Alert>}
      <ErrorText error={list.error} />

      {creating && (
        <CreateForm
          initial={JSON.stringify(template, null, 2)}
          busy={busy}
          onCancel={() => setCreating(false)}
          onSave={(w) => run(`สร้าง "${String(w.name)}" แล้ว`, () => workflowsApi.create(w).then(() => setOpen(null)))}
        />
      )}

      {list.data && (
        <Panel className="overflow-hidden">
          {list.data.length ? (
            <Table>
              <THead>
                <TH>Workflow</TH>
                <TH>สถานะ</TH>
                <TH>เริ่มเมื่อ</TH>
                <TH right>เข้า</TH>
                <TH right>กำลังไป</TH>
                <TH right>ล้มเหลว</TH>
                <TH right>ซื้อ (conversion)</TH>
                <TH>รอบล่าสุด</TH>
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
                        {w.failed_runs ? <div className="text-[10px] text-[#c2333f]">ล้มเหลว {w.failed_runs} รอบ</div> : null}
                      </TD>
                      <TD className="text-right space-x-1">
                        <ExpandToggle open={open === w.id} onClick={() => setOpen(open === w.id ? null : w.id)} label="ดู" />
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setOpen(w.id); setEditing(w.id); }}>แก้</Button>
                        <Button variant={w.status === 'active' ? 'ghost' : 'primary'} size="sm" disabled={busy} onClick={() => toggle(w)}>{w.status === 'active' ? 'หยุด' : 'เปิด'}</Button>
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
                              <div className="text-xs font-semibold text-on-surface-variant mb-2 uppercase tracking-wide">Enrollment</div>
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
                                <div className="text-xs font-semibold text-on-surface-variant mb-2 uppercase tracking-wide">ส่งไม่สำเร็จล่าสุด</div>
                                <Table>
                                  <THead>
                                    <TH>เวลา</TH>
                                    <TH>ประเภท</TH>
                                    <TH>รายละเอียด</TH>
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
                                <div className="text-xs font-semibold text-on-surface-variant mb-2 uppercase tracking-wide">รอบที่รันล่าสุด</div>
                                <Table>
                                  <THead>
                                    <TH>เวลา</TH>
                                    <TH>สถานะ</TH>
                                    <TH>ผู้ใช้</TH>
                                    <TH>ข้อความ</TH>
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
                              <div className="text-xs font-semibold text-on-surface-variant mb-2 uppercase tracking-wide">ขั้นตอน (steps)</div>
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
            <div className="px-4 py-8"><Empty icon="automation">ยังไม่มี workflow</Empty></div>
          )}
        </Panel>
      )}
    </Page>
  );
}

function EditJson({ initial, busy, onSave, onCancel }: { initial: string; busy: boolean; onSave: (v: Record<string, unknown>) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [err, setErr] = useState('');
  function save() {
    let v: unknown;
    try { v = JSON.parse(text); } catch { return setErr('JSON ไม่ถูกต้อง'); }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return setErr('ต้องเป็น object');
    if (!window.confirm('บันทึกการแก้ workflow นี้ไปที่ josh? (josh เก็บฉบับเดิมไว้ใน revisions)')) return;
    onSave(v as Record<string, unknown>);
  }
  return (
    <FormPanel
      title="แก้ Workflow"
      icon="edit"
      cols={1}
      description="รูปแบบเดียวกับ josh · josh ตรวจเงื่อนไขก่อนบันทึก"
      busy={busy}
      error={err}
      onSubmit={save}
      onCancel={onCancel}
    >
      <Field label="ข้อมูล Workflow (JSON)">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} />
      </Field>
    </FormPanel>
  );
}

const TRIGGERS = ['scheduled', 'cart_idle', 'page_affinity', 'session_in_window', 'first_login', 'first_visit', 'order_milestone', 'segment_entry', 'custom'] as const;
const DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

/** New workflow → josh's CreateMarketingWorkflowDto. josh always saves it as a draft; activate it from the list. */
function CreateForm({ busy, onSave, onCancel }: { initial?: string; busy: boolean; onSave: (w: Record<string, unknown>) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<string>('scheduled');
  const [triggerConfig, setTriggerConfig] = useState('{}');
  const [steps, setSteps] = useState('[]');
  const [cooldown, setCooldown] = useState('0');
  const [holdout, setHoldout] = useState('0');
  const [window_, setWindow] = useState('30');
  const [goal, setGoal] = useState('');
  const [useSchedule, setUseSchedule] = useState(true);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0]);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('20:00');
  const [err, setErr] = useState('');

  function save() {
    setErr('');
    if (!name.trim()) return setErr('ใส่ชื่อ workflow');
    let config: unknown;
    let stepList: unknown;
    try { config = JSON.parse(triggerConfig || '{}'); } catch { return setErr('trigger_config: JSON ไม่ถูกต้อง'); }
    try { stepList = JSON.parse(steps || '[]'); } catch { return setErr('steps: JSON ไม่ถูกต้อง'); }
    if (!config || typeof config !== 'object' || Array.isArray(config)) return setErr('trigger_config ต้องเป็น object');
    if (!Array.isArray(stepList)) return setErr('steps ต้องเป็น array');
    const ints = { cooldown_days: Number(cooldown), holdout_percent: Number(holdout), conversion_window_days: Number(window_) };
    if (!Number.isInteger(ints.cooldown_days) || ints.cooldown_days < 0) return setErr('cooldown ต้องเป็นจำนวนเต็ม ≥ 0');
    if (!Number.isInteger(ints.holdout_percent) || ints.holdout_percent < 0 || ints.holdout_percent > 100) return setErr('holdout ต้องอยู่ระหว่าง 0–100');
    if (!Number.isInteger(ints.conversion_window_days) || ints.conversion_window_days < 1) return setErr('ช่วงวัด conversion ต้องเป็นจำนวนเต็ม ≥ 1');
    if (useSchedule && !days.length) return setErr('เลือกวันอย่างน้อย 1 วัน');
    if (!window.confirm(`สร้าง workflow "${name.trim()}" เป็นฉบับร่างบน josh? ยังไม่ส่งอะไรถึงลูกค้าจนกว่าจะกดเปิดใช้`)) return;
    onSave({
      name: name.trim(),
      trigger_type: trigger,
      trigger_config: config,
      steps: stepList,
      ...ints,
      exit_on_goal: goal ? { kind: goal } : null,
      ...(useSchedule ? { schedule: { timezone: 'Asia/Bangkok', daysOfWeek: [...days].sort(), startTime: start, endTime: end } } : {}),
    });
  }

  return (
    <FormPanel
      title="สร้าง Workflow ใหม่"
      icon="add_circle"
      cols={3}
      description="บันทึกเป็นฉบับร่างบน josh (josh ตรวจเงื่อนไขละเอียดตอนกดเปิดใช้) · คัดลอกโครง steps จาก workflow ที่มีอยู่ได้จากรายละเอียดในตาราง"
      submitLabel="สร้างฉบับร่าง"
      busy={busy}
      error={err}
      onSubmit={save}
      onCancel={onCancel}
    >
      <Field label="ชื่อ workflow" className="md:col-span-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น เตือนตะกร้าค้าง 2 ชม." required />
      </Field>
      <Field label="Trigger">
        <Select value={trigger} onChange={(e) => setTrigger(e.target.value)}>
          {TRIGGERS.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </Field>
      <Field label="Cooldown (วัน)" hint="เว้นกี่วันก่อนลูกค้าคนเดิมเข้า workflow ซ้ำ">
        <Input type="number" min={0} value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
      </Field>
      <Field label="Holdout (%)" hint="กันไว้เป็นกลุ่มควบคุม ไม่ส่งข้อความ">
        <Input type="number" min={0} max={100} value={holdout} onChange={(e) => setHoldout(e.target.value)} />
      </Field>
      <Field label="ช่วงวัด conversion (วัน)">
        <Input type="number" min={1} value={window_} onChange={(e) => setWindow(e.target.value)} />
      </Field>
      <Field label="ออกจาก workflow เมื่อ">
        <Select value={goal} onChange={(e) => setGoal(e.target.value)}>
          <option value="">ไม่ออกก่อนจบ</option>
          <option value="order_placed">ลูกค้าสั่งซื้อ</option>
          <option value="cart_converted">ตะกร้าถูกสั่งซื้อ</option>
        </Select>
      </Field>
      <Span>
        <div className="rounded-lg border border-secondary-container p-3 space-y-2">
          <Checkbox label="จำกัดวัน/เวลาที่ทำงาน (เวลาไทย)" checked={useSchedule} onChange={(e) => setUseSchedule(e.target.checked)} />
          {useSchedule && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => (
                  <TogglePill key={i} on={days.includes(i)} onClick={() => setDays((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]))}>
                    {d}
                  </TogglePill>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                ตั้งแต่ <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-28" />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                ถึง <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-28" />
              </label>
            </div>
          )}
        </div>
      </Span>
      <Span>
        <Field label="trigger_config (JSON)" hint="ค่าตั้งของ trigger ที่เลือก เช่น cart_idle: ระยะเวลาตะกร้าค้าง">
          <Textarea value={triggerConfig} onChange={(e) => setTriggerConfig(e.target.value)} rows={4} />
        </Field>
      </Span>
      <Span>
        <Field label="steps (JSON)" hint="audience · wait · gate · action (notify: channels push/email/in_app + templateKey · grant_coupon · show_offer) · condition — เชื่อมด้วย nextId">
          <Textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={10} />
        </Field>
      </Span>
    </FormPanel>
  );
}
