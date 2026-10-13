// ui-copy-migration: only literal UI copy and notification templates
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, ErrorText, Field, FormPanel, Input, Loading, Modal, Page, PageHeader, Segmented, Select, StatusChip, Textarea, toast, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { DynamicSegment, EventDefinition, SegmentOption, TriggerType, WebhookSecretItem, Workflow, WorkflowInput, WorkflowIssue, WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';
import { dynamicSegmentsApi, eventsApi, flowsApi, marketingTestersApi, type MarketingTester } from '../../../lib/api';
import { useAsync, useMutation } from '../../hooks';
import { commerceText as text } from '../../commerce-copy';
import { getCoupons } from '../workflow-editor/josh/extra.api';
import { FlowCanvas } from './FlowCanvas';
import { FlowResults } from './FlowResults';
import { Palette } from './Palette';
import { StepPanel } from './StepPanel';
import { describeStep, type CouponOption } from './forms/StepForms';
import { describeTrigger, TRIGGER_DEFAULTS } from './forms/TriggerForm';
import { addLoose, autoLayout, connect, disconnect, insertAfter, newStep, removeStep, tailOfMain, TRIGGER, type Anchor, type Graph, type StepKind } from './workflow-graph';

const BLANK: WorkflowInput = { name: '', triggerType: 'first_login', triggerConfig: {}, entryStepId: null, steps: [], graphUi: null,
  cooldownDays: 0, holdoutPercent: 0, conversionWindowDays: 7, exitOnGoal: { kind: 'order_placed' }, schedule: null };
const inputOf = (w: Workflow): WorkflowInput => ({ name: w.name, triggerType: w.triggerType, triggerConfig: w.triggerConfig, entryStepId: w.entryStepId,
  steps: w.steps, graphUi: w.graphUi, cooldownDays: w.cooldownDays, holdoutPercent: w.holdoutPercent, conversionWindowDays: w.conversionWindowDays,
  exitOnGoal: w.exitOnGoal, schedule: w.schedule });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** The activate / test-run 422 body is `{ statusCode, path, error: { message, issues } }`; `request()` exposes `error` as `details`. */
const issuesOf = (e: unknown): WorkflowIssue[] | null => (e as { details?: { issues?: WorkflowIssue[] } })?.details?.issues ?? null;

/** Opening the create page is read-only; a named draft is created only on explicit submission. */
export function FlowEditorPage() {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const create = useMutation();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await create.run(async () => {
      if (!name.trim()) throw new Error(text('กรุณากรอกชื่อ Workflow', 'Enter a workflow name.'));
      const draft = await flowsApi.create({ ...BLANK, name: name.trim() });
      if (!draft?.id) throw new Error(text('ยังยืนยันการสร้างร่างไม่ได้ กรุณาตรวจรายการ Workflow ก่อนลองใหม่', 'Draft creation could not be confirmed. Check the workflow list before retrying.'));
      return draft;
    });
    if (result.ok) navigate(`/marketing/flows/${result.value.id}`, { replace: true });
  }
  return id ? <Editor id={id} /> : <Page>
    <PageHeader title={text('สร้าง Workflow', 'Create workflow')} subtitle={text('ตั้งชื่อร่างก่อนเปิดตัวแก้ไข ระบบจะยังไม่ส่งข้อความหรือเปิดใช้งาน', 'Name a draft before opening the editor. It will not send messages or activate the workflow.')} />
    <FormPanel title={text('ร่าง Workflow ใหม่', 'New workflow draft')} onSubmit={submit} onCancel={() => navigate('/marketing/workflows')} busy={create.busy} error={create.error} submitLabel={text('สร้างร่างและเปิดตัวแก้ไข', 'Create draft and open editor')}>
      <Field label={__uiText('ชื่อ')}><Input required value={name} onChange={event => setName(event.target.value)} /></Field>
    </FormPanel>
  </Page>;
}

