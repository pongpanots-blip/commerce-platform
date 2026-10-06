import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { GrowthAiDraft, GrowthPlan, GrowthPlanInput, GrowthReadiness, GrowthTask, GrowthTemplate } from '@cp/growth';
import { Alert, ArrowLink, Button, ButtonLink, Checkbox, Chip, DetailPanel, DetailSection, Field, FormPanel, Input, KeyValueGrid, Page, PageHeader, Panel, PanelHead, Select, Span, Table, TBody, TD, TH, THead, TR, Textarea, fmt } from '@cp/ui';
import { api, session } from '../../../lib/api';
import { useAsync } from '../../hooks';
import { Evidence, LoadState, PlanStatus, localDateTime, templateLabels } from './shared';

function inputOf(plan: GrowthPlan): GrowthPlanInput {
  const { title, goal, template, owner, segmentIds, excludeSegmentIds, productSkus, notifyTemplateKey, scheduleAt, budgetThb, minimumMarginPercent, holdoutPercent, cooldownDays, conversionWindowDays, variants, selectedVariant, researchTopicId, researchRunId, analysisId } = plan;
  return { title, goal, template, owner, segmentIds, excludeSegmentIds, productSkus, notifyTemplateKey, scheduleAt, budgetThb, minimumMarginPercent, holdoutPercent, cooldownDays, conversionWindowDays, variants, selectedVariant, researchTopicId, researchRunId, analysisId };
}
const commaList = (value: string) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
function CommaInput({ value, onChange, placeholder, uuid = false }: { value: string[]; onChange: (value: string[]) => void; placeholder?: string; uuid?: boolean }) {
  const [text, setText] = useState(value.join(', '));
  const uuidPattern = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
  useEffect(() => {
    if (commaList(text).join(', ') !== value.join(', ')) setText(value.join(', '));
  }, [value]);
  return <Input value={text} placeholder={placeholder} pattern={uuid ? `\\s*${uuidPattern}(?:\\s*,\\s*${uuidPattern})*\\s*` : undefined} title={uuid ? 'ระบุ UUID ของกลุ่ม คั่นด้วย comma' : undefined} onChange={(event) => { setText(event.target.value); onChange(commaList(event.target.value)); }} />;
}
function blank(params: URLSearchParams): GrowthPlanInput {
  const requested = params.get('template');
  return {
    title: params.get('title') ?? '', goal: params.get('goal') ?? '',
    template: requested && Object.prototype.hasOwnProperty.call(templateLabels, requested) ? requested as GrowthTemplate : 'cart_idle',
    owner: session.claims()?.email ?? '', segmentIds: [], excludeSegmentIds: [], productSkus: [], notifyTemplateKey: null,
    scheduleAt: null, budgetThb: 2000, minimumMarginPercent: 20, holdoutPercent: 10, cooldownDays: 7, conversionWindowDays: 14,
    variants: [{ label: 'A', title: '', body: '', evidenceIds: [] }, { label: 'B', title: '', body: '', evidenceIds: [] }], selectedVariant: 0,
    researchTopicId: params.get('topicId'), researchRunId: params.get('runId'),
  };
}

export function GrowthPlanPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  return <PlanEditor key={id ?? `new-${params.toString()}`} id={id} params={params} />;
}

