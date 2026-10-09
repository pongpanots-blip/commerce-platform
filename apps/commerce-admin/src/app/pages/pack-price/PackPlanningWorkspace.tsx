import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Chip, Empty, Loading, PageHeader, Panel, PanelHead, TaskInput, TaskSelect, useUiLocale } from '@cp/ui';
import { canSavePack, inspectObservation, PACK_API as endpoint, PACK_HOME as home, packDraftPageSchema, packInputsSchema, packPreviewSchema, packPreviewUrl, packReceiptSchema, packRoles, samePackScenario, uuid, type PackInputs, type PackPreview, type PackReceipt } from '../../../../../commerce-platform/src/modules/integration/pack-price-planning/pack-price';
import { api, session } from '../../../lib/api';
import { normalizeRole } from '../../../lib/role-home';
import { CommercePage } from '../../CommercePage';
import { commerceText as text } from '../../commerce-copy';
import { useAsync, useMutation } from '../../hooks';
import { WorkspaceLink } from '../../WorkspaceParts';
import { friendlyError } from '../planning/promotion-contracts';
import { PlanningError as ErrorText } from '../planning/PlanningError';
import { PackEvidence, ProductEvidence } from './PackEvidence';
import { dateText, decimalMoney, exclusionText, unitText } from './pack-copy';
import { blankPackForm, blankProposal, buildPackScenario, clearPackForm, clearPackJob, formFromPack, packPacket, readPackForm, readPackJobs, storePackForm, storePackJob, verifyPackJob, type PackForm, type PackSaveJob } from './pack-form';

