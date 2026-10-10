import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Chip, Empty, Loading, PageHeader, Panel, PanelHead, TaskInput, TaskSelect, useUiLocale } from '@cp/ui';
import { canSaveGoal, GOAL_API as endpoint, GOAL_HOME as home, goalDraftPageSchema, goalInputsSchema, goalPreviewSchema, goalPreviewUrl, goalReceiptSchema, goalRoles, goalPeriod, goalUuid as uuid, type GoalPreview, type GoalReceipt } from '../../../../../commerce-platform/src/modules/integration/financial-goals/financial-goals';
import { api, session } from '../../../lib/api';
import { normalizeRole } from '../../../lib/role-home';
import { CommercePage } from '../../CommercePage';
import { commerceText as text } from '../../commerce-copy';
import { useAsync, useMutation } from '../../hooks';
import { WorkspaceLink } from '../../WorkspaceParts';
import { friendlyError } from '../planning/promotion-contracts';
import { PlanningError as ErrorText } from '../planning/PlanningError';
import { GoalEvidence, GoalSources, goalLabel } from './GoalEvidence';
import { dateText } from '../pack-price/pack-copy';
import { blankGoalForm, buildGoalScenario, clearGoalForm, clearGoalJob, formFromGoal, goalPacket, readGoalForm, readGoalJobs, storeGoalForm, storeGoalJob, verifyGoalJob, type GoalForm, type GoalSaveJob } from './goal-form';