function Editor({ id }: { id: string }) {
  __useUiLocale();
  const [wf, setWf] = useState<Workflow | null>(null);
  const [input, setInput] = useState<WorkflowInput>(BLANK);
  const [dirty, setDirty] = useState(false);
  const [meta, setMeta] = useState<WorkflowMeta | null>(null);
  const [segments, setSegments] = useState<SegmentOption[]>([]);
  const [coupons, setCoupons] = useState<CouponOption[]>([]);
  const [secrets, setSecrets] = useState<WebhookSecretItem[]>([]);
  const [definitions, setDefinitions] = useState<EventDefinition[]>([]);
  const [dynamicSegments, setDynamicSegments] = useState<DynamicSegment[]>([]);
  const [selection, setSelection] = useState<string | null>(TRIGGER);
  const [tab, setTab] = useState<'flow' | 'results'>('flow');
  const [issues, setIssues] = useState<WorkflowIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    const [w, m, segs, secs, defs, dyn] = await Promise.all([flowsApi.get(id), flowsApi.meta(), flowsApi.segmentOptions(), flowsApi.secrets.list(),
      eventsApi.definitions(), dynamicSegmentsApi.list()]);
    setWf(w); setInput(inputOf(w)); setIssues(w.issues); setMeta(m); setSegments(segs); setSecrets(secs); setDirty(false);
    setDefinitions(defs.definitions); setDynamicSegments(dyn);
    // Coupons live in josh (admin-call); the editor still works without them.
    getCoupons(1, 200, '').then((res) => setCoupons(((res?.data?.data?.data ?? []) as CouponOption[])
      .map((c) => ({ id: c.id, coupon_code: c.coupon_code, title: c.title })))).catch(() => setCoupons([]));
  }, [id]);
  useEffect(() => { load().catch((e) => setError(message(e))); }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const patch = useCallback((p: Partial<WorkflowInput>) => { setInput((cur) => ({ ...cur, ...p })); setDirty(true); }, []);
  const graph: Graph = useMemo(() => ({ entryStepId: input.entryStepId, steps: input.steps }), [input.entryStepId, input.steps]);
  const applyGraph = (g: Graph) => patch({ entryStepId: g.entryStepId, steps: g.steps });
  const insert = (kind: StepKind, anchor: Anchor) => { const s = newStep(kind); applyGraph(insertAfter(graph, anchor, s)); setSelection(s.id); };
  const pickFromPalette = (itemId: string, trigger?: boolean) => {
    if (trigger) { patch({ triggerType: itemId as TriggerType, triggerConfig: TRIGGER_DEFAULTS[itemId as TriggerType] }); setSelection(TRIGGER); return; }
    const selected = selection && selection !== TRIGGER ? input.steps.find((s) => s.id === selection) : undefined;
    const anchor: Anchor = selection === TRIGGER ? { stepId: TRIGGER } : selected ? { stepId: selected.id } : tailOfMain(graph);
    insert(itemId as StepKind, anchor);
  };

  const run = async (fn: () => Promise<Workflow>, done: string) => {
    setBusy(true); setError(null);
    try { const w = await fn(); setWf(w); setInput(inputOf(w)); setIssues(w.issues); setDirty(false); toast(done); }
    catch (e) { const found = issuesOf(e); if (found) setIssues(found); setError(message(e)); }
    finally { setBusy(false); }
  };
  const save = () => run(() => flowsApi.update(id, input), __uiText('บันทึกแล้ว'));
  const activate = () => run(async () => { if (dirty) await flowsApi.update(id, input); return flowsApi.activate(id); }, __uiText('เปิดใช้แล้ว'));

  if (error && !wf) return <Page><PageHeader title={text('แก้ไข Workflow', 'Edit workflow')} back={{ to: '/marketing/workflows', label: text('รายการ Workflow', 'Workflow list') }} /><ErrorText error={error} onRetry={() => { setError(null); load().catch(e => setError(message(e))); }} /></Page>;
  if (!wf || !meta) return <Page><PageHeader title={text('แก้ไข Workflow', 'Edit workflow')} /><Loading variant="detail" /></Page>;
  const issuesByStep = Object.fromEntries(issues.map((i) => [i.stepId ?? TRIGGER, i.message]));
  const trig = describeTrigger(input.triggerType, input.triggerConfig);

  return (
    <Page>
      <PageHeader back={{ to: '/marketing/workflows', label: __uiText('ข้อความอัตโนมัติ') }}
        title={<Input value={input.name} onChange={(e) => patch({ name: e.target.value })} aria-label={__uiText('ชื่อข้อความอัตโนมัติ')} className="min-w-[280px] text-lg font-semibold" />}
        badge={<StatusChip status={wf.status} />}
        actions={<div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-xs text-on-surface-variant">{__uiText('ยังไม่ได้บันทึก')}</span>}
          <Button disabled={busy || !dirty} onClick={save}>{__uiText('บันทึก')}</Button>
          <Button disabled={busy} onClick={() => setTestOpen(true)}>{__uiText('รันทดสอบ')}</Button>
          <Button variant="ghost" icon="history" onClick={() => setHistoryOpen(true)}>{__uiText('ประวัติ')}</Button>
          {wf.status === 'active'
            ? <Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm(__uiText('หยุดข้อความอัตโนมัตินี้ชั่วคราว? ลูกค้าที่ค้างอยู่จะไม่ได้ข้อความขั้นต่อไปจนกว่าจะเปิดใหม่'))) run(() => flowsApi.pause(id), __uiText('หยุดแล้ว')); }}>{__uiText('หยุดชั่วคราว')}</Button>
            : <Button variant="primary" disabled={busy} onClick={activate}>{__uiText('เปิดใช้งาน')}</Button>}
        </div>} />
      {error && <Alert tone="danger" onClose={() => setError(null)}>{error}</Alert>}
      {issues.length > 0 && <Alert tone="warn">{__uiText('ยังเปิดใช้ไม่ได้: {0} จุดที่ต้องแก้ (การ์ดขอบแดง)', { 0: issues.length })}</Alert>}
      <Segmented value={tab} onChange={setTab} options={[{ value: 'flow', label: __uiText('ขั้นตอน') }, { value: 'results', label: __uiText('ผลลัพธ์') }]} />
      {tab === 'results' ? <FlowResults id={id} /> : (
        <div className="mt-3 flex h-[72vh] min-h-[560px] gap-3">
          <Palette steps={input.steps} triggerType={input.triggerType} limits={meta.limits} onPick={(item) => pickFromPalette(item.id, item.trigger)} />
          <div className="relative min-w-0 flex-1">
            <FlowCanvas graph={graph} positions={input.graphUi ?? {}} triggerType={input.triggerType} triggerTitle={trig.title} triggerSubtitle={trig.subtitle}
              selectedId={selection} issuesByStep={issuesByStep} limits={meta.limits} describe={(s) => describeStep(s, { segments, coupons })}
              onSelect={setSelection} onMove={(sid, pos) => patch({ graphUi: { ...(input.graphUi ?? {}), [sid]: pos } })}
              onInsert={insert}
              onAddLoose={(kind, pos) => { const s = newStep(kind); patch({ steps: addLoose(graph, s).steps, graphUi: { ...(input.graphUi ?? {}), [s.id]: pos } }); setSelection(s.id); }}
              onConnect={(from, to) => applyGraph(connect(graph, from, to))} onDisconnect={(from) => applyGraph(disconnect(graph, from))}
              onRemove={(sid) => { applyGraph(removeStep(graph, sid)); setSelection(null); }} />
            <Button size="sm" className="absolute right-3 top-3" icon="account_tree" onClick={() => patch({ graphUi: autoLayout(graph) })}>{__uiText('จัดเรียงอัตโนมัติ')}</Button>
          </div>
          <div className="w-80 shrink-0 overflow-y-auto">
            <StepPanel selection={selection} input={input} meta={meta} issues={issues} segments={segments} coupons={coupons} secrets={secrets}
              definitions={definitions} dynamicSegments={dynamicSegments}
              onChangeInput={patch} onChangeStep={(s: WorkflowStep) => patch({ steps: input.steps.map((x) => (x.id === s.id ? s : x)) })}
              onRemoveStep={(sid) => { applyGraph(removeStep(graph, sid)); setSelection(null); }}
              onSecretsChanged={() => { flowsApi.secrets.list().then(setSecrets).catch(() => undefined); }} />
          </div>
        </div>
      )}
      {testOpen && <TestRunModal id={id} dirty={dirty} triggerType={input.triggerType} onSave={save} onClose={() => setTestOpen(false)} />}
      {historyOpen && <RevisionsModal id={id} onLoad={(snapshot) => { setInput(snapshot); setDirty(true); setHistoryOpen(false); }} onClose={() => setHistoryOpen(false)} />}
    </Page>
  );
}