const detailUrl = (id: string) => `${home}/drafts/${id}`;
const requestUrl = (id: string) => `${home}/requests/${id}`;
const steps = ['product', 'observations', 'scenarios', 'review'] as const;
type Step = typeof steps[number];
const stepLabel = (step: Step) => text(...({ product: ['เลือกสินค้า', 'Choose product'], observations: ['ตรวจแพ็กและราคาคู่แข่ง', 'Review observed packs'], scenarios: ['เสนอแพ็กและราคาของเรา', 'Propose our packs and prices'], review: ['เทียบผลและเก็บร่าง', 'Compare and retain draft'] } as Record<Step, [string, string]>)[step]);
async function readable<T>(run: () => Promise<T>): Promise<T> { try { return await run(); } catch (e) { throw new Error(friendlyError(e)); } }
function parseReceipt(raw: unknown, id?: string) { const value = packReceiptSchema.parse(raw); if (id && id !== value.id) throw Error('Draft identity mismatch'); return value; }
function useJobs(owner: string) {
  const [jobs, setJobs] = useState(() => readPackJobs(owner));
  useEffect(() => { const refresh = () => setJobs(readPackJobs(owner)); refresh(); window.addEventListener('storage', refresh); window.addEventListener('cp-pack-price-journal', refresh); return () => { window.removeEventListener('storage', refresh); window.removeEventListener('cp-pack-price-journal', refresh); }; }, [owner]);
  return jobs;
}
export function usePackWriter(owner: string) {
  const lock = useRef(false), mounted = useRef(true), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function write(job: PackSaveJob): Promise<PackReceipt | null> {
    if (lock.current || !mounted.current) return null;
    lock.current = true; setBusy(true); setError(null);
    try {
      try { storePackJob(job); } catch { throw Error(text('ยังเก็บคำขอกู้คืนไม่ได้ จึงยังไม่ส่งบันทึก ตรวจพื้นที่เบราว์เซอร์แล้วลองใหม่', 'Recovery storage is unavailable. No save was sent. Check browser storage and retry.')); }
      let receipt: PackReceipt;
      try { receipt = verifyPackJob(parseReceipt(job.draftId ? await api.patch(`${endpoint}/drafts/${job.draftId}`, packPacket(job)) : await api.post(`${endpoint}/drafts`, packPacket(job)), job.draftId ?? undefined), job); }
      catch (e) { if ((e as { status?: number }).status === 409) { try { storePackJob({ ...job, conflict: true }); } catch { /* Retain the original immutable request. */ } } throw Error(text('ยังยืนยันผลบันทึกไม่ได้ ตรวจคำขอเดิมก่อนส่งซ้ำ', 'The save result is unverified. Check this request before submitting again.')); }
      try { clearPackForm(owner, job.draftId ?? undefined); clearPackJob(owner, job.requestId); } catch { /* An already committed receipt still establishes success. */ }
      return mounted.current ? receipt : null;
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : friendlyError(e)); return null; }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return { write, busy, error };
}
export default function PackPlanningWorkspace({ role = session.claims()?.role }: { role?: string }) {
  useUiLocale(); const { pathname } = useLocation(), normalized = normalizeRole(role), owner = String(session.claims()?.sub ?? '');
  if (!packRoles.some(r => r === normalized)) return <CommercePage><PageHeader title={text('วางแผนแพ็กและราคาขาย', 'Plan packs and sale prices')} /><Alert tone="danger">{text('บัญชีนี้ไม่มีสิทธิ์อ่านแหล่งราคาคู่แข่งเดิม', 'This account cannot read the existing competitor sources.')}</Alert></CommercePage>;
  if (!owner) return <CommercePage><Alert tone="danger">{text('ยังยืนยันบัญชีไม่ได้ โปรดเข้าสู่ระบบใหม่', 'The account could not be verified. Sign in again.')}</Alert></CommercePage>;
  const path = pathname.replace(/\/$/, '');
  if (path === home) return <DraftIndex owner={owner} role={normalized} />;
  if (path === `${home}/new`) return <Navigate to={`${home}/new/product`} replace />;
  const create = path.match(/^\/planning\/pack-prices\/new\/(product|observations|scenarios|review)$/);
  if (create) return <DraftEditor key={`${owner}:${normalized}:new`} owner={owner} role={normalized} step={create[1] as Step} />;
  const match = path.match(/^\/planning\/pack-prices\/(drafts|requests)\/([^/]+)(?:\/edit(?:\/(product|observations|scenarios|review))?)?$/), id = uuid.safeParse(match?.[2]);
  if (!match || !id.success || match[1] === 'requests' && path.includes('/edit')) return <CommercePage><Alert tone="danger">{text('ลิงก์ร่างไม่ถูกต้อง', 'Invalid planning draft link.')}</Alert><WorkspaceLink to={home}>{text('กลับไปร่างแพ็กและราคา', 'Open pack planning drafts')}</WorkspaceLink></CommercePage>;
  if (match[1] === 'requests') return <RequestRecovery key={`${owner}:${id.data}`} owner={owner} role={normalized} requestId={id.data} />;
  if (path.endsWith('/edit')) return <Navigate to={`${detailUrl(id.data)}/edit/product`} replace />;
  return match[3] ? <DraftEditor key={`${owner}:${normalized}:${id.data}`} owner={owner} role={normalized} draftId={id.data} step={match[3] as Step} /> : <DraftDetail key={`${owner}:${id.data}`} draftId={id.data} role={normalized} />;
}
function PendingRequests({ owner }: { owner: string }) {
  const jobs = useJobs(owner);
  return jobs.length ? <Panel><PanelHead title={text('คำขอที่ต้องตรวจผล', 'Requests with unverified results')} /><div className="p-4 space-y-3"><p>{text('ยังไม่นับเป็นร่างที่บันทึกแล้ว', 'These requests are not counted as saved drafts.')}</p>{jobs.map(job => <WorkspaceLink key={job.requestId} to={requestUrl(job.requestId)}>{job.scenario.name} · {text('ตรวจผลบันทึก', 'Check save result')}</WorkspaceLink>)}</div></Panel> : null;
}
function DraftIndex({ owner, role }: { owner: string; role: string }) {
  const [query] = useSearchParams(), after = query.get('after'), valid = !after || uuid.safeParse(after).success;
  const list = useAsync(() => valid ? readable(async () => packDraftPageSchema.parse(await api.get(`${endpoint}/drafts${after ? `?after=${after}` : ''}`))) : Promise.resolve(null), [after, valid]);
  return <CommercePage><PageHeader title={text('ร่างแพ็กและราคาขาย', 'Pack and sale-price drafts')} subtitle={text('เลือกสินค้าของเรา เทียบหลายแพ็กที่มีหลักฐาน แล้วเสนอทางเลือกเพื่อทบทวน', 'Choose our product, compare recorded packs, and propose options for review.')} actions={<WorkspaceLink to={`${home}/new/product`}>{text('เริ่มวางแผนแพ็กและราคา', 'Start a pack and price plan')}</WorkspaceLink>} />
    <Alert tone="muted">{text('ใช้สิทธิ์อ่านราคาคู่แข่งเดิม: Admin, Marketing และ BA · MER ยังไม่มีสิทธิ์นี้', 'Uses existing competitor access: admin, marketing and BA. MER currently has no access.')}</Alert>
    {!canSavePack(role) && <Alert tone="muted">{text('บัญชี BA อ่านและทดลองได้ตามสิทธิ์เดิม แต่ยังบันทึกหรือแก้ร่างไม่ได้', 'BA retains its existing read-only policy: preview is available; saving and editing drafts are unavailable.')}</Alert>}
    <PendingRequests owner={owner} /><ErrorText error={list.error} onRetry={list.reload} />{!valid ? <Alert tone="danger">{text('ลิงก์หน้ารายการไม่ถูกต้อง', 'Invalid list cursor.')}<WorkspaceLink to={home}>{text('กลับหน้าแรก', 'Open the first page')}</WorkspaceLink></Alert> : list.loading ? <Loading variant="table" /> : list.data && !list.error && <>
      <p role="status">{text('ร่างที่อ่านพบในหน้านี้', 'Drafts returned on this page')}: {list.data.items.length}</p>{!list.data.items.length ? <Empty>{text('ยังไม่มีร่างในหน้านี้ เริ่มวางแผนหรือกลับหน้ารายการแรก', 'No drafts on this page. Start planning or return to the first page.')}</Empty> : <div className="grid gap-4 lg:grid-cols-2">{list.data.items.map(draft => <Panel key={draft.id}><div className="p-4 space-y-3"><Chip tone="ok">{text('บันทึกร่างแล้ว', 'Draft saved')}</Chip><WorkspaceLink to={detailUrl(draft.id)}>{draft.scenario.name}</WorkspaceLink><p>{draft.scenario.sku} · {draft.scenario.proposals.length} {text('แบบที่เสนอ', 'proposed options')} · {text('ฉบับ', 'Revision')} {draft.revision}</p></div></Panel>)}</div>}
      <div className="flex flex-wrap gap-3">{after && <WorkspaceLink to={home}>{text('กลับหน้าแรก', 'First page')}</WorkspaceLink>}{list.data.next && <WorkspaceLink to={`${home}?after=${list.data.next}`}>{text('รายการถัดไป', 'Next page')}</WorkspaceLink>}<Button onClick={list.reload}>{text('อ่านใหม่', 'Refresh')}</Button></div>
    </>}
  </CommercePage>;
}
function DraftDetail({ draftId, role }: { draftId: string; role: string }) {
  const [params] = useSearchParams(), requested = params.get('saved'), valid = uuid.safeParse(requested);
  const detail = useAsync(() => readable(async () => parseReceipt(await api.get(`${endpoint}/drafts/${draftId}`), draftId)), [draftId]);
  const proof = useAsync(() => valid.success ? readable(async () => parseReceipt(await api.get(`${endpoint}/requests/${valid.data}`), draftId)) : Promise.resolve(null), [draftId, requested]);
  return <CommercePage><WorkspaceLink to={home}>{text('กลับไปร่างแพ็กและราคา', 'Back to pack planning drafts')}</WorkspaceLink><PageHeader title={detail.data?.scenario.name ?? text('ร่างแพ็กและราคา', 'Pack planning draft')} actions={canSavePack(role) && <WorkspaceLink to={`${detailUrl(draftId)}/edit/product`}>{text('แก้ไขร่าง', 'Edit draft')}</WorkspaceLink>} />
    {proof.data && !proof.error && <Alert tone="ok"><span role="status">{text('ยืนยันคำขอบันทึกนี้แล้ว', 'This save request is verified.')} · {text('ฉบับ', 'Revision')} {proof.data.revision}</span></Alert>}
    {requested && (!valid.success || proof.error) && <Alert tone="warn">{text('ยังยืนยันคำขอนี้ไม่ได้ สถานะร่างด้านล่างมาจากผลอ่านล่าสุด', 'This request is unverified. The draft below comes from the latest read.')}</Alert>}
    <ErrorText error={detail.error} onRetry={detail.reload} />{detail.loading ? <Loading variant="detail" /> : detail.data && !detail.error && <><div className="flex gap-3 flex-wrap"><Chip tone="ok">{text('บันทึกร่างแล้ว', 'Draft saved')}</Chip><Chip tone="muted">{text('ฉบับ', 'Revision')} {detail.data.revision}</Chip><Button onClick={detail.reload}>{text('อ่านร่างใหม่', 'Refresh draft')}</Button></div><p className="text-sm">{text('หลักฐานเก็บพร้อมร่างเมื่อ', 'Evidence retained with this draft at')}: {dateText(detail.data.inputs.capturedAt)}</p><PackEvidence value={detail.data} /></>}
  </CommercePage>;
}
function RequestRecovery({ owner, requestId, role }: { owner: string; requestId: string; role: string }) {
  const jobs = useJobs(owner), job = jobs.find(j => j.requestId === requestId), writer = usePackWriter(owner), navigate = useNavigate();
  const lookup = useAsync(async () => { try { const receipt = parseReceipt(await api.get(`${endpoint}/requests/${requestId}`)); if (job) verifyPackJob(receipt, job); return { receipt, absent: false }; } catch (e) { if ((e as { status?: number }).status === 404) return { receipt: null, absent: true }; throw Error(friendlyError(e)); } }, [requestId]);
  const resolved = lookup.data?.receipt;
  useEffect(() => { if (!resolved) return; try { if (job) clearPackForm(owner, job.draftId ?? undefined); clearPackJob(owner, requestId); } catch { /* Verified persisted receipt remains visible. */ } }, [resolved, owner, requestId]);
  async function retry() { if (!job || !lookup.data?.absent || job.conflict || !canSavePack(role)) return; const result = await writer.write(job); if (result) navigate(`${detailUrl(result.id)}?saved=${requestId}`, { replace: true }); else lookup.reload(); }
  return <CommercePage><WorkspaceLink to={home}>{text('กลับไปร่าง', 'Back to drafts')}</WorkspaceLink><PageHeader title={text('ตรวจผลคำขอบันทึก', 'Check save request')} subtitle={job?.scenario.name} /><ErrorText error={lookup.error} onRetry={lookup.reload} />{lookup.loading ? <Loading variant="detail" /> : lookup.error ? null : resolved ? <><Alert tone="ok"><span role="status">{text('พบหลักฐานบันทึกร่างแล้ว', 'Saved draft receipt verified.')}</span></Alert><WorkspaceLink to={`${detailUrl(resolved.id)}?saved=${requestId}`}>{text('เปิดร่างที่บันทึกแล้ว', 'Open saved draft')}</WorkspaceLink><PackEvidence value={resolved} /></> : <><Alert tone="warn">{text('ยังไม่พบหลักฐานคำขอที่บันทึกแล้ว จึงยังไม่แสดงว่าบันทึกสำเร็จ', 'No committed receipt was found. This request is not marked successful.')}</Alert>{job ? job.conflict ? <><Alert tone="warn">{text('ฉบับร่างหรือหลักฐานเปลี่ยน เปิดข้อมูลล่าสุดเพื่อทบทวนก่อนเริ่มคำขอใหม่', 'The draft revision or evidence changed. Review current data before starting a new request.')}</Alert><WorkspaceLink to={job.draftId ? `${detailUrl(job.draftId)}/edit/product` : `${home}/new/product`}>{text('เปิดข้อมูลล่าสุด', 'Review current data')}</WorkspaceLink><Button onClick={() => { try { clearPackJob(owner, requestId); navigate(home); } catch { lookup.reload(); } }}>{text('ยกเลิกคำขอที่ไม่สำเร็จ', 'Dismiss unsuccessful request')}</Button></> : canSavePack(role) && <Button disabled={writer.busy} onClick={retry}>{text('ลองส่งคำขอเดิมอีกครั้ง', 'Retry the same request')}</Button> : <Empty>{text('ไม่มีคำขอเดิมในเบราว์เซอร์นี้ เปิดร่างหรืออ่านผลอีกครั้ง', 'The original request is unavailable in this browser. Inspect drafts or check again.')}</Empty>}<Button disabled={writer.busy} onClick={lookup.reload}>{text('ตรวจผลอีกครั้ง', 'Check again')}</Button></>}<ErrorText error={writer.error} /></CommercePage>;
}
function DraftEditor({ owner, role, draftId, step }: { owner: string; role: string; draftId?: string; step: Step }) {
  const original = useAsync(() => draftId ? readable(async () => parseReceipt(await api.get(`${endpoint}/drafts/${draftId}`), draftId)) : Promise.resolve(null), [draftId]);
  if (draftId && !canSavePack(role)) return <CommercePage><Alert tone="muted">{text('บัญชีนี้ยังแก้ร่างไม่ได้ตามสิทธิ์อ่านเดิม', 'This account retains read-only access and cannot edit drafts.')}</Alert><WorkspaceLink to={detailUrl(draftId)}>{text('อ่านร่างนี้', 'Read this draft')}</WorkspaceLink></CommercePage>;
  if (draftId && original.loading) return <CommercePage><Loading variant="detail" /></CommercePage>;
  if (draftId && (original.error || !original.data)) return <CommercePage><ErrorText error={original.error} onRetry={original.reload} /></CommercePage>;
  return <EditorForm key={`${draftId ?? 'new'}:${original.data?.revision ?? 0}`} owner={owner} role={role} original={original.data} step={step} />;
}
function EditorForm({ owner, role, original, step }: { owner: string; role: string; original: PackReceipt | null; step: Step }) {
  const id = original?.id, revision = original?.revision ?? null, backup = useRef(readPackForm(owner, id));
  const [form, setForm] = useState<PackForm>(() => backup.current?.revision === revision ? backup.current.form : original ? formFromPack(original.scenario) : blankPackForm());
  const [backupChoice, setBackupChoice] = useState(backup.current && backup.current.revision !== revision ? 'pending' : 'latest');
  const [backupError, setBackupError] = useState<string | null>(null), [changedSources, setChangedSources] = useState(false), [errors, setErrors] = useState<Record<string, string>>({}), [preview, setPreview] = useState<PackPreview | null>(null);
  const source = useAsync(() => form.confirmedSku ? readable(async () => { const v = packInputsSchema.parse(await api.get(`${endpoint}/inputs/${encodeURIComponent(form.confirmedSku)}`)); if (v.sku !== form.confirmedSku) throw Error('Product identity mismatch'); return v; }) : Promise.resolve(null), [form.confirmedSku]);
  const previewWork = useMutation(), writer = usePackWriter(owner), jobs = useJobs(owner), pending = jobs.find(j => j.draftId === (id ?? null)), saveLock = useRef(false), mounted = useRef(true), currentStep = useRef(step), navigate = useNavigate();
  const base = id ? `${detailUrl(id)}/edit` : `${home}/new`, inputs = source.data?.sku === form.confirmedSku ? source.data : null, busy = source.loading || previewWork.busy || writer.busy;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { currentStep.current = step; }, [step]);
  useEffect(() => { if (backupChoice === 'pending') return; try { storePackForm(owner, id, revision, form); setBackupError(null); } catch { setBackupError(text('ยังเก็บค่าที่กรอกเพื่อกลับมาทำต่อไม่ได้ อย่าปิดหน้านี้จนกว่าจะบันทึกร่างสำเร็จ', 'Form recovery is unavailable. Keep this page open until the draft is saved.')); } }, [owner, id, revision, form, backupChoice]);
  useEffect(() => {
    if (!inputs) return;
    if (form.sourceFingerprint && form.sourceFingerprint !== inputs.sourceFingerprint) setChangedSources(true);
    setForm(previous => previous.confirmedSku !== inputs.sku || previous.sourceFingerprint === inputs.sourceFingerprint ? previous : { ...previous, sourceFingerprint: inputs.sourceFingerprint, observationIds: previous.sourceFingerprint ? previous.observationIds.filter(id => inputs.observations.some(o => o.id === id)) : inputs.observations.filter(o => inspectObservation(o, inputs).eligible).slice(0, 20).map(o => o.id), proposals: previous.sourceFingerprint ? previous.proposals : [blankProposal(1, inputs)] });
    setPreview(null);
  }, [inputs]);
  function change(next: PackForm) { setForm(next); setErrors({}); setPreview(null); }
  function propose(index: number, key: string, value: string) { const proposals = form.proposals.map((p, i) => i !== index ? p : key.startsWith('pack.') ? { ...p, pack: { ...p.pack, [key.slice(5)]: value } } : { ...p, [key]: value }); change({ ...form, proposals }); }
  function chooseProduct() {
    const sku = form.sku.trim(); if (!sku || sku.length > 100 || /[\x00-\x1f\x7f]/.test(sku)) { setErrors({ sku: text('กรอกรหัสสินค้าที่ถูกต้อง', 'Enter a valid SKU.') }); return; }
    if (sku === form.confirmedSku) { setPreview(null); source.reload(); } else change({ ...form, sku, confirmedSku: sku, sourceFingerprint: '', observationIds: [], proposals: [blankProposal(1)] });
  }
  async function review() {
    const parsed = buildPackScenario(form); setErrors(parsed.errors);
    if (!parsed.scenario || !inputs || inputs.sku !== form.confirmedSku || pending || busy) { if (!parsed.scenario) navigate(`${base}/scenarios`); setTimeout(() => { if (!mounted.current) return; const invalid = document.querySelector<HTMLElement>('[aria-invalid="true"]'); const details = invalid?.closest('details'); if (details) details.open = true; invalid?.focus(); }, 0); return; }
    let url: string; try { url = packPreviewUrl(parsed.scenario); } catch { setErrors({ request: text('ข้อความร่างยาวเกินขอบเขตผลอ่านนี้ ย่อชื่อหรือสมมติฐานแล้วลองใหม่', 'The draft text exceeds this preview limit. Shorten names or assumptions and retry.') }); return; }
    const startedStep = currentStep.current;
    const result = await previewWork.run(() => readable(async () => { const value = packPreviewSchema.parse(await api.get(url)); if (!samePackScenario(value.scenario, parsed.scenario!)) throw Error('Preview identity mismatch'); return value; }));
    if (result.ok && mounted.current) { setPreview(result.value); setChangedSources(false); if (currentStep.current === startedStep) navigate(`${base}/review`); }
  }
  async function save() {
    if (!preview || !canSavePack(role) || pending || saveLock.current || busy) return; saveLock.current = true;
    const job: PackSaveJob = { schemaVersion: 1, owner, requestId: crypto.randomUUID(), draftId: id ?? null, revision, scenario: preview.scenario, createdAt: new Date().toISOString(), conflict: false };
    try { const result = await writer.write(job); if (mounted.current) { if (result) navigate(`${detailUrl(result.id)}?saved=${job.requestId}`); else if (readPackJobs(owner).some(j => j.requestId === job.requestId)) navigate(requestUrl(job.requestId)); } } finally { saveLock.current = false; }
  }
  const disabled = busy || !!pending || backupChoice === 'pending';
  const control = (index: number, key: string, label: string, help?: string) => { const p = form.proposals[index], value = key.startsWith('pack.') ? p.pack[key.slice(5) as keyof typeof p.pack] : p[key as keyof typeof p] as string; return <TaskInput label={label} value={value} help={help} disabled={disabled} error={errors[`proposals.${index}.${key}`]} inputMode={key === 'label' || key === 'assumption' ? undefined : 'decimal'} onChange={e => propose(index, key, e.target.value)} />; };
  return <CommercePage><WorkspaceLink to={id ? detailUrl(id) : home}>{text('กลับไปร่างแพ็กและราคา', 'Back to pack planning drafts')}</WorkspaceLink><PageHeader title={text('วางแผนแพ็กและราคาขาย', 'Plan packs and sale prices')} subtitle={text('วางทางเลือกการขายจากหลักฐานคู่แข่งและสมมติฐานของเรา', 'Plan sale options from competitor evidence and our assumptions.')} />
    <nav aria-label={text('ขั้นตอนวางแผน', 'Planning steps')} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{steps.map((s, index) => <Link key={s} to={`${base}/${s}`} aria-current={step === s ? 'step' : undefined} className="rounded-lg border border-secondary-container p-3 text-sm min-h-11 focus-visible:outline-2 focus-visible:outline-primary">{index + 1}. {stepLabel(s)}</Link>)}</nav>
    <Alert tone="muted">{text('ต้นทุนภายในยังไม่มีแหล่งที่ยืนยัน จึงยังไม่สรุปกำไรหรือเสนอว่าราคาใดควรขาย', 'Authoritative internal cost is unavailable; profit and a recommended sale price remain unverified.')}</Alert>
    {!canSavePack(role) && <Alert tone="muted">{text('BA ทดลองแบบอ่านอย่างเดียวตามสิทธิ์เดิม ยังบันทึกร่างไม่ได้', 'BA previews retain the existing read-only policy; saving drafts is unavailable.')}</Alert>}
    {backupChoice === 'pending' && <Alert tone="warn">{text('ร่างล่าสุดเปลี่ยนไปแล้ว มีค่าที่กรอกค้างจากฉบับเก่า เลือกฉบับก่อนทำต่อ', 'The saved draft changed. A previous form is available; choose a version before continuing.')}<div className="flex gap-3 flex-wrap"><Button onClick={() => { setForm(original ? formFromPack(original.scenario) : blankPackForm()); setBackupChoice('latest'); setPreview(null); }}>{text('ใช้ร่างที่บันทึกล่าสุด', 'Use latest saved draft')}</Button><Button onClick={() => { setForm(backup.current!.form); setBackupChoice('copy'); setChangedSources(true); setPreview(null); }}>{text('คัดลอกค่าที่กรอกไว้เพื่อทบทวน', 'Copy my previous values for review')}</Button></div></Alert>}
    <ErrorText error={backupError} />{pending && <Alert tone="warn">{text('มีคำขอเดิมที่ยังต้องตรวจผล ยังไม่เริ่มคำขอบันทึกใหม่', 'An original save request needs reconciliation before a new save.')}<WorkspaceLink to={requestUrl(pending.requestId)}>{text('ตรวจคำขอเดิม', 'Check original request')}</WorkspaceLink></Alert>}
    {changedSources && <Alert tone="warn">{text('หลักฐานต้นทางเปลี่ยนแล้ว ตรวจตัวเลือกและคำนวณผลใหม่ก่อนบันทึก', 'Source evidence changed. Review selections and recalculate before saving.')}</Alert>}
    {step === 'product' ? <Panel><PanelHead title={stepLabel(step)} /><form className="p-4 space-y-4" onSubmit={e => { e.preventDefault(); chooseProduct(); }}><TaskInput label={text('รหัสสินค้าของเรา', 'Our product SKU')} value={form.sku} error={errors.sku} disabled={disabled} onChange={e => change({ ...form, sku: e.target.value, confirmedSku: '', sourceFingerprint: '', observationIds: [] })} help={text('ใช้รหัสจากแค็ตตาล็อกเดิม อ่านข้อมูลก่อนเริ่มเทียบ', 'Use an existing catalog SKU and read it before comparing.')} /><Button type="submit" disabled={disabled}>{text('อ่านสินค้านี้', 'Read this product')}</Button></form></Panel> : !inputs && !source.loading && <Empty>{text('เลือกและอ่านสินค้าก่อน แล้วกลับมาทำขั้นตอนนี้', 'Choose and read a product before continuing this step.')}<WorkspaceLink to={`${base}/product`}>{stepLabel('product')}</WorkspaceLink></Empty>}
    <ErrorText error={source.error} onRetry={source.reload} />{source.loading ? <Loading variant="detail" /> : inputs && !source.error && <>
      {step !== 'review' && <ProductEvidence inputs={inputs} />}
      {step === 'product' && <WorkspaceLink to={`${base}/observations`}>{text('ต่อไป: ตรวจแพ็กและราคาคู่แข่ง', 'Next: review recorded competitor packs')}</WorkspaceLink>}
      {step === 'observations' && <><div className="flex gap-3 flex-wrap"><WorkspaceLink to="/j/marketing/competitor-prices">{text('เปิดแหล่งคู่แข่งเดิมเพื่ออ่านหรือแก้ข้อมูลตามสิทธิ์', 'Open existing competitor observations under current permissions')}</WorkspaceLink><Button disabled={disabled} onClick={source.reload}>{text('อ่านหลักฐานใหม่', 'Refresh evidence')}</Button></div><p className="text-sm" role="status">{text('เลือกได้ไม่เกิน 20 คู่สินค้า ค่าเริ่มต้นเลือกคู่ที่ยืนยันและเทียบได้', 'Select up to 20 recorded pairs. Defaults include verified, comparable observations.')}</p>
        {!inputs.observations.length ? <Empty>{text('ยังไม่มีคู่สินค้าที่บันทึกไว้ เพิ่มหรือแก้ผ่านหน้าคู่แข่งเดิมตามสิทธิ์ แล้วกลับมาอ่านใหม่', 'No recorded pairs. Use the existing authorized observation flow, then refresh. No manual observation is captured here.')}</Empty> : <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{inputs.observations.map(o => { const inspected = inspectObservation(o, inputs), checked = form.observationIds.includes(o.id); return <Panel key={o.id}><div className="p-4 space-y-3"><label className="flex gap-3 items-start min-h-11 cursor-pointer"><input type="checkbox" className="mt-1" aria-label={`${o.vendor} · ${o.productName}`} checked={checked} disabled={disabled || !inspected.eligible && !checked || !checked && form.observationIds.length >= 20} onChange={() => change({ ...form, observationIds: checked ? form.observationIds.filter(id => id !== o.id) : [...form.observationIds, o.id] })} /><span>{o.vendor}<span className="block text-sm">{o.productName}</span></span></label>
          <Chip tone={inspected.eligible ? 'info' : 'warn'}>{inspected.eligible ? text('มีฐานที่เทียบได้', 'Comparable basis recorded') : text('ยังไม่นำไปเทียบ', 'Excluded from comparison')}</Chip><p>{o.originalPack.min ?? '—'} {unitText(o.originalPack.unit ?? '')} × {o.originalPack.count} · {o.priceIncVat ?? '—'} {o.currency ?? text('สกุลเงินไม่ยืนยัน', 'Currency unverified')}</p><p>{decimalMoney(inspected.pricePerBaseIncVat)} / {unitText(inspected.unit ?? '')}</p><p className="text-xs">{o.priceBasis === 'member' ? text('ราคาสมาชิก', 'Member price') : text('ราคาสาธารณะ', 'Public price')} · {text('วันที่พบ', 'Observed')}: {dateText(o.observedAt)}</p>{inspected.reasons.map(reason => <p className="text-xs" key={reason}>{exclusionText(reason)}</p>)}</div></Panel>; })}</div>}
        <WorkspaceLink to={`${base}/scenarios`}>{text('ต่อไป: เสนอแพ็กและราคาของเรา', 'Next: propose our packs and sale prices')}</WorkspaceLink></>}
      {step === 'scenarios' && <><Panel><div className="p-4"><TaskInput label={text('ชื่อร่างเพื่อทบทวน', 'Draft name for review')} value={form.name} error={errors.name} disabled={disabled} onChange={e => change({ ...form, name: e.target.value })} /></div></Panel><div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{form.proposals.map((p, index) => <Panel key={index}><PanelHead title={`${text('ทางเลือก', 'Option')} ${index + 1}`} /><div className="p-4 space-y-4">{control(index, 'label', text('ชื่อแบบ', 'Option name'))}<div className="grid gap-3 sm:grid-cols-2">{control(index, 'pack.quantity', text('ขนาดต่อชิ้นในแพ็ก', 'Quantity per pack piece'))}<TaskSelect label={text('หน่วยขนาด', 'Pack unit')} value={p.pack.unit} disabled={disabled} error={errors[`proposals.${index}.pack.unit`]} onChange={e => propose(index, 'pack.unit', e.target.value)}>{['kg', 'g', 'l', 'ml', 'piece'].map(unit => <option key={unit} value={unit}>{unitText(unit)}</option>)}</TaskSelect></div>{control(index, 'salePriceIncVat', text('ราคาขายที่เสนอ/แพ็ก (THB รวม VAT)', 'Proposed sale price per pack (THB, VAT inclusive)'))}<details><summary className="cursor-pointer py-3">{text('จำนวนในแพ็กและสมมติฐานเพิ่มเติม', 'Pack count and additional assumptions')}</summary><div className="space-y-4">{control(index, 'pack.count', text('ชิ้นต่อแพ็ก (ค่าเริ่มต้น 1)', 'Pieces per pack (default 1)'))}{control(index, 'additionalCostExVat', text('ค่าเพิ่ม/แพ็ก ไม่รวม VAT (สมมติฐาน)', 'Additional cost per pack, ex VAT (assumption)'), text('ค่าเริ่มต้น 0 ยังใช้แทนต้นทุนภายในไม่ได้', 'Defaults to 0; does not replace internal cost.'))}{control(index, 'assumption', text('ที่มาของสมมติฐานค่าเพิ่ม', 'Additional-cost assumption label'))}</div></details>{form.proposals.length > 1 && <Button disabled={disabled} onClick={() => change({ ...form, proposals: form.proposals.filter((_, i) => i !== index) })}>{text('นำแบบนี้ออก', 'Remove this option')}</Button>}</div></Panel>)}</div><div className="flex gap-3 flex-wrap"><Button disabled={disabled || form.proposals.length >= 6} onClick={() => change({ ...form, proposals: [...form.proposals, blankProposal(form.proposals.length + 1, inputs)] })}>{text('เพิ่มแบบเพื่อเทียบ (สูงสุด 6)', 'Add comparison option (up to 6)')}</Button><Button disabled={disabled} onClick={review}>{text('คำนวณและเทียบผล', 'Calculate and compare')}</Button></div></>}
      {step === 'review' && (preview ? <><PackEvidence value={preview} /><div className="flex gap-3 flex-wrap">{canSavePack(role) && <Button disabled={disabled} onClick={save}>{writer.busy ? text('กำลังตรวจผลบันทึก…', 'Verifying save…') : text('บันทึกร่างเพื่อทบทวน', 'Save draft for review')}</Button>}<WorkspaceLink to={`${base}/scenarios`}>{text('กลับไปแก้ทางเลือก', 'Edit proposed options')}</WorkspaceLink><Button disabled={disabled} onClick={review}>{text('อ่านและคำนวณอีกครั้ง', 'Read and calculate again')}</Button></div></> : <Empty>{text('ยังไม่มีผลคำนวณที่ยืนยันสำหรับค่าปัจจุบัน อ่านและคำนวณใหม่ก่อนบันทึก', 'No verified calculation for the current values. Recalculate before saving.')}<Button disabled={disabled} onClick={review}>{text('คำนวณผลปัจจุบัน', 'Calculate current values')}</Button><WorkspaceLink to={`${base}/scenarios`}>{text('แก้ค่าที่เสนอ', 'Edit proposed values')}</WorkspaceLink></Empty>)}
    </>}
    {Object.keys(errors).length > 0 && <Alert tone="danger">{errors.request ?? text('ยังมีค่าที่ต้องแก้ เปิดขั้นเสนอแพ็กและตรวจช่องที่ระบุ ก่อนคำนวณใหม่', 'Some values need correction. Open proposed options and inspect the marked fields before recalculating.')}</Alert>}<ErrorText error={previewWork.error} /><ErrorText error={writer.error} />{previewWork.busy && <Loading variant="detail" />}
  </CommercePage>;
}
