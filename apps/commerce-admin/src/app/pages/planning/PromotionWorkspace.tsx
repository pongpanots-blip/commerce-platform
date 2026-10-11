import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, ButtonLink, Chip, Empty, Loading, PageHeader, Panel, PanelHead, TaskInput, TaskSelect, useUiLocale } from '@cp/ui';
import { api, session } from '../../../lib/api';
import { CommercePage } from '../../CommercePage';
import { commerceText as text } from '../../commerce-copy';
import { useAsync, useMutation } from '../../hooks';
import { WorkspaceLink } from '../../WorkspaceParts';
import { PROMOTION_HOME as home, promotionApi as endpoint, draftPageSchema, friendlyError, observedTime, parseInputs, parsePreview, parseReceipt, uuid, type PromotionInputs, type PromotionPreview, type PromotionReceipt } from './promotion-contracts';
import { blankPromotionForm, buildPromotionScenario, clearPromotionForm, formFromScenario, readPromotionForm, storePromotionForm, type PromotionForm } from './promotion-form';
import { clearPromotionJob, packetFor, readPromotionJobs, storePromotionJob, verifySavedJob, type PromotionSaveJob } from './promotion-journal';
import { PromotionEvidence } from './PromotionEvidence';
import { PlanningError as ErrorText } from './PlanningError';
import { ValidatedPlanningHandoff, type PlanningReferral } from '../competitor-comparison/ValidatedPlanningHandoff';

const detailUrl = (id: string) => `${home}/drafts/${id}`;
const requestUrl = (id: string) => `${home}/requests/${id}`;
async function readable<T>(operation: () => Promise<T>): Promise<T> { try { return await operation(); } catch (e) { throw new Error(friendlyError(e)); } }
function useJobs(owner: string) {
  const [jobs, setJobs] = useState(() => readPromotionJobs(owner));
  useEffect(() => { const refresh = () => setJobs(readPromotionJobs(owner)); refresh(); window.addEventListener('storage', refresh); window.addEventListener('cp-promotion-journal', refresh); return () => { window.removeEventListener('storage', refresh); window.removeEventListener('cp-promotion-journal', refresh); }; }, [owner]);
  return jobs;
}