function TestRunModal({ id, dirty, triggerType, onSave, onClose }: { id: string; dirty: boolean; triggerType: TriggerType; onSave: () => Promise<void>; onClose: () => void }) {
  __useUiLocale();
  const testers = useAsync(() => marketingTestersApi.list(), []);
  const [userId, setUserId] = useState('');
  const [skipWaits, setSkipWaits] = useState(true);
  const [attrs, setAttrs] = useState('{}');
  const [msg, setMsg] = useState<string | null>(null);
  const list: MarketingTester[] = testers.data ?? [];
  const chosen = userId || list[0]?.userId || '';
  const start = async () => {
    setMsg(null);
    try {
      let eventAttributes: Record<string, unknown> | undefined;
      if (triggerType === 'event') {
        try { eventAttributes = JSON.parse(attrs || '{}'); } catch { setMsg(__uiText('JSON ไม่ถูกต้อง')); return; }
      }
      if (dirty) await onSave();
      const r = await flowsApi.testRun(id, chosen, skipWaits, eventAttributes);
      setMsg(r.enrollmentId ? __uiText('เริ่มแล้ว — ดูผลที่แท็บผลลัพธ์ (test)') : __uiText('ไม่ได้เริ่ม'));
    } catch (e) {
      const found = issuesOf(e);
      setMsg(found ? found.map((i) => i.message).join(' · ') : message(e));
    }
  };
  return (
    <Modal title={__uiText('รันทดสอบกับ tester')} onClose={onClose}
      footer={<><Button onClick={onClose}>{__uiText('ปิด')}</Button><Button variant="primary" disabled={!chosen} onClick={start}>{__uiText('ส่งจริงให้ tester')}</Button></>}>
      {testers.loading ? <Loading /> : list.length ? (
        <div className="space-y-3">
          <Select aria-label={__uiText('tester')} value={chosen} onChange={(e) => setUserId(e.target.value)}>
            {list.map((t) => <option key={t.userId} value={t.userId}>{t.name ?? t.email} · {t.email}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={skipWaits} onChange={(e) => setSkipWaits(e.target.checked)} />{__uiText('ข้าม Time Delay')}</label>
          {triggerType === 'event' && <Textarea rows={3} className="font-mono text-xs" aria-label={__uiText('attribute ตัวอย่าง (JSON)')} value={attrs} onChange={(e) => setAttrs(e.target.value)} />}
          <p className="text-xs text-on-surface-variant">{__uiText('ส่งจริง (push / email / คูปองผ่าน josh, webhook ยิงจริง) เฉพาะ tester ที่เลือก')}</p>
        </div>
      ) : <p className="text-sm">{__uiText('ยังไม่มี tester — เพิ่มได้ที่หน้า ข้อความอัตโนมัติ › Tester')}</p>}
      {msg && <p className="mt-3 text-sm">{msg}</p>}
    </Modal>
  );
}

/** Saved versions (newest first); "เปิดฉบับนี้" loads it into the editor unsaved — Save makes it current. */
function RevisionsModal({ id, onLoad, onClose }: { id: string; onLoad: (snapshot: WorkflowInput) => void; onClose: () => void }) {
  __useUiLocale();
  const list = useAsync(() => flowsApi.revisions(id), [id]);
  return (
    <Modal title={__uiText('ประวัติการแก้ไข')} onClose={onClose} width={560} footer={<Button onClick={onClose}>{__uiText('ปิด')}</Button>}>
      {list.loading ? <Loading /> : (
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto text-sm">
          {(list.data ?? []).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 rounded border border-outline-variant px-3 py-2">
              <span>{new Date(r.createdAt).toLocaleString()} · {r.createdBy ?? '-'} · {r.snapshot.steps.length} steps</span>
              <Button size="sm" onClick={() => onLoad(r.snapshot)}>{__uiText('เปิดฉบับนี้')}</Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