const detailUrl = (id: string) => `${home}/drafts/${id}`;
const requestUrl = (id: string) => `${home}/requests/${id}`;
const steps = ['target', 'assumptions', 'review'] as const;
type Step = typeof steps[number];
const stepLabel = (s: Step) => text(...({ target: ['กำหนดเป้าและเดือน', 'Set target and month'], assumptions: ['ตรวจข้อมูลและสมมติฐาน', 'Review sources and assumptions'], review: ['ทบทวนและเก็บร่าง', 'Review and retain draft'] } as Record<Step, [string, string]>)[s]);
async function readable<T>(run: () => Promise<T>): Promise<T> { try { return await run(); } catch (e) { throw new Error(friendlyError(e)); } }
function parseReceipt(raw: unknown, id?: string) { const value = goalReceiptSchema.parse(raw); if (id && id !== value.id) throw Error('Draft identity mismatch'); return value; }
function useJobs(owner: string) {
  const [jobs, setJobs] = useState(() => readGoalJobs(owner));
  useEffect(() => { const refresh = () => setJobs(readGoalJobs(owner)); refresh(); window.addEventListener('storage', refresh); window.addEventListener('cp-financial-goal-journal', refresh); return () => { window.removeEventListener('storage', refresh); window.removeEventListener('cp-financial-goal-journal', refresh); }; }, [owner]);
  return jobs;
}
export function useGoalWriter(owner: string) {
  const lock = useRef(false), mounted = useRef(true), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function write(job: GoalSaveJob): Promise<GoalReceipt | null> {
    if (lock.current || !mounted.current) return null;
    lock.current = true; setBusy(true); setError(null);
    try {
      try { storeGoalJob(job); } catch { throw Error(text('ยังเก็บคำขอกู้คืนไม่ได้ จึงยังไม่ส่งบันทึก ตรวจพื้นที่เบราว์เซอร์แล้วลองใหม่', 'Recovery storage is unavailable. No save was sent. Check browser storage and retry.')); }
      let receipt: GoalReceipt;
      try { receipt = verifyGoalJob(parseReceipt(job.draftId ? await api.patch(`${endpoint}/drafts/${job.draftId}`, goalPacket(job)) : await api.post(`${endpoint}/drafts`, goalPacket(job)), job.draftId ?? undefined), job); }
      catch (e) { if ((e as { status?: number }).status === 409) { try { storeGoalJob({ ...job, conflict: true }); } catch { /* Retain the original immutable request. */ } } throw Error(text('ยังยืนยันผลบันทึกไม่ได้ ตรวจคำขอเดิมก่อนส่งซ้ำ', 'The save result is unverified. Check this request before submitting again.')); }
      try { clearGoalForm(owner, job.draftId ?? undefined); clearGoalJob(owner, job.requestId); } catch { /* An already committed receipt still establishes success. */ }
      return mounted.current ? receipt : null;
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : friendlyError(e)); return null; }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return { write, busy, error };
}
export default function GoalPlanningWorkspace({ role = session.claims()?.role }: { role?: string }) {
  useUiLocale(); const { pathname } = useLocation(), normalized = normalizeRole(role), owner = String(session.claims()?.sub ?? '');
  if (!goalRoles.some(r => r === normalized)) return <CommercePage><PageHeader title={text('วางแผนเป้ากำไรและต้นทุน', 'Plan profit and cost goals')} /><Alert tone="danger">{text('บัญชีนี้ไม่มีสิทธิ์อ่านบริบทการเงินของทีมเดิม', 'This account cannot read the existing team financial context.')}</Alert></CommercePage>;
  if (!owner) return <CommercePage><Alert tone="danger">{text('ยังยืนยันบัญชีไม่ได้ โปรดเข้าสู่ระบบใหม่', 'The account could not be verified. Sign in again.')}</Alert></CommercePage>;
  const path = pathname.replace(/\/$/, '');
  if (path === home) return <DraftIndex owner={owner} role={normalized} />;
  if (path === `${home}/new`) return <Navigate to={`${home}/new/target`} replace />;
  const create = path.match(/^\/planning\/profit-goals\/new\/(target|assumptions|review)$/);
  if (create) return <DraftEditor key={`${owner}:${normalized}:new`} owner={owner} role={normalized} step={create[1] as Step} />;
  const match = path.match(/^\/planning\/profit-goals\/(drafts|requests)\/([^/]+)(?:\/edit(?:\/(target|assumptions|review))?)?$/), id = uuid.safeParse(match?.[2]);
  if (!match || !id.success || match[1] === 'requests' && path.includes('/edit')) return <CommercePage><Alert tone="danger">{text('ลิงก์ร่างไม่ถูกต้อง', 'Invalid planning draft link.')}</Alert><WorkspaceLink to={home}>{text('กลับไปร่างเป้ากำไรและต้นทุน', 'Open goal planning drafts')}</WorkspaceLink></CommercePage>;
  if (match[1] === 'requests') return <RequestRecovery key={`${owner}:${id.data}`} owner={owner} role={normalized} requestId={id.data} />;
  if (path.endsWith('/edit')) return <Navigate to={`${detailUrl(id.data)}/edit/target`} replace />;
  return match[3] ? <DraftEditor key={`${owner}:${normalized}:${id.data}`} owner={owner} role={normalized} draftId={id.data} step={match[3] as Step} /> : <DraftDetail key={`${owner}:${id.data}`} draftId={id.data} role={normalized} />;
}
function PendingRequests({ owner }: { owner: string }) {
  const jobs = useJobs(owner);
  return jobs.length ? <Panel><PanelHead title={text('คำขอที่ต้องตรวจผล', 'Requests with unverified results')} /><div className="p-4 space-y-3"><p>{text('ยังไม่นับเป็นร่างที่บันทึกแล้ว', 'These requests are not counted as saved drafts.')}</p>{jobs.map(job => <WorkspaceLink key={job.requestId} to={requestUrl(job.requestId)}>{job.scenario.name} · {text('ตรวจผลบันทึก', 'Check save result')}</WorkspaceLink>)}</div></Panel> : null;
}
function DraftIndex({ owner, role }: { owner: string; role: string }) {
  const [query] = useSearchParams(), after = query.get('after'), valid = !after || uuid.safeParse(after).success;
  const list = useAsync(() => valid ? readable(async () => goalDraftPageSchema.parse(await api.get(`${endpoint}/drafts${after ? `?after=${after}` : ''}`))) : Promise.resolve(null), [after, valid]);
  return <CommercePage><PageHeader title={text('ร่างเป้ากำไรและต้นทุน', 'Profit and cost planning drafts')} subtitle={text('กำหนดเป้ารายเดือน ตรวจข้อมูลที่ยังขาด และทบทวนสมมติฐานก่อนเก็บร่าง', 'Set a monthly target and review source coverage and optional hypothetical inputs.')} actions={<WorkspaceLink to={`${home}/new/target`}>{text('เริ่มวางแผนเป้ากำไรและต้นทุน', 'Start a profit and cost plan')}</WorkspaceLink>} />
    <Alert tone="muted">{text('ใช้สิทธิ์รายงานทีมเดิม: Admin, หัวหน้าฝ่ายขาย และ BA · บันทึกได้เฉพาะ Admin', 'Uses existing team-report access: admin, sales manager and BA. Saving remains admin-only.')}</Alert>
    {!canSaveGoal(role) && <Alert tone="muted">{text('บัญชีนี้อ่านและทดลองได้ตามสิทธิ์เดิม บันทึกและแก้ร่างได้เฉพาะ Admin', 'This account can preview under existing read permissions; only admin can save or edit drafts.')}</Alert>}
    <PendingRequests owner={owner} /><ErrorText error={list.error} onRetry={list.reload} />{!valid ? <Alert tone="danger">{text('ลิงก์หน้ารายการไม่ถูกต้อง', 'Invalid list cursor.')}<WorkspaceLink to={home}>{text('กลับหน้าแรก', 'Open the first page')}</WorkspaceLink></Alert> : list.loading ? <Loading variant="table" /> : list.data && !list.error && <>
      <p role="status">{text('ร่างที่อ่านพบในหน้านี้', 'Drafts returned on this page')}: {list.data.items.length}</p>{!list.data.items.length ? <Empty>{text('ยังไม่มีร่างในหน้านี้ เริ่มวางแผนหรือกลับหน้ารายการแรก', 'No drafts on this page. Start planning or return to the first page.')}</Empty> : <div className="grid gap-4 lg:grid-cols-2">{list.data.items.map(draft => <Panel key={draft.id}><div className="p-4 space-y-3"><Chip tone="ok">{text('บันทึกร่างแล้ว', 'Draft saved')}</Chip><WorkspaceLink to={detailUrl(draft.id)}>{draft.scenario.name}</WorkspaceLink><p>{draft.scenario.period} · {goalLabel(draft.scenario.metric)} · {text('ฉบับ', 'Revision')} {draft.revision}</p></div></Panel>)}</div>}
      <div className="flex flex-wrap gap-3">{after && <WorkspaceLink to={home}>{text('กลับหน้าแรก', 'First page')}</WorkspaceLink>}{list.data.next && <WorkspaceLink to={`${home}?after=${list.data.next}`}>{text('รายการถัดไป', 'Next page')}</WorkspaceLink>}<Button onClick={list.reload}>{text('อ่านใหม่', 'Refresh')}</Button></div>
    </>}
  </CommercePage>;
}
function DraftDetail({ draftId, role }: { draftId: string; role: string }) {
  const [params] = useSearchParams(), requested = params.get('saved'), valid = uuid.safeParse(requested);
  const detail = useAsync(() => readable(async () => parseReceipt(await api.get(`${endpoint}/drafts/${draftId}`), draftId)), [draftId]);
  const proof = useAsync(() => valid.success ? readable(async () => parseReceipt(await api.get(`${endpoint}/requests/${valid.data}`), draftId)) : Promise.resolve(null), [draftId, requested]);
  return <CommercePage><WorkspaceLink to={home}>{text('กลับไปร่างเป้ากำไรและต้นทุน', 'Back to goal planning drafts')}</WorkspaceLink><PageHeader title={detail.data?.scenario.name ?? text('ร่างเป้ากำไรและต้นทุน', 'Profit and cost goal draft')} actions={canSaveGoal(role) && <WorkspaceLink to={`${detailUrl(draftId)}/edit/target`}>{text('แก้ไขร่าง', 'Edit draft')}</WorkspaceLink>} />
    {proof.data && !proof.error && <Alert tone="ok"><span role="status">{text('ยืนยันคำขอบันทึกนี้แล้ว', 'This save request is verified.')} · {text('ฉบับ', 'Revision')} {proof.data.revision}</span></Alert>}
    {requested && (!valid.success || proof.error) && <Alert tone="warn">{text('ยังยืนยันคำขอนี้ไม่ได้ สถานะร่างด้านล่างมาจากผลอ่านล่าสุด', 'This request is unverified. The draft below comes from the latest read.')}</Alert>}
    <ErrorText error={detail.error} onRetry={detail.reload} />{detail.loading ? <Loading variant="detail" /> : detail.data && !detail.error && <><div className="flex gap-3 flex-wrap"><Chip tone="ok">{text('บันทึกร่างแล้ว', 'Draft saved')}</Chip><Chip tone="muted">{text('ฉบับ', 'Revision')} {detail.data.revision}</Chip><Button onClick={detail.reload}>{text('อ่านร่างใหม่', 'Refresh draft')}</Button></div><p className="text-sm">{text('หลักฐานเก็บพร้อมร่างเมื่อ', 'Evidence retained with this draft at')}: {dateText(detail.data.inputs.capturedAt)}</p><GoalEvidence value={detail.data} /></>}
  </CommercePage>;
}
function RequestRecovery({ owner, requestId, role }: { owner: string; requestId: string; role: string }) {
  const jobs = useJobs(owner), job = jobs.find(j => j.requestId === requestId), writer = useGoalWriter(owner), navigate = useNavigate();
  const lookup = useAsync(async () => { try { const receipt = parseReceipt(await api.get(`${endpoint}/requests/${requestId}`)); if (job) verifyGoalJob(receipt, job); return { receipt, absent: false }; } catch (e) { if ((e as { status?: number }).status === 404) return { receipt: null, absent: true }; throw Error(friendlyError(e)); } }, [requestId]);
  const resolved = lookup.data?.receipt;
  useEffect(() => { if (!resolved) return; try { if (job) clearGoalForm(owner, job.draftId ?? undefined); clearGoalJob(owner, requestId); } catch { /* Verified persisted receipt remains visible. */ } }, [resolved, owner, requestId]);
  async function retry() { if (!job || !lookup.data?.absent || job.conflict || !canSaveGoal(role)) return; const result = await writer.write(job); if (result) navigate(`${detailUrl(result.id)}?saved=${requestId}`, { replace: true }); else lookup.reload(); }
  return <CommercePage><WorkspaceLink to={home}>{text('กลับไปร่าง', 'Back to drafts')}</WorkspaceLink><PageHeader title={text('ตรวจผลคำขอบันทึก', 'Check save request')} subtitle={job?.scenario.name} /><ErrorText error={lookup.error} onRetry={lookup.reload} />{lookup.loading ? <Loading variant="detail" /> : lookup.error ? null : resolved ? <><Alert tone="ok"><span role="status">{text('พบหลักฐานบันทึกร่างแล้ว', 'Saved draft receipt verified.')}</span></Alert><WorkspaceLink to={`${detailUrl(resolved.id)}?saved=${requestId}`}>{text('เปิดร่างที่บันทึกแล้ว', 'Open saved draft')}</WorkspaceLink><GoalEvidence value={resolved} /></> : <><Alert tone="warn">{text('ยังไม่พบหลักฐานคำขอที่บันทึกแล้ว จึงยังไม่แสดงว่าบันทึกสำเร็จ', 'No committed receipt was found. This request is not marked successful.')}</Alert>{job ? job.conflict ? <><Alert tone="warn">{text('ฉบับร่างหรือหลักฐานเปลี่ยน เปิดข้อมูลล่าสุดเพื่อทบทวนก่อนเริ่มคำขอใหม่', 'The draft revision or evidence changed. Review current data before starting a new request.')}</Alert><WorkspaceLink to={job.draftId ? `${detailUrl(job.draftId)}/edit/target` : `${home}/new/target`}>{text('เปิดข้อมูลล่าสุด', 'Review current data')}</WorkspaceLink><Button onClick={() => { try { clearGoalJob(owner, requestId); navigate(home); } catch { lookup.reload(); } }}>{text('ยกเลิกคำขอที่ไม่สำเร็จ', 'Dismiss unsuccessful request')}</Button></> : canSaveGoal(role) && <Button disabled={writer.busy} onClick={retry}>{text('ลองส่งคำขอเดิมอีกครั้ง', 'Retry the same request')}</Button> : <Empty>{text('ไม่มีคำขอเดิมในเบราว์เซอร์นี้ เปิดร่างหรืออ่านผลอีกครั้ง', 'The original request is unavailable in this browser. Inspect drafts or check again.')}</Empty>}<Button disabled={writer.busy} onClick={lookup.reload}>{text('ตรวจผลอีกครั้ง', 'Check again')}</Button></>}<ErrorText error={writer.error} /></CommercePage>;
}
function DraftEditor({ owner, role, draftId, step }: { owner: string; role: string; draftId?: string; step: Step }) {
  const original = useAsync(() => draftId ? readable(async () => parseReceipt(await api.get(`${endpoint}/drafts/${draftId}`), draftId)) : Promise.resolve(null), [draftId]);
  if (draftId && !canSaveGoal(role)) return <CommercePage><Alert tone="muted">{text('บัญชีนี้ยังแก้ร่างไม่ได้ตามสิทธิ์อ่านเดิม', 'This account retains read-only access and cannot edit drafts.')}</Alert><WorkspaceLink to={detailUrl(draftId)}>{text('อ่านร่างนี้', 'Read this draft')}</WorkspaceLink></CommercePage>;
  if (draftId && original.loading) return <CommercePage><Loading variant="detail" /></CommercePage>;
  if (draftId && (original.error || !original.data)) return <CommercePage><ErrorText error={original.error} onRetry={original.reload} /></CommercePage>;
  return <EditorForm key={`${draftId ?? 'new'}:${original.data?.revision ?? 0}`} owner={owner} role={role} original={original.data} step={step} />;
}
function EditorForm({ owner, role, original, step }: { owner: string; role: string; original: GoalReceipt | null; step: Step }) {
  const id = original?.id, revision = original?.revision ?? null, backup = useRef(readGoalForm(owner, id));
  const [form, setForm] = useState<GoalForm>(() => backup.current?.revision === revision ? backup.current.form : original ? formFromGoal(original.scenario) : blankGoalForm());
  const [backupChoice, setBackupChoice] = useState(backup.current && backup.current.revision !== revision ? 'pending' : 'latest'), [backupError, setBackupError] = useState<string | null>(null), [errors, setErrors] = useState<Record<string, string>>({}), [changed, setChanged] = useState(false), [preview, setPreview] = useState<GoalPreview | null>(null);
  const source = useAsync(() => goalPeriod.safeParse(form.period).success ? readable(async () => { const v = goalInputsSchema.parse(await api.get(`${endpoint}/inputs/${form.period}`)); if (v.period !== form.period) throw Error('Goal period mismatch'); return v; }) : Promise.resolve(null), [form.period]);
  const previewWork = useMutation(), writer = useGoalWriter(owner), jobs = useJobs(owner), pending = jobs.find(j => j.draftId === (id ?? null)), lock = useRef(false), mounted = useRef(true), currentStep = useRef(step), intentVersion = useRef(0), navigate = useNavigate();
  const base = id ? `${detailUrl(id)}/edit` : `${home}/new`, inputs = source.data?.period === form.period ? source.data : null, busy = source.loading || previewWork.busy || writer.busy, disabled = busy || !!pending || backupChoice === 'pending';
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { currentStep.current = step; }, [step]);
  useEffect(() => { if (backupChoice === 'pending') return; try { storeGoalForm(owner, id, revision, form); setBackupError(null); } catch { setBackupError(text('ยังเก็บค่าที่กรอกเพื่อทำต่อไม่ได้ อย่าปิดหน้าจนกว่าจะบันทึก', 'Form recovery is unavailable. Keep this page open until saved.')); } }, [owner, id, revision, form, backupChoice]);
  useEffect(() => { if (!inputs) return; intentVersion.current++; if (form.sourceFingerprint && form.sourceFingerprint !== inputs.sourceFingerprint) setChanged(true); setForm(f => f.period !== inputs.period || f.sourceFingerprint === inputs.sourceFingerprint ? f : { ...f, sourceFingerprint: inputs.sourceFingerprint }); setPreview(null); }, [inputs]);
  function change(key: keyof GoalForm, value: string | boolean) { intentVersion.current++; setForm(f => ({ ...f, [key]: value })); setPreview(null); setErrors({}); }
  async function review() {
    const parsed = buildGoalScenario(form); setErrors(parsed.errors); if (!parsed.scenario || !inputs || disabled) { if (!parsed.scenario) navigate(`${base}/${Object.keys(parsed.errors).some(k => ['netSalesExVat', 'internalCostExVat', 'operatingExpensesExVat', 'assumption'].includes(k)) ? 'assumptions' : 'target'}`); setTimeout(() => { if (mounted.current) document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }, 0); return; }
    let url: string; try { url = goalPreviewUrl(parsed.scenario); } catch { setErrors({ request: text('ข้อความยาวเกินขอบเขต ย่อชื่อหรือสมมติฐานแล้วลองใหม่', 'Preview text limit exceeded. Shorten names or assumptions and retry.') }); return; }
    const started = currentStep.current, startedIntent = intentVersion.current, result = await previewWork.run(() => readable(async () => { const v = goalPreviewSchema.parse(await api.get(url)); if (JSON.stringify(v.scenario) !== JSON.stringify(parsed.scenario)) throw Error('Goal preview identity mismatch'); return v; }));
    if (result.ok && mounted.current && intentVersion.current === startedIntent) { setPreview(result.value); setChanged(false); if (currentStep.current === started) navigate(`${base}/review`); }
  }
  async function save() { if (!preview || !canSaveGoal(role) || disabled || lock.current) return; lock.current = true;
    const job: GoalSaveJob = { schemaVersion: 1, owner, requestId: crypto.randomUUID(), draftId: id ?? null, revision, scenario: preview.scenario, createdAt: new Date().toISOString(), conflict: false };
    try { const result = await writer.write(job); if (mounted.current) { if (result) navigate(`${detailUrl(result.id)}?saved=${job.requestId}`); else if (readGoalJobs(owner).some(j => j.requestId === job.requestId)) navigate(requestUrl(job.requestId)); } } finally { lock.current = false; }
  }
  const field = (key: keyof GoalForm, label: string, help?: string) => <TaskInput label={label} value={String(form[key])} help={help} error={errors[key]} disabled={disabled} inputMode={['target', 'netSalesExVat', 'internalCostExVat', 'operatingExpensesExVat'].includes(key) ? 'decimal' : undefined} onChange={e => change(key, e.target.value)} />;
  return <CommercePage><WorkspaceLink to={id ? detailUrl(id) : home}>{text('กลับไปร่างเป้ากำไรและต้นทุน', 'Back to goal planning drafts')}</WorkspaceLink><PageHeader title={text('วางแผนเป้ากำไรและต้นทุน', 'Plan profit and cost goals')} subtitle={text('ร่างส่วนตัวเพื่อทบทวน เป้าทีมและข้อมูลจริงยังไม่ถูกแก้', 'Private reviewable draft; team targets and actual records stay unchanged.')} />
    <nav aria-label={text('ขั้นตอนตั้งเป้า', 'Goal planning steps')} className="grid gap-2 sm:grid-cols-3">{steps.map((s, i) => <Link key={s} to={`${base}/${s}`} aria-current={step === s ? 'step' : undefined} className="rounded-lg border border-secondary-container p-3 text-sm min-h-11 focus-visible:outline-2 focus-visible:outline-primary">{i + 1}. {stepLabel(s)}</Link>)}</nav>
    {!canSaveGoal(role) && <Alert tone="muted">{text('บัญชีนี้อ่านและทดลองได้ บันทึกร่างได้เฉพาะ Admin ตามขอบเขตการเขียนเดิม', 'Preview is available. Only admin can save drafts under the existing write boundary.')}</Alert>}
    {backupChoice === 'pending' && <Alert tone="warn">{text('ร่างล่าสุดเปลี่ยน มีค่าที่กรอกค้างจากฉบับเก่า เลือกก่อนทำต่อ', 'The saved revision changed. Choose how to handle the previous form.')}<div className="flex flex-wrap gap-3"><Button onClick={() => { const latest = original ? formFromGoal(original.scenario) : blankGoalForm(); setForm({ ...latest, sourceFingerprint: inputs?.period === latest.period ? inputs.sourceFingerprint : latest.sourceFingerprint }); intentVersion.current++; setBackupChoice('latest'); setPreview(null); }}>{text('ใช้ร่างที่บันทึกล่าสุด', 'Use latest saved draft')}</Button><Button onClick={() => { setForm({ ...backup.current!.form, sourceFingerprint: inputs?.period === backup.current!.form.period ? inputs.sourceFingerprint : backup.current!.form.sourceFingerprint }); intentVersion.current++; setBackupChoice('copy'); setChanged(true); setPreview(null); }}>{text('คัดลอกค่าที่กรอกเพื่อทบทวน', 'Copy my previous values for review')}</Button></div></Alert>}
    <ErrorText error={backupError} />{pending && <Alert tone="warn">{text('มีคำขอเดิมที่ต้องตรวจผลก่อนบันทึกใหม่', 'An original save request requires reconciliation.')}<WorkspaceLink to={requestUrl(pending.requestId)}>{text('ตรวจคำขอเดิม', 'Check original request')}</WorkspaceLink></Alert>}{changed && <Alert tone="warn">{text('บริบทต้นทางเปลี่ยน ตรวจและคำนวณใหม่ก่อนบันทึก', 'Source context changed. Review and recalculate before saving.')}</Alert>}
    {!goalPeriod.safeParse(form.period).success && <Alert tone="danger">{text('เลือกเดือนที่ถูกต้องก่อนอ่านหรือทบทวนเป้า', 'Choose a valid planning month before reading or reviewing this target.')}<WorkspaceLink to={`${base}/target`}>{text('กลับไปกำหนดเดือน', 'Set planning month')}</WorkspaceLink></Alert>}
    <ErrorText error={source.error} onRetry={source.reload} />{source.loading && <Loading variant="detail" />}
    {step === 'target' && <Panel><PanelHead title={stepLabel(step)} /><div className="p-4 grid gap-4 sm:grid-cols-2">{field('name', text('ชื่อร่างเป้า', 'Goal draft name'))}<TaskInput label={text('เดือนที่วางแผน (UTC)', 'Planning month (UTC)')} type="month" value={form.period} error={errors.period} disabled={writer.busy || !!pending || backupChoice === 'pending'} onChange={e => change('period', e.target.value)} /><TaskSelect label={text('เป้าที่ต้องการทบทวน', 'Goal to review')} value={form.metric} error={errors.metric} disabled={disabled} onChange={e => change('metric', e.target.value)}>{['gross_profit_ex_vat', 'gross_margin_percent', 'total_cost_ceiling_ex_vat', 'net_profit_ex_vat'].map(m => <option key={m} value={m}>{goalLabel(m)}</option>)}</TaskSelect>{field('target', form.metric === 'gross_margin_percent' ? text('เป้า Margin (%)', 'Target margin (%)') : text('เป้าหรือเพดาน (บาท ไม่รวม VAT)', 'Target or ceiling (THB, ex VAT)'))}</div></Panel>}
    {inputs && !source.error && <>{step !== 'review' && <GoalSources inputs={inputs} />}{step === 'target' && <WorkspaceLink to={`${base}/assumptions`}>{text('ต่อไป: ตรวจข้อมูลและสมมติฐาน', 'Next: review sources and assumptions')}</WorkspaceLink>}
      {step === 'assumptions' && <><Button disabled={disabled} onClick={source.reload}>{text('อ่านบริบทเดิมใหม่', 'Refresh existing context')}</Button><Panel><PanelHead title={text('สมมติฐานคำนวณเพิ่มเติม (เลือกกรอก)', 'Optional hypothetical calculation')} /><div className="p-4 space-y-4"><label className="flex gap-3 items-start min-h-11"><input type="checkbox" checked={form.hypotheticalEnabled} disabled={disabled} onChange={e => change('hypotheticalEnabled', e.target.checked)} /><span>{text('ทดลองจากตัวเลขสมมติที่ฉันกรอก แยกจากผลจริง', 'Calculate from my hypothetical inputs, separate from actuals')}</span></label>{form.hypotheticalEnabled && <div className="grid gap-4 sm:grid-cols-2">{field('netSalesExVat', text('ยอดขายสุทธิสมมติ ไม่รวม VAT', 'Hypothetical net sales, ex VAT'))}{field('internalCostExVat', text('ต้นทุนภายในสมมติ ไม่รวม VAT', 'Hypothetical internal cost, ex VAT'))}{field('operatingExpensesExVat', text('ค่าใช้จ่ายสมมติ ไม่รวม VAT', 'Hypothetical operating expenses, ex VAT'))}{field('assumption', text('ที่มาของสมมติฐาน', 'Assumption source and limits'))}</div>}<p className="text-sm">{text('ไม่ดึงราคาคู่แข่งมาเป็นต้นทุน และไม่ใช้ GMV แทนยอดขายสุทธิ', 'Competitor prices are not costs. GMV cannot replace net sales.')}</p></div></Panel><Button disabled={disabled} onClick={review}>{text('ทบทวนเป้าและผลสมมติ', 'Review target and hypothetical results')}</Button></>}
      {step === 'review' && (preview ? <><GoalEvidence value={preview} /><div className="flex flex-wrap gap-3">{canSaveGoal(role) && <Button disabled={disabled} onClick={save}>{writer.busy ? text('กำลังตรวจผลบันทึก…', 'Verifying save…') : text('บันทึกร่างเป้าเพื่อทบทวน', 'Save goal draft for review')}</Button>}<WorkspaceLink to={`${base}/target`}>{text('แก้เป้าหรือเดือน', 'Edit target or month')}</WorkspaceLink><WorkspaceLink to={`${base}/assumptions`}>{text('แก้สมมติฐาน', 'Edit assumptions')}</WorkspaceLink><Button disabled={disabled} onClick={review}>{text('อ่านและทบทวนใหม่', 'Read and review again')}</Button></div></> : <Empty>{text('ยังไม่มีผลทบทวนสำหรับค่าปัจจุบัน อ่านและคำนวณก่อนบันทึก', 'No verified review for current values. Read and calculate before saving.')}<Button disabled={disabled} onClick={review}>{text('ทบทวนค่าปัจจุบัน', 'Review current values')}</Button></Empty>)}
    </>}
    {Object.keys(errors).length > 0 && <Alert tone="danger">{errors.request ?? text('แก้ช่องที่ระบุ แล้วทบทวนใหม่', 'Correct the marked fields and review again.')}</Alert>}<ErrorText error={previewWork.error} /><ErrorText error={writer.error} />{previewWork.busy && <Loading variant="detail" />}
  </CommercePage>;
}