/** The immutable request is retained before dispatch. A lost response never becomes a second intent. */
export function usePromotionWriter(owner: string) {
  const lock = useRef(false), mounted = useRef(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function write(job: PromotionSaveJob): Promise<PromotionReceipt | null> {
    if (lock.current || !mounted.current) return null;
    lock.current = true; setBusy(true); setError(null);
    try {
      try { storePromotionJob(job); } catch { throw new Error(text('ยังเก็บคำขอกู้คืนในเบราว์เซอร์ไม่ได้ จึงยังไม่ส่งบันทึก ตรวจพื้นที่จัดเก็บแล้วลองใหม่', 'The recovery request could not be retained. No save was sent. Check browser storage and retry.')); }
      let receipt: PromotionReceipt;
      try {
        const raw = job.draftId ? await api.patch(`${endpoint}/drafts/${job.draftId}`, packetFor(job)) : await api.post(`${endpoint}/drafts`, packetFor(job));
        receipt = verifySavedJob(parseReceipt(raw, job.draftId ?? undefined), job);
      } catch (e) {
        if ((e as { status?: number }).status === 409) { try { storePromotionJob({ ...job, conflict: true }); } catch { /* Retain the original immutable packet. */ } }
        throw new Error(text('ยังยืนยันผลบันทึกไม่ได้ เปิดหน้าตรวจคำขอเดิมก่อนลองบันทึกซ้ำ', 'The save result is unverified. Check this request before submitting again.'));
      }
      clearPromotionForm(owner, job.draftId ?? undefined);
      try { clearPromotionJob(owner, job.requestId); } catch { /* A replayed receipt remains safe if browser cleanup fails. */ }
      return mounted.current ? receipt : null;
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : friendlyError(e)); return null; }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return { write, busy, error };
}

export default function PromotionWorkspace({ role = session.claims()?.role }: { role?: string }) {
  useUiLocale(); const { pathname } = useLocation();
  if (role !== 'admin') return <CommercePage><PageHeader title={text('ทดลองโปรโมชัน', 'Plan a promotion')} /><Alert tone="danger">{text('เฉพาะผู้ดูแลระบบเท่านั้น', 'Administrator access required.')}</Alert></CommercePage>;
  const owner = String(session.claims()?.sub ?? '');
  if (!owner) return <CommercePage><Alert tone="danger">{text('ยังยืนยันบัญชีไม่ได้ โปรดเข้าสู่ระบบใหม่', 'The account could not be verified. Sign in again.')}</Alert></CommercePage>;
  const path = pathname.replace(/\/$/, '');
  if (path === home) return <DraftIndex owner={owner} />;
  if (path === `${home}/new`) return <ValidatedPlanningHandoff>{referral => <DraftEditor key={referral?.sourceFingerprint ?? "new"} owner={owner} referral={referral} />}</ValidatedPlanningHandoff>;
  const match = path.match(/^\/planning\/promotions\/(drafts|requests)\/([^/]+)(\/edit)?$/);
  const id = uuid.safeParse(match?.[2]);
  if (!match || !id.success || match[1] === 'requests' && match[3]) return <CommercePage><PageHeader title={text('ไม่พบหน้าร่างนี้', 'Draft page unavailable')} /><WorkspaceLink to={home}>{text('กลับไปร่างโปรโมชัน', 'Back to promotion drafts')}</WorkspaceLink></CommercePage>;
  return match[1] === 'requests' ? <RequestRecovery key={id.data} owner={owner} requestId={id.data} /> : match[3] ? <DraftEditor key={id.data} owner={owner} draftId={id.data} /> : <DraftDetail draftId={id.data} />;
}

function PendingRequests({ jobs }: { jobs: PromotionSaveJob[] }) {
  return jobs.length ? <Panel><PanelHead title={text('คำขอที่ยังต้องตรวจผล', 'Requests with unverified results')} /><div className="p-4 space-y-2"><p className="text-sm">{text('รายการจากเบราว์เซอร์นี้ ยังไม่นับเป็นร่างที่บันทึกแล้ว', 'These browser requests are not counted as saved drafts.')}</p>{jobs.map(job => <WorkspaceLink key={job.requestId} to={requestUrl(job.requestId)}>{job.scenario.name} · {text('ตรวจผลบันทึก', 'Check save result')}</WorkspaceLink>)}</div></Panel> : null;
}

function DraftIndex({ owner }: { owner: string }) {
  const [query] = useSearchParams(), cursor = query.get('after'), valid = !cursor || uuid.safeParse(cursor).success;
  const list = useAsync(() => valid ? readable(async () => draftPageSchema.parse(await api.get(`${endpoint}/drafts${cursor ? `?after=${cursor}` : ''}`))) : Promise.resolve(null), [cursor, valid]);
  const jobs = useJobs(owner);
  return <CommercePage><PageHeader title={text('ร่างโปรโมชัน', 'Promotion drafts')} subtitle={text('ทดลองผลส่วนลดและเก็บหลักฐานเพื่อทบทวน', 'Rehearse discounts and retain evidence for review.')} actions={<ButtonLink to={`${home}/new`} variant="primary" icon="add">{text('ทดลองโปรโมชันใหม่', 'Plan a new promotion')}</ButtonLink>} />
    <PendingRequests jobs={jobs} /><Alert tone="muted">{text('ร่างเป็นของบัญชีนี้ การบันทึกร่างไม่เปลี่ยนราคาหรือเปิดแคมเปญ', 'Drafts belong to this account. Saving does not change prices or activate a campaign.')}</Alert>
    {!valid ? <Alert tone="danger">{text('ลิงก์หน้ารายการไม่ถูกต้อง', 'Invalid list cursor.')} <Link to={home}>{text('กลับหน้าแรก', 'Open the first page')}</Link></Alert> : <><ErrorText error={list.error} onRetry={list.reload} />{list.loading ? <Loading variant="table" /> : !list.error && list.data && <>
      <p className="text-sm" role="status">{text('รายการที่แสดง', 'Showing')} {list.data.items.length}</p>
      {!list.data.items.length ? <Empty>{text('ยังไม่มีร่างในหน้านี้ เริ่มทดลองหรือกลับหน้ารายการแรก', 'No drafts on this page. Start a rehearsal or return to the first page.')}</Empty> : <div className="grid gap-4 lg:grid-cols-2">{list.data.items.map(item => <Panel key={item.id}><div className="p-4 space-y-3"><Chip tone="ok">{text('บันทึกร่างแล้ว', 'Draft saved')}</Chip><WorkspaceLink to={detailUrl(item.id)}>{item.scenario.name}</WorkspaceLink><p className="text-sm"><span className="font-mono">{item.scenario.line.sku}</span> · <span className="tabular-nums">{item.scenario.line.quantity}</span> {item.scenario.line.unit}</p><p className="text-xs">{text('ฉบับ', 'Revision')} {item.revision} · {observedTime(item.updatedAt)}</p><Chip tone="warn">{text('หลักฐานยังไม่ครบ', 'Evidence incomplete')}</Chip></div></Panel>)}</div>}
      <div className="flex flex-wrap gap-3">{cursor && <WorkspaceLink to={home}>{text('กลับหน้ารายการแรก', 'First page')}</WorkspaceLink>}{list.data.next && <WorkspaceLink to={`${home}?after=${list.data.next}`}>{text('รายการถัดไป', 'Next page')}</WorkspaceLink>}<Button onClick={list.reload}>{text('โหลดอีกครั้ง', 'Refresh')}</Button></div>
    </>}</>}
  </CommercePage>;
}

function DraftDetail({ draftId }: { draftId: string }) {
  const [params] = useSearchParams(), requested = params.get('saved'), proofId = uuid.safeParse(requested);
  const detail = useAsync(() => readable(async () => parseReceipt(await api.get(`${endpoint}/drafts/${draftId}`), draftId)), [draftId]);
  const proof = useAsync(() => !requested || !proofId.success ? Promise.resolve(null) : readable(async () => parseReceipt(await api.get(`${endpoint}/requests/${proofId.data}`), draftId)), [draftId, requested]);
  return <CommercePage><WorkspaceLink to={home}>{text('กลับไปร่างโปรโมชัน', 'Back to promotion drafts')}</WorkspaceLink><PageHeader title={detail.data?.scenario.name ?? text('ร่างโปรโมชัน', 'Promotion draft')} actions={<WorkspaceLink to={`${detailUrl(draftId)}/edit`}>{text('แก้ไขร่าง', 'Edit draft')}</WorkspaceLink>} />
    {proof.data && !proof.error && <Alert tone="ok"><span role="status">{text('ยืนยันแล้วว่าคำขอนี้บันทึกร่างสำเร็จ', 'This request has a verified saved receipt.')} · {text('ฉบับ', 'Revision')} {proof.data.revision}</span></Alert>}
    {requested && (!proofId.success || proof.error) && <Alert tone="warn">{text('ยังยืนยันคำขอบันทึกนี้ไม่ได้ สถานะร่างด้านล่างมาจากการอ่านล่าสุด', 'This request is unverified. The draft below comes from the latest read.')}</Alert>}
    <ErrorText error={detail.error} onRetry={detail.reload} />{detail.loading ? <Loading variant="detail" /> : !detail.error && detail.data && <><div className="flex flex-wrap gap-3"><Chip tone="ok">{text('บันทึกร่างแล้ว', 'Draft saved')}</Chip><Chip tone="muted">{text('ฉบับ', 'Revision')} {detail.data.revision}</Chip><Button onClick={detail.reload}>{text('โหลดอีกครั้ง', 'Refresh')}</Button></div><p className="text-sm"><span className="font-mono">{detail.data.scenario.line.sku}</span> · <span className="tabular-nums">{detail.data.scenario.line.quantity}</span> {detail.data.scenario.line.unit}</p><PromotionEvidence value={detail.data} saved /></>}
  </CommercePage>;
}

function RequestRecovery({ owner, requestId }: { owner: string; requestId: string }) {
  const navigate = useNavigate(), jobs = useJobs(owner), job = jobs.find(j => j.requestId === requestId), writer = usePromotionWriter(owner);
  const lookup = useAsync(async () => {
    try { const receipt = parseReceipt(await api.get(`${endpoint}/requests/${requestId}`)); if (job) verifySavedJob(receipt, job); return { receipt, absent: false }; }
    catch (e) { if ((e as { status?: number }).status === 404) return { receipt: null, absent: true }; throw new Error(friendlyError(e)); }
  }, [requestId]);
  const resolved = lookup.data?.receipt;
  useEffect(() => { if (!resolved) return; if (job) clearPromotionForm(owner, job.draftId ?? undefined); try { clearPromotionJob(owner, requestId); } catch { /* Keep verified receipt visible. */ } }, [resolved, owner, requestId]);
  async function retry() { if (!job || !lookup.data?.absent || job.conflict) return; const receipt = await writer.write(job); if (receipt) navigate(`${detailUrl(receipt.id)}?saved=${requestId}`, { replace: true }); else lookup.reload(); }
  return <CommercePage><WorkspaceLink to={home}>{text('กลับไปร่างโปรโมชัน', 'Back to promotion drafts')}</WorkspaceLink><PageHeader title={text('ตรวจผลคำขอบันทึก', 'Check save request')} subtitle={job?.scenario.name} /><ErrorText error={lookup.error} onRetry={lookup.reload} />{lookup.loading ? <Loading variant="detail" /> : lookup.error ? null : resolved ? <><Alert tone="ok"><span role="status">{text('พบหลักฐานบันทึกแล้ว', 'Saved receipt verified.')}</span></Alert><WorkspaceLink to={`${detailUrl(resolved.id)}?saved=${requestId}`}>{text('เปิดร่างที่บันทึกแล้ว', 'Open saved draft')}</WorkspaceLink><PromotionEvidence value={resolved} saved /></> : <><Alert tone="warn">{text('ยังไม่มีหลักฐานว่าคำขอนี้บันทึกแล้ว จึงยังไม่แสดงว่าบันทึกสำเร็จ', 'No saved receipt was found. This request is not marked successful.')}</Alert>{job ? job.conflict ? <><Alert tone="warn">{text('ฉบับร่างหรือข้อมูลสินค้าเปลี่ยน ต้องเปิดฉบับล่าสุดและทบทวนก่อนเริ่มคำขอใหม่', 'The revision or product data changed. Review the latest draft before starting a new request.')}</Alert><WorkspaceLink to={job.draftId ? `${detailUrl(job.draftId)}/edit` : `${home}/new`}>{text('เปิดข้อมูลล่าสุด', 'Review the latest version')}</WorkspaceLink><Button onClick={() => { try { clearPromotionJob(owner, requestId); navigate(home); } catch { lookup.reload(); } }}>{text('ยกเลิกคำขอที่ไม่สำเร็จ', 'Dismiss unsuccessful request')}</Button></> : <Button disabled={writer.busy} onClick={retry}>{writer.busy ? text('กำลังยืนยันผล…', 'Verifying…') : text('ลองส่งคำขอเดิมอีกครั้ง', 'Retry the same request')}</Button> : <Empty>{text('ไม่มีข้อมูลคำขอเดิมในเบราว์เซอร์นี้ จึงยังส่งซ้ำอย่างปลอดภัยไม่ได้ กลับไปดูร่างหรือโหลดผลอีกครั้ง', 'The original request is unavailable in this browser. Return to drafts or check the receipt again.')}</Empty>}<Button disabled={lookup.loading || writer.busy} onClick={lookup.reload}>{text('ตรวจผลอีกครั้ง', 'Check again')}</Button></>}<ErrorText error={writer.error} />
  </CommercePage>;
}

function DraftEditor({ owner, draftId, referral }: { owner: string; draftId?: string; referral?: PlanningReferral }) {
  const original = useAsync(() => draftId ? readable(async () => parseReceipt(await api.get(`${endpoint}/drafts/${draftId}`), draftId)) : Promise.resolve(null), [draftId]);
  if (draftId && original.loading) return <CommercePage><Loading variant="detail" /></CommercePage>;
  if (draftId && (original.error || !original.data)) return <CommercePage><WorkspaceLink to={home}>{text('กลับไปร่าง', 'Back to drafts')}</WorkspaceLink><ErrorText error={original.error} onRetry={original.reload} /></CommercePage>;
  return <EditorForm key={`${draftId ?? 'new'}:${original.data?.revision ?? 0}`} owner={owner} original={original.data} referral={referral} />;
}

function EditorForm({ owner, original, referral }: { owner: string; original: PromotionReceipt | null; referral?: PlanningReferral }) {
  const draftId = original?.id, revision = original?.revision ?? null, backup = useRef(readPromotionForm(owner, draftId));
  const [form, setForm] = useState(() => backup.current?.revision === revision ? backup.current.form : original ? formFromScenario(original.scenario) : { ...blankPromotionForm(), sku: referral?.sku ?? "" });
  const [backupChoice, setBackupChoice] = useState(backup.current && backup.current.revision !== revision ? 'pending' : 'latest');
  const saveLock = useRef(false);
  const [errors, setErrors] = useState<Record<string, string>>({}), [inputs, setInputs] = useState<PromotionInputs | null>(null), [preview, setPreview] = useState<PromotionPreview | null>(null), [pendingId, setPendingId] = useState<string | null>(null);
  const sourceWork = useMutation(), previewWork = useMutation(), writer = usePromotionWriter(owner), navigate = useNavigate(), jobs = useJobs(owner);
  const pending = jobs.find(j => j.draftId === (draftId ?? null)), busy = sourceWork.busy || previewWork.busy || writer.busy || backupChoice === 'pending';
  const changedBackup = backupChoice === 'pending';
  useEffect(() => { if (!changedBackup) storePromotionForm(owner, draftId, revision, form); }, [owner, draftId, revision, form, changedBackup]);
  function change<K extends keyof PromotionForm>(key: K, value: PromotionForm[K]) { setForm(previous => ({ ...previous, [key]: value })); setErrors({}); setPreview(null); if (key === 'sku') setInputs(null); }
  async function loadProduct() {
    if (!form.sku.trim()) { setErrors({ sku: text('กรอกรหัสสินค้าก่อน', 'Enter a SKU first.') }); return; }
    const result = await sourceWork.run(() => readable(async () => parseInputs(await api.get(`${endpoint}/inputs/${encodeURIComponent(form.sku.trim())}`), form.sku.trim())));
    if (result.ok) { setInputs(result.value); setPreview(null); if (!original && result.value.product.unit) setForm(f => ({ ...f, sku: result.value.sku, unit: result.value.product.unit! })); }
  }
  const sourceMatches = inputs && inputs.sku === form.sku.trim() && inputs.product.unit === form.unit && !!inputs.product.unit;
  async function rehearse() {
    const parsed = buildPromotionScenario(form); setErrors(parsed.errors);
    if (!parsed.scenario || !sourceMatches || pending) { setTimeout(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0); return; }
    const result = await previewWork.run(() => readable(async () => parsePreview(await api.post(`${endpoint}/preview`, parsed.scenario), parsed.scenario!)));
    if (result.ok) setPreview(result.value);
  }
  async function save() {
    if (!preview || pending || saveLock.current) return;
    saveLock.current = true;
    const job: PromotionSaveJob = { schemaVersion: 1, owner, requestId: crypto.randomUUID(), draftId: draftId ?? null, revision, scenario: preview.scenario, createdAt: new Date().toISOString(), conflict: false };
    try { setPendingId(job.requestId); const receipt = await writer.write(job); if (receipt) navigate(`${detailUrl(receipt.id)}?saved=${job.requestId}`); }
    finally { saveLock.current = false; }
  }
  const control = (key: Exclude<keyof PromotionForm, 'tiers'>, label: string, help?: string) => <TaskInput name={key} label={label} help={help} value={form[key]} error={errors[key]} disabled={busy || !!pending} inputMode={['quantity', 'percent', 'amount', 'buy', 'get', 'getPercent', 'margin'].includes(key) ? 'decimal' : undefined} onChange={e => change(key, e.target.value as never)} />;
  return <CommercePage>{referral && form.sku !== referral.sku && <Alert tone="warn">{text("มีฟอร์มของสินค้าอื่น ค่าถูกเก็บไว้จนกว่าจะเลือกสินค้าใหม่", "An existing form uses another product. Its values remain retained until you choose the new product.")}<Button disabled={busy || !!pending} onClick={() => { setForm({ ...blankPromotionForm(), sku: referral.sku }); setInputs(null); setPreview(null); }}>{text("ใช้สินค้าที่เลือกและเริ่มสมมติฐานใหม่", "Use selected product and start new assumptions")}</Button></Alert>}<WorkspaceLink to={draftId ? detailUrl(draftId) : home}>{text('กลับไปร่างโปรโมชัน', 'Back to promotion drafts')}</WorkspaceLink><PageHeader title={original ? text('แก้ไขร่างโปรโมชัน', 'Edit promotion draft') : text('ทดลองโปรโมชันใหม่', 'Plan a new promotion')} subtitle={text('1 เลือกสินค้า · 2 ใส่กติกา · 3 ตรวจผลและบันทึกร่าง', '1 Choose product · 2 Set offer · 3 Review and save draft')} />
    {backup.current?.revision === revision && <Alert tone="muted">{text('คืนค่าที่กรอกไว้ในแท็บนี้ ยังไม่ใช่ร่างที่บันทึกบนระบบ', 'Restored input from this tab. These values are not a saved server draft.')}</Alert>}
    {changedBackup && <Alert tone="warn">{text('มีค่าที่ค้างจากฉบับเก่า กำลังแสดงฉบับล่าสุด เก็บสำเนาค่าเดิมเป็นร่างใหม่ได้', 'Older unsaved input exists. The latest version is shown; you can copy the older values into a new draft.')}<Button onClick={() => { storePromotionForm(owner, undefined, null, backup.current!.form); navigate(`${home}/new`); }}>{text('คัดลอกค่าเดิมเป็นร่างใหม่', 'Copy old input into a new draft')}</Button><Button onClick={() => { backup.current = null; setBackupChoice('latest'); }}>{text('เริ่มแก้จากฉบับล่าสุด', 'Edit from the latest revision')}</Button></Alert>}
    <PendingRequests jobs={pending ? [pending] : []} />
    <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); void rehearse(); }} aria-busy={busy}>
      <Panel><PanelHead title={text('1 เลือกสินค้าและจำนวน', '1 Choose product and quantity')} /><div className="p-4 grid gap-4 md:grid-cols-2">{control('name', text('ชื่อร่าง', 'Draft name'))}{control('sku', text('รหัสสินค้า', 'SKU'))}<Button type="button" disabled={busy || !!pending} onClick={loadProduct}>{sourceWork.busy ? text('กำลังอ่านสินค้า…', 'Reading product…') : text('อ่านข้อมูลสินค้า', 'Read product inputs')}</Button><ErrorText error={sourceWork.error} onRetry={busy || pending ? undefined : loadProduct} />
        {inputs && <p className="text-sm">{text('หน่วยที่อ่านได้', 'Observed unit')}: {inputs.product.unit ?? text('ยังไม่มีข้อมูล', 'Unavailable')} · {text('ราคาที่อ่านได้', 'Observed price')}: {inputs.price.unitPrice ?? '—'} {text('บาท · ยังไม่ยืนยันความสด', 'THB · freshness unverified')}</p>}
        {inputs && !inputs.product.unit && <Alert tone="warn">{text('ยังไม่มีหน่วยขายที่ยืนยัน อ่านใหม่หรือตรวจข้อมูลสินค้า ก่อนทดลองจำนวน', 'The selling unit is unavailable. Retry or inspect the product before rehearsing quantities.')}</Alert>}
        {inputs?.product.unit && inputs.product.unit !== form.unit && <Button type="button" disabled={busy || !!pending} onClick={() => { change('unit', inputs.product.unit!); change('quantity', ''); }}>{text('ใช้หน่วยล่าสุดและกรอกจำนวนใหม่', 'Use current unit and enter quantity again')}</Button>}
        <TaskSelect label={text('วิธีนับจำนวน', 'Quantity basis')} name="quantityKind" value={form.quantityKind} error={errors.quantityKind} disabled={busy || !!pending} onChange={e => change('quantityKind', e.target.value as 'count' | 'measure')}><option value="count">{text('จำนวนชิ้น', 'Whole count')}</option><option value="measure">{text('วัดตามน้ำหนักหรือปริมาตร', 'Measured weight or volume')}</option></TaskSelect>{control('quantity', text('จำนวนที่ทดลอง', 'Rehearsal quantity'), form.unit ? `${text('หน่วย', 'Unit')}: ${form.unit}` : text('อ่านข้อมูลสินค้าก่อน', 'Read product inputs first.'))}
      </div></Panel>
      <Panel><PanelHead title={text('2 ใส่กติกาที่ต้องการทดลอง', '2 Set the proposed offer')} /><div className="p-4 grid gap-4 md:grid-cols-2"><TaskSelect name="type" label={text('รูปแบบส่วนลด', 'Offer type')} disabled={busy || !!pending} value={form.type} onChange={e => change('type', e.target.value as PromotionForm['type'])}><option value="none">{text('ไม่มีส่วนลด', 'No discount')}</option><option value="percentage">{text('ลดเป็นเปอร์เซ็นต์', 'Percentage discount')}</option><option value="fixed">{text('ลดทั้งรายการเป็นบาท', 'Fixed discount on the entire line')}</option><option value="bogo">{text('ซื้อครบชุดแล้วแถม', 'Buy/get offer')}</option><option value="tiered">{text('ราคาต่อหน่วยตามช่วงจำนวน', 'Unit price by quantity range')}</option></TaskSelect>
        {form.type === 'percentage' && control('percent', text('ส่วนลด (%)', 'Discount (%)'), '0–100')}{form.type === 'fixed' && control('amount', text('ลดทั้งรายการ (บาท)', 'Discount on the entire line (THB)'), text('จำนวนนี้หักจากยอดรวมทั้งรายการ', 'This amount is deducted once from the entire line total.'))}
        {form.type === 'bogo' && <>{control('buy', text('ซื้อกี่ชิ้นต่อชุด', 'Purchased items per set'))}{control('get', text('แถมกี่ชิ้นต่อชุด', 'Discounted items per set'))}{control('getPercent', text('ส่วนลดของชิ้นแถม (%)', 'Discount on get items (%)'), text('100 คือแถมฟรี จำนวนทดลองรวมชิ้นซื้อและชิ้นแถม', '100 means free. Rehearsal quantity includes buy and get items.'))}</>}
        {form.type === 'tiered' && <div className="md:col-span-2 space-y-4">{form.tiers.map((tier, i) => <fieldset className="rounded-lg border border-secondary-container p-3 grid gap-3 md:grid-cols-3" key={i}><legend>{text('ช่วง', 'Range')} {i + 1}</legend>{(['min', 'max', 'price'] as const).map((key, n) => <TaskInput key={key} label={text(...([['จำนวนเริ่มต้น', 'Minimum quantity'], ['จำนวนสูงสุด (เว้นว่างได้)', 'Maximum quantity (optional)'], ['ราคาต่อหน่วย (บาท)', 'Unit price (THB)']][n] as [string, string]))} value={tier[key]} inputMode="decimal" error={errors[`tiers.${i}.${key === 'min' ? 'min_qty' : key === 'max' ? 'max_qty' : 'promotion_price'}`]} disabled={busy || !!pending} onChange={e => change('tiers', form.tiers.map((t, index) => index === i ? { ...t, [key]: e.target.value } : t))} />)}<Button type="button" disabled={busy || !!pending || form.tiers.length === 1} onClick={() => change('tiers', form.tiers.filter((_, index) => index !== i))}>{text('ลบช่วง', 'Remove range')} {i + 1}</Button></fieldset>)}<Button type="button" disabled={busy || !!pending || form.tiers.length >= 100} onClick={() => change('tiers', [...form.tiers, { min: '', max: '', price: '' }])}>{text('เพิ่มช่วงจำนวน', 'Add quantity range')}</Button></div>}
        <details className="md:col-span-2"><summary className="cursor-pointer py-3">{text('เกณฑ์เพิ่มเติม', 'Additional constraint')}</summary>{control('margin', text('กำไรขั้นต้นขั้นต่ำ (%) — เว้นว่างได้', 'Minimum gross margin (%) — optional'), text('ยังยืนยันเกณฑ์นี้ไม่ได้จนกว่าจะมีต้นทุน', 'This constraint is unverified until cost is available.'))}</details>
      </div></Panel>
      {!!Object.keys(errors).length && <Alert tone="danger"><span role="alert">{text('ตรวจช่องที่ระบุก่อนทดลอง', 'Review the highlighted fields before rehearsing.')}</span></Alert>}
      <ErrorText error={previewWork.error} onRetry={busy || pending ? undefined : rehearse} /><Button type="submit" disabled={busy || !sourceMatches || !!pending}>{previewWork.busy ? text('กำลังทดลอง…', 'Rehearsing…') : text('3 ตรวจผลทดลอง', '3 Review rehearsal')}</Button>
      {previewWork.busy && <Loading variant="detail" />}{preview && <><PromotionEvidence value={preview} /><Button type="button" disabled={busy || !!pending} onClick={save}>{writer.busy ? text('กำลังบันทึกร่าง…', 'Saving draft…') : text('บันทึกร่างและหลักฐาน', 'Save draft and evidence')}</Button><p className="text-sm">{text('ระบบอ่านหลักฐานใหม่ขณะบันทึก ผลร่างที่บันทึกอาจต่างจากผลทดลองก่อนหน้า', 'Evidence is recaptured when saving. The saved result may differ from this preview.')}</p></>}
      <ErrorText error={writer.error} />{pendingId && writer.error && <WorkspaceLink to={requestUrl(pendingId)}>{text('ตรวจผลคำขอเดิม', 'Check this save request')}</WorkspaceLink>}
    </form>
  </CommercePage>;
}