function PlanEditor({ id, params }: { id?: string; params: URLSearchParams }) {
  const navigate = useNavigate();
  const loaded = useAsync(() => id ? api.get<GrowthPlan>(`/growth/plans/${encodeURIComponent(id)}`) : Promise.resolve(null), [id]);
  const readiness = useAsync(() => api.get<GrowthReadiness>('/growth/readiness'));
  const [plan, setPlan] = useState<GrowthPlan | null>(null);
  const [form, setForm] = useState<GrowthPlanInput>(() => blank(params));
  const [tasks, setTasks] = useState<GrowthTask[]>([]);
  const [instruction, setInstruction] = useState('');
  const [ai, setAi] = useState<GrowthAiDraft | null>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [recoveryId, setRecoveryId] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const requestBody = useRef('');
  const currentEmail = session.claims()?.email ?? '';
  const admin = session.claims()?.role === 'admin';
  const canManage = !id || !!plan?.canManage;
  const dirty = !!plan && JSON.stringify(form) !== JSON.stringify(inputOf(plan));
  const tasksDirty = !!plan && JSON.stringify(tasks) !== JSON.stringify(plan.tasks);
  const exportPending = plan?.status === 'export_unknown' || plan?.status === 'exporting';
  function accept(value: GrowthPlan, keepTasks = false) { setPlan(value); setForm(inputOf(value)); if (!keepTasks) setTasks(value.tasks); setAi(null); }
  useEffect(() => { if (loaded.data) accept(loaded.data); }, [loaded.data]);
  function update<K extends keyof GrowthPlanInput>(key: K, value: GrowthPlanInput[K]) { setForm((old) => ({ ...old, [key]: value })); }
  async function act(key: string, work: () => Promise<GrowthPlan>, message: string) {
    if (busy) return;
    setBusy(key); setNote(null);
    try { accept(await work(), key === 'save' && tasksDirty); setNote({ ok: true, text: message }); }
    catch (error) { setNote({ ok: false, text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(''); }
  }
  async function save() {
    if (!canManage || busy || exportPending) return;
    const body = JSON.stringify(form);
    if (!id && requestBody.current !== body) { requestId.current = crypto.randomUUID(); requestBody.current = body; }
    await act('save', async () => {
      const saved = id ? await api.put<GrowthPlan>(`/growth/plans/${encodeURIComponent(id)}`, { version: plan!.version, plan: form })
        : await api.post<GrowthPlan>('/growth/plans', { requestId: requestId.current, plan: form });
      if (!id) navigate(`/marketing/growth/plans/${encodeURIComponent(saved.id)}`, { replace: true });
      return saved;
    }, 'บันทึก revision ใหม่แล้ว · การอนุมัติต้องตรวจจากเนื้อหาเวอร์ชันนี้');
  }
  async function draftAi() {
    if (!plan || busy || dirty || !readiness.data?.ai) return;
    setBusy('ai'); setNote(null); setAi(null);
    try { setAi(await api.post<GrowthAiDraft>(`/growth/plans/${encodeURIComponent(plan.id)}/ai`, { version: plan.version, instruction })); }
    catch (error) { setNote({ ok: false, text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(''); }
  }
  if (id && (loaded.loading || loaded.error || !plan)) return <Page>
    <PageHeader crumbs={['Marketing', 'Growth', 'แผน']} back={{ to: '/marketing/growth/plans', label: 'แผนทั้งหมด' }} title="รายละเอียดแผน" />
    <LoadState state={loaded} />
  </Page>;
  return <Page>
    <PageHeader crumbs={['Marketing', 'Growth', id ? 'รายละเอียดแผน' : 'สร้างแผน']} back={{ to: '/marketing/growth/plans', label: 'แผนและปฏิทิน' }} title={plan?.title ?? 'สร้างแผน Growth'}
      badge={plan ? <PlanStatus status={plan.status} /> : <Chip>ร่างใหม่</Chip>} subtitle="ร่างข้อเสนอและข้อความ ตรวจหลักฐาน แล้วอนุมัติ revision ก่อนสร้าง workflow ที่หยุดไว้"
      actions={plan?.workflowId ? <><ButtonLink to={`/marketing/workflows/${encodeURIComponent(plan.workflowId)}/edit`} icon="account_tree">เปิดร่าง workflow</ButtonLink><ButtonLink to={`/marketing/growth/results/${encodeURIComponent(plan.workflowId)}`} icon="monitoring">ดูผล</ButtonLink></> : undefined} />
    {note && <Alert tone={note.ok ? 'ok' : 'danger'} onClose={() => setNote(null)} actions={!note.ok && id ? <Button size="sm" onClick={() => { setNote(null); loaded.reload(); }}>โหลดเวอร์ชันล่าสุด</Button> : undefined}>{note.text}</Alert>}
    {!canManage && <Alert tone="muted">แผนนี้อ่านได้ การแก้เนื้อหาและอนุมัติเป็นหน้าที่เจ้าของแผนหรือผู้ดูแล</Alert>}
    {dirty && <Alert tone="warn">มีเนื้อหาที่แก้แล้วยังไม่บันทึก บันทึกก่อนใช้ AI ส่งตรวจ อนุมัติ หรือสร้างร่าง workflow</Alert>}
    <Alert tone="warn" title="แผนนี้ยังไม่พร้อมเปิดส่งอัตโนมัติ">การบันทึก อนุมัติ และสร้างร่างไม่ส่งข้อความ ระบบยังไม่บังคับสต็อก กำไร และงบ ณ เวลาส่ง จึงต้องหยุด workflow นี้ไว้{readiness.data?.activationBlockers.length ? <ul className="list-disc pl-4 mt-2">{readiness.data.activationBlockers.map((item) => <li key={item}>{item}</li>)}</ul> : null}</Alert>
    {plan && <DetailPanel title="สถานะการตรวจ" subtitle={`revision ${plan.version}`} status={<PlanStatus status={plan.status} />}>
      <KeyValueGrid items={[{ label: 'เจ้าของงาน', value: plan.owner }, { label: 'ผู้อนุมัติ', value: plan.approvedBy }, { label: 'revision ที่อนุมัติ', value: plan.approvedVersion }, { label: 'แก้ไขล่าสุด', value: fmt.when(plan.updatedAt) }]} />
      <div className="flex flex-wrap gap-2">
        {canManage && plan.status === 'draft' && <Button disabled={!!busy || dirty || tasksDirty} icon="rate_review" onClick={() => act('review', () => api.post(`/growth/plans/${encodeURIComponent(plan.id)}/review`, { version: plan.version }), 'ส่ง revision นี้ให้ตรวจแล้ว')}>ส่งตรวจ</Button>}
        {admin && plan.status === 'review' && <Button variant="primary" disabled={!!busy || dirty || tasksDirty} icon="verified" onClick={() => act('approve', () => api.post(`/growth/plans/${encodeURIComponent(plan.id)}/approve`, { version: plan.version }), 'อนุมัติ revision นี้แล้ว · ยังไม่มีการส่งข้อความ')}>อนุมัติ revision {plan.version}</Button>}
        {canManage && plan.status === 'approved' && <Button variant="primary" disabled={!!busy || dirty || tasksDirty || !readiness.data?.workflow} icon="account_tree" onClick={() => act('export', () => api.post(`/growth/plans/${encodeURIComponent(plan.id)}/export`, { version: plan.version }), 'สร้างร่าง workflow แล้วและหยุดไว้ · ไม่มีการส่งข้อความ')}>{busy === 'export' ? 'กำลังสร้างร่าง…' : 'สร้างร่าง workflow ที่หยุดไว้'}</Button>}
      </div>
      {!readiness.loading && !readiness.data?.workflow && <p className="text-xs text-on-surface-variant">ยังไม่เชื่อม workflow บันทึกและตรวจแผนได้ เมื่อต่อระบบแล้วจึงสร้างร่าง</p>}
      {plan.workflowId && <Alert tone="info">แก้กราฟใน workflow ได้ การแก้กราฟจะยกเลิกการอนุมัติเดิม ต้องตรวจแผนใหม่ก่อนทำต่อ และยังเปิดส่งแผนนี้ไม่ได้</Alert>}
      {exportPending && <Alert tone="warn" title="ตรวจ workflow ที่อาจสร้างแล้วก่อนทำต่อ"><p>ระบบไม่สร้างซ้ำอัตโนมัติ ให้ผู้ดูแลตรวจรายการ workflow แล้วเชื่อมร่างที่มี marker ของแผนนี้และสถานะ draft / paused</p><div className="mt-2"><ArrowLink to="/marketing/workflows">ตรวจรายการ workflow</ArrowLink></div></Alert>}
      {admin && exportPending && <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void act('reconcile', () => api.post(`/growth/plans/${encodeURIComponent(plan.id)}/reconcile`, { version: plan.version, workflowId: recoveryId }), 'ตรวจและเชื่อมร่าง workflow ที่หยุดไว้แล้ว'); }}>
        <Field label="Workflow UUID ที่ตรวจพบ"><Input required value={recoveryId} onChange={(event) => setRecoveryId(event.target.value)} disabled={!!busy} /></Field><Button type="submit" disabled={!!busy || dirty || tasksDirty}>ตรวจและเชื่อมร่าง</Button>
      </form>}
    </DetailPanel>}
    <fieldset disabled={!canManage || !!busy || exportPending} className="min-w-0 space-y-4">
      <FormPanel title="แผนและข้อความ" icon="edit_note" description="ข้อความสองเวอร์ชันเป็นร่าง เลือกเวอร์ชันที่ทีมจะตรวจและใช้" cols={2} onSubmit={save} onCancel={() => navigate('/marketing/growth/plans')}
        busy={!!busy || !canManage || exportPending} submitLabel={busy === 'save' ? 'กำลังบันทึก…' : !canManage ? 'อ่านอย่างเดียว' : 'บันทึกร่าง'}>
        <Field label="ชื่อแผน"><Input required maxLength={200} value={form.title} onChange={(event) => update('title', event.target.value)} placeholder="เช่น ติดตามลูกค้าที่เลยรอบซื้อ" /></Field>
        <Field label="ประเภทแผน"><Select value={form.template} onChange={(event) => update('template', event.target.value as GrowthTemplate)}>{Object.entries(templateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
        <Span><Field label="เป้าหมายและข้อเสนอที่ต้องตรวจ"><Textarea required rows={3} maxLength={2000} value={form.goal} onChange={(event) => update('goal', event.target.value)} placeholder="ระบุสิ่งที่ต้องการให้ลูกค้าทำ พร้อมข้อเสนอที่ยืนยันแล้ว" /></Field></Span>
        <Field label="เจ้าของแผน (อีเมล)"><Input required type="email" value={form.owner} onChange={(event) => update('owner', event.target.value)} /></Field>
        <Field label="วันที่วางแผนทำงาน" hint="กำหนดการของทีม ยังไม่ตั้งเวลาส่งข้อความ"><Input type="datetime-local" value={localDateTime(form.scheduleAt)} onChange={(event) => update('scheduleAt', event.target.value ? new Date(event.target.value).toISOString() : null)} /></Field>
        <Field label="งบสูงสุดของแผน (บาท)"><Input required type="number" min={0} max={10000000} step="0.01" value={form.budgetThb} onChange={(event) => update('budgetThb', Number(event.target.value))} /></Field>
        <Field label="อัตรา contribution ขั้นต่ำ (%)" hint="เกณฑ์ของแผน ยังไม่บังคับตรวจ ณ เวลาส่ง"><Input required type="number" min={0} max={100} step="0.1" value={form.minimumMarginPercent} onChange={(event) => update('minimumMarginPercent', Number(event.target.value))} /></Field>
        <Span><details className="rounded-lg border border-secondary-container p-3"><summary className="text-xs font-semibold text-primary cursor-pointer">กลุ่มเป้าหมาย สินค้า และการทดลอง</summary><div className="grid gap-3 md:grid-cols-2 mt-3">
          <Field label="Segment IDs" hint="UUID เท่านั้น คั่นด้วย comma · ตรวจจากหน้า Segments"><CommaInput uuid value={form.segmentIds} onChange={(value) => update('segmentIds', value)} placeholder="ระบุกลุ่มที่ยืนยันแล้วก่อนส่งตรวจ" /></Field>
          <Field label="Exclude segment IDs" hint="UUID เท่านั้น คั่นด้วย comma"><CommaInput uuid value={form.excludeSegmentIds} onChange={(value) => update('excludeSegmentIds', value)} /></Field>
          <Field label="SKU ที่ใช้" hint="คั่นด้วย comma · ต้องตรวจสต็อกและราคาจริงอีกครั้ง"><CommaInput value={form.productSkus} onChange={(value) => update('productSkus', value)} /></Field>
          <Field label="ใช้ notification template เดิม (ไม่บังคับ)" hint="เว้นว่างเพื่อสร้าง template จากข้อความที่เลือก หากระบุ key เนื้อหาต้องตรงกับเวอร์ชันที่อนุมัติ"><Input value={form.notifyTemplateKey ?? ''} onChange={(event) => update('notifyTemplateKey', event.target.value || null)} /></Field>
          <Field label="กลุ่มควบคุม (%)"><Input required type="number" min={1} max={50} value={form.holdoutPercent} onChange={(event) => update('holdoutPercent', Number(event.target.value))} /></Field>
          <Field label="เว้นช่วงติดต่อ (วัน)"><Input required type="number" min={1} max={365} value={form.cooldownDays} onChange={(event) => update('cooldownDays', Number(event.target.value))} /></Field>
          <Field label="ช่วงนับ conversion (วัน)"><Input required type="number" min={1} max={90} value={form.conversionWindowDays} onChange={(event) => update('conversionWindowDays', Number(event.target.value))} /></Field>
          <div className="flex flex-wrap items-center gap-3"><ArrowLink to="/j/segments">ตรวจ Segments</ArrowLink><ArrowLink to="/j/marketing/notify-templates">ตรวจ template ข้อความ</ArrowLink></div>
        </div></details></Span>
        <Span><div className="grid gap-3 md:grid-cols-2">{form.variants.map((variant, index) => <section key={index} className={`rounded-lg border p-3 space-y-3 min-w-0 ${form.selectedVariant === index ? 'border-primary bg-primary-container/20' : 'border-secondary-container'}`}>
          <label className="flex items-center gap-2 text-xs font-semibold"><input type="radio" name="selected-variant" checked={form.selectedVariant === index} onChange={() => update('selectedVariant', index)} className="accent-primary" />เลือกเวอร์ชัน {variant.label} สำหรับตรวจ</label>
          <Field label={`หัวข้อความ ${variant.label}`}><Input maxLength={200} value={variant.title} onChange={(event) => update('variants', form.variants.map((item, at) => at === index ? { ...item, title: event.target.value } : item))} /></Field>
          <Field label={`เนื้อหาข้อความ ${variant.label}`}><Textarea rows={5} maxLength={4000} value={variant.body} onChange={(event) => update('variants', form.variants.map((item, at) => at === index ? { ...item, body: event.target.value } : item))} /></Field>
          <Field label={`Evidence IDs ของ ${variant.label}`} hint="อ้างอิง ID จากหลักฐานด้านล่าง คั่นด้วย comma"><CommaInput value={variant.evidenceIds} onChange={(value) => update('variants', form.variants.map((item, at) => at === index ? { ...item, evidenceIds: value } : item))} /></Field>
        </section>)}</div></Span>
        {form.researchTopicId && <Span><Alert tone="info">แผนนี้เชื่อม Research topic {form.researchTopicId}{form.researchRunId ? ` · รายงาน ${form.researchRunId}` : ''} หลักฐานจะตรวจจากรายงานนี้เมื่อบันทึก</Alert></Span>}
      </FormPanel>
    </fieldset>
    <Panel><PanelHead title="ผู้ช่วย AI ร่างข้อความ" icon="auto_awesome" sub="ตรวจและเลือกใช้ก่อนบันทึก · AI ไม่เปลี่ยนแผนเอง" />
      <div className="p-4 space-y-3"><LoadState state={readiness} />
        {!readiness.loading && !readiness.data?.ai && <Alert tone="muted">ยังไม่เชื่อม AI เขียนข้อความและบันทึกแผนด้วยตัวเองได้</Alert>}
        {!plan && <p className="text-xs text-on-surface-variant">บันทึกร่างก่อน เพื่อให้ AI ใช้แผนและหลักฐานเวอร์ชันเดียวกับทีม</p>}
        <Field label="คำสั่งสำหรับ AI"><Textarea rows={3} maxLength={2000} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="เช่น ร่างสองข้อความที่ชัดเจน โดยใช้ข้อเสนอและหลักฐานที่ยืนยันแล้ว" disabled={!canManage || !!busy} /></Field>
        <Button onClick={draftAi} disabled={!plan || !canManage || !!busy || dirty || exportPending || !instruction.trim() || !readiness.data?.ai} icon="auto_awesome">{busy === 'ai' ? 'กำลังร่าง…' : 'ให้ AI ร่าง 2 เวอร์ชัน'}</Button>
        {ai && <div className="rounded-lg border border-primary/30 bg-primary-container/20 p-3 space-y-3">
          <p className="text-xs text-on-surface-variant">เหตุผล: {ai.rationale}</p>
          <div className="grid gap-3 md:grid-cols-2">{ai.variants.map((variant, index) => <article key={index} className="rounded bg-surface-container-lowest p-3 min-w-0"><h3 className="font-semibold text-xs">{variant.label} · {variant.title}</h3><p className="text-xs whitespace-pre-wrap break-words mt-2">{variant.body}</p><p className="text-[10px] font-mono text-outline mt-2 break-all">อ้างอิง: {variant.evidenceIds.join(', ') || 'ไม่มี'}</p></article>)}</div>
          <p className="text-[11px] text-outline break-all">หลักฐานที่ใช้: {ai.evidenceIds.join(', ') || 'ไม่มี'}</p>
          <Button variant="primary" onClick={() => { update('variants', ai.variants); update('selectedVariant', 0); setAi(null); setNote({ ok: true, text: 'นำข้อความ AI มาใส่ในร่างแล้ว ตรวจเนื้อหาและกดบันทึกก่อนส่งตรวจ' }); }}>นำมาใส่ในร่างเพื่อแก้และบันทึก</Button>
        </div>}
      </div>
    </Panel>
    <Panel><PanelHead title="ขั้นตอนของร่าง workflow" icon="account_tree" sub="preview · ไม่ส่งข้อความ" /><div className="p-4 grid gap-2 md:grid-cols-4">
      {[{ title: '1. Trigger', body: templateLabels[form.template] }, { title: '2. กลุ่มเป้าหมาย', body: `${form.segmentIds.length} กลุ่ม · ยกเว้น ${form.excludeSegmentIds.length}` }, { title: '3. ทดลองและความถี่', body: `holdout ${form.holdoutPercent}% · cooldown ${form.cooldownDays} วัน` }, { title: '4. ข้อความที่เลือก', body: `${form.variants[form.selectedVariant]?.label ?? '—'} · ${form.variants[form.selectedVariant]?.title || 'ยังไม่ระบุ'}` }].map((step) => <div key={step.title} className="rounded-lg border border-secondary-container bg-surface-container-low p-3 min-w-0"><h3 className="text-[11px] font-semibold text-primary">{step.title}</h3><p className="mt-1 text-xs break-words">{step.body}</p></div>)}
    </div></Panel>
    {plan && <>
      <Panel><PanelHead title="หลักฐานของแผน" icon="fact_check" actions={<ArrowLink to="/marketing/research">Research</ArrowLink>} /><div className="p-4"><Evidence items={plan.evidence} /></div></Panel>
      <Panel><PanelHead title="งานที่ทีมต้องรับต่อ" icon="task_alt" sub={`${tasks.filter((task) => task.done).length} / ${tasks.length} เสร็จแล้ว`} actions={canManage && !exportPending ? <Button size="sm" disabled={!!busy || dirty} icon="add" onClick={() => setTasks((old) => [...old, { id: crypto.randomUUID(), title: '', owner: currentEmail, dueAt: null, done: false }])}>เพิ่มงาน</Button> : undefined} />
        <form onSubmit={(event) => { event.preventDefault(); if (tasksDirty && !dirty) void act('tasks', () => api.put(`/growth/plans/${encodeURIComponent(plan.id)}/tasks`, { version: plan.version, tasks }), 'บันทึกงานของทีมแล้ว'); }}>
          <div className="p-4 space-y-3">{!tasks.length && <p className="text-xs text-on-surface-variant">ยังไม่มีงาน ตรวจกลุ่มเป้าหมาย สินค้า ข้อเสนอ หรือมอบหมายฝ่ายขายก่อนเปิดใช้งาน</p>}
            {tasks.map((task, index) => { const canEdit = canManage; return <fieldset key={task.id} disabled={!canEdit || !!busy || exportPending} className="grid gap-3 md:grid-cols-4 rounded-lg border border-secondary-container p-3 min-w-0">
              <Field label={`งาน ${index + 1}`}><Input required maxLength={500} value={task.title} onChange={(event) => setTasks((old) => old.map((item) => item.id === task.id ? { ...item, title: event.target.value } : item))} /></Field>
              <Field label={`เจ้าของงาน ${index + 1}`}><Input required type="email" value={task.owner} disabled={!canManage} onChange={(event) => setTasks((old) => old.map((item) => item.id === task.id ? { ...item, owner: event.target.value } : item))} /></Field>
              <Field label={`กำหนดเสร็จ ${index + 1}`}><Input type="datetime-local" value={localDateTime(task.dueAt)} onChange={(event) => setTasks((old) => old.map((item) => item.id === task.id ? { ...item, dueAt: event.target.value ? new Date(event.target.value).toISOString() : null } : item))} /></Field>
              <div className="flex items-center gap-3"><Checkbox label="เสร็จแล้ว" checked={task.done} onChange={(event) => setTasks((old) => old.map((item) => item.id === task.id ? { ...item, done: event.target.checked } : item))} />{canManage && <Button variant="danger-ghost" size="sm" onClick={() => setTasks((old) => old.filter((item) => item.id !== task.id))}>ลบงาน</Button>}</div>
            </fieldset>; })}
          </div>
          {tasksDirty && <div className="px-4 pb-4"><Button type="submit" variant="primary" disabled={!!busy || dirty || exportPending}>บันทึกงานของทีม</Button></div>}
        </form>
      </Panel>
      <Panel><PanelHead title="ประวัติ revision และการตรวจ" icon="history" /><Table><THead><TH>เวลา</TH><TH>ผู้ทำรายการ</TH><TH>การเปลี่ยนแปลง</TH><TH kind="num">Revision</TH></THead><TBody>{plan.history.map((item, index) => <TR key={index}><TD kind="time">{fmt.when(item.at)}</TD><TD>{item.actor}</TD><TD>{item.action}</TD><TD kind="num">{item.version}</TD></TR>)}</TBody></Table></Panel>
    </>}
  </Page>;
}
