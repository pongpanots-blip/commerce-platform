import { useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Chip, Empty, Loading, PageHeader, Panel, PanelHead, TaskInput, Table, THead, TBody, TH, TD, TR, useUiLocale } from '@cp/ui';
import { GUIDED_ANALYSIS_API as endpoint, GUIDED_ANALYSIS_HOME as home, guidedAnalysisRoles, guidedSearch, guidedTemplateId, guidedTemplatePath, normalizeGuidedQuery, verifyGuidedCatalog, verifyGuidedPreview, type GuidedPreview, type GuidedQuery } from '../../../../../commerce-platform/src/modules/integration/guided-analysis/guided-analysis.contracts';
import { api, session } from '../../../lib/api';
import { normalizeRole } from '../../../lib/role-home';
import { CommercePage } from '../../CommercePage';
import { commerceText as text } from '../../commerce-copy';
import { useAsync, useMutation } from '../../hooks';
import { WorkspaceLink, WorkspaceMetric } from '../../WorkspaceParts';
import { PlanningError } from '../planning/PlanningError';
import { contractLabel, criterionLabel, inputLabel, membershipLabel, templateTitle } from './guided-analysis-copy';

const readFailure = () => text('อ่านผลวิเคราะห์ไม่สำเร็จ ลองอ่านเกณฑ์เดิมอีกครั้ง', 'Analysis could not be read. Retry the same criteria.');
const invalidCriteria = () => text('เลือกจำนวนเต็มในช่วงที่กำหนด โดยช่วงที่เว้นสั่งต้องไม่เกินช่วงนับออเดอร์', 'Use whole numbers within the shown limits. Inactivity must fit inside the purchase window.');
async function readPreview(query: GuidedQuery) {
  try { return verifyGuidedPreview(await api.get(endpoint + '/preview' + guidedSearch(query)), query); }
  catch { throw Error(readFailure()); }
}
function queryFrom(id: string, params: URLSearchParams): GuidedQuery | null {
  const entries = [...params.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length || params.has('template')) return null;
  try { return normalizeGuidedQuery({ template: id, ...Object.fromEntries(entries) }); }
  catch { return null; }
}
export function GuidedAnalysisWorkspace({ role = session.claims()?.role }: { role?: string }) {
  useUiLocale();
  const location = useLocation(), [params] = useSearchParams(), normalized = normalizeRole(role);
  if (!(guidedAnalysisRoles as readonly string[]).includes(normalized)) return <CommercePage><Alert tone="danger">{text('บัญชีนี้ไม่มีสิทธิ์อ่านการวิเคราะห์สาขา', 'This account cannot read guided branch analysis.')}</Alert></CommercePage>;
  const suffix = location.pathname.slice(home.length).replace(/\/$/, ''), account = session.claims()?.sub ?? normalized;
  if (!suffix && !params.size) return <TemplatePicker key={account} />;
  const match = /^\/templates\/([^/]+)(?:\/(preview|evidence))?$/.exec(suffix), id = match && guidedTemplateId.safeParse(match[1]);
  const query = id?.success ? queryFrom(id.data, params) : null;
  if (!query || !match) return <CommercePage><PageHeader title={text('ตรวจเกณฑ์วิเคราะห์', 'Check analysis criteria')} /><PlanningError error={invalidCriteria()} /><WorkspaceLink to={home}>{text('เลือกเรื่องที่ต้องการตรวจใหม่', 'Choose an analysis template')}</WorkspaceLink></CommercePage>;
  return match[2] ? <PreviewPage key={account + ':' + location.pathname + location.search} query={query} evidence={match[2] === 'evidence'} /> : <CriteriaForm key={account + ':' + location.pathname + location.search} query={query} />;
}
export default GuidedAnalysisWorkspace;

function useCatalog() {
  return useAsync(async () => {
    try { return verifyGuidedCatalog(await api.get(endpoint + '/templates')); }
    catch { throw Error(text('อ่านรายการเกณฑ์ไม่สำเร็จ ลองอีกครั้ง', 'Templates could not be read. Try again.')); }
  });
}
function ScopeNote() {
  return <Alert tone="info"><p>{text('ตรวจระดับสาขา โดยใช้ประวัติออเดอร์ที่ยืนยันและหลักฐานว่าข้อมูลครบ จำนวนเข้าชมหรือเริ่มชำระเงินใช้ยืนยันออเดอร์ไม่ได้', 'Analysis is scoped to branches and requires confirmed orders plus complete-history evidence. Visits and checkout attempts cannot establish order acceptance.')}</p><p className="mt-2">{text('การตรวจเกณฑ์เป็นการอ่านและแสดงตัวอย่างขั้นตอน ยังไม่มีการสร้างกลุ่มลูกค้าหรือส่งข้อความ', 'Criteria review and journey steps are read-only previews. Audience creation and messaging are unavailable.')}</p></Alert>;
}
function TemplatePicker() {
  const state = useCatalog();
  return <CommercePage><PageHeader title={text('ตรวจพฤติกรรมการสั่งซื้อของสาขา', 'Review branch ordering behavior')} subtitle={text('เลือกคำถาม ตั้งเกณฑ์ แล้วตรวจฐานข้อมูลที่ยังขาดก่อนใช้ผล', 'Choose a question, set criteria and inspect the evidence required to use results.')} /><ScopeNote />
    {state.loading ? <Loading variant="form">{text('กำลังอ่านรายการเกณฑ์…', 'Reading templates…')}</Loading> : state.error ? <PlanningError error={state.error} onRetry={state.reload} /> : state.data && <>
      <Alert tone="warn" title={text('แหล่งข้อมูลจริงยังไม่พร้อม', 'Live source unavailable')}>{text('ตั้งและตรวจเกณฑ์ได้ ผลสมาชิกและจำนวนสาขายังยืนยันไม่ได้จนกว่าจะมีสัญญาข้อมูลและสิทธิ์ครบ', 'You can review criteria. Branch counts and membership remain unavailable until source and authorization contracts are complete.')}</Alert>
      {!state.data.templates.length ? <Empty>{text('ยังไม่มีเกณฑ์ที่อ่านได้ ลองโหลดรายการใหม่', 'No templates returned. Retry the template read.')}<Button type="button" onClick={state.reload}>{text('ลองอีกครั้ง', 'Try again')}</Button></Empty> : <div className="grid gap-4 lg:grid-cols-2">{state.data.templates.map(t => <Panel key={t.id}><PanelHead title={templateTitle(t.id)} /><div className="p-4 space-y-3"><p className="text-sm">{t.id === 'approved_without_order' ? text('ตรวจตั้งแต่วันเริ่มสาขา รวมช่วงก่อนอนุมัติ หากประวัติไม่ครบให้คงสถานะยังยืนยันไม่ได้', 'Check history from branch creation, including before approval. Incomplete history remains unknown.') : text('ตรวจการเว้นช่วงจากออเดอร์ที่ยืนยันแล้ว เป็นพฤติกรรมที่บันทึก ไม่ใช่การทำนายว่าจะเลิกซื้อ', 'Review inactivity using confirmed orders. Recorded inactivity does not predict churn.')} </p><WorkspaceLink to={guidedTemplatePath(normalizeGuidedQuery({ template: t.id }))}>{text('ตั้งเกณฑ์และตรวจ', 'Set criteria and review')}</WorkspaceLink></div></Panel>)}</div>}
    </>}
  </CommercePage>;
}
function CriteriaForm({ query }: { query: GuidedQuery }) {
  const catalog = useCatalog(), mutation = useMutation(), navigate = useNavigate();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'template').map(([key, value]) => [key, String(value)])));
  const [error, setError] = useState<string | null>(null), errorRef = useRef<HTMLDivElement>(null);
  const template = catalog.data?.templates.find(t => t.id === query.template);
  async function submit(event: FormEvent) {
    event.preventDefault();
    let next: GuidedQuery;
    try { next = normalizeGuidedQuery({ template: query.template, ...values }); }
    catch { setError(invalidCriteria()); setTimeout(() => errorRef.current?.focus(), 0); return; }
    setError(null);
    const result = await mutation.run(() => readPreview(next));
    if (result.ok) navigate(guidedTemplatePath(next, 'preview'));
  }
  return <CommercePage><PageHeader title={templateTitle(query.template)} subtitle={text('ใช้เกณฑ์ที่ผ่านการตรวจ โดยมีค่าตั้งต้นให้ปรับได้', 'Use validated criteria with adjustable defaults.')} /><WorkspaceLink to={home}>{text('เลือกคำถามอื่น', 'Choose another question')}</WorkspaceLink><ScopeNote />
    {catalog.loading ? <Loading variant="form">{text('กำลังอ่านรายการเกณฑ์…', 'Reading templates…')}</Loading> : catalog.error ? <PlanningError error={catalog.error} onRetry={catalog.reload} /> : !template ? <Empty>{text('รายการเกณฑ์นี้ยังอ่านไม่ได้ โหลดรายการอีกครั้ง', 'This template is unavailable. Reload the catalog.')}<Button type="button" onClick={catalog.reload}>{text('ลองอีกครั้ง', 'Try again')}</Button></Empty> : <Panel><PanelHead title={text('เกณฑ์ที่จะตรวจ', 'Criteria to review')} /><form className="p-4 space-y-4" onSubmit={submit} aria-busy={mutation.busy}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{template.inputs.map(input => <TaskInput key={input.key} name={input.key} label={inputLabel(input.key)} type="number" inputMode="numeric" min={input.min} max={input.max} step={1} required disabled={mutation.busy} value={values[input.key]} onChange={e => { setValues(v => ({ ...v, [input.key]: e.target.value })); setError(null); }} help={text(`จำนวนเต็ม ${input.min}–${input.max}`, `Whole number ${input.min}–${input.max}`)} />)}</div>
      <div ref={errorRef} tabIndex={-1}><PlanningError error={error ?? mutation.error} /></div>
      {mutation.busy && <Loading variant="detail">{text('กำลังตรวจเกณฑ์…', 'Checking criteria…')}</Loading>}
      <p className="text-sm text-on-surface-variant">{text('ช่วงเวลารวมจุดเริ่มต้นและไม่รวมเวลาประเมิน ต้องมีหลักฐานว่าประวัติครบ จึงใช้จำนวนศูนย์ได้', 'Intervals include their start and exclude evaluation time. Zero requires verified complete history.')}</p>
      <Button type="submit" variant="primary" disabled={mutation.busy}>{mutation.busy ? text('กำลังตรวจเกณฑ์…', 'Checking criteria…') : text('ตรวจเกณฑ์และดูตัวอย่าง', 'Check criteria and preview')}</Button>
    </form></Panel>}
  </CommercePage>;
}
function PreviewPage({ query, evidence }: { query: GuidedQuery; evidence: boolean }) {
  const state = useAsync(() => readPreview(query), [guidedSearch(query)]);
  return <CommercePage><PageHeader title={evidence ? text('ตรวจฐานและหลักฐานของเกณฑ์', 'Inspect criteria sources and evidence') : text('ตรวจเกณฑ์และตัวอย่างเส้นทาง', 'Review criteria and journey steps')} subtitle={templateTitle(query.template)} />
    <nav aria-label={text('ขั้นตอนตรวจวิเคราะห์', 'Analysis review steps')} className="grid gap-2 md:grid-cols-3"><WorkspaceLink to={guidedTemplatePath(query)}>{text('แก้เกณฑ์', 'Edit criteria')}</WorkspaceLink><WorkspaceLink to={guidedTemplatePath(query, 'preview')}>{text('ตัวอย่างเกณฑ์', 'Criteria preview')}</WorkspaceLink><WorkspaceLink to={guidedTemplatePath(query, 'evidence')}>{text('ตรวจแหล่งและหลักฐาน', 'Sources and evidence')}</WorkspaceLink></nav>
    {state.loading ? <Loading variant="detail">{text('กำลังอ่านเกณฑ์และฐานข้อมูล…', 'Reading criteria and source evidence…')}</Loading> : state.error ? <PlanningError error={state.error} onRetry={state.reload} /> : state.data && <PreviewContent value={state.data} evidence={evidence} />}
  </CommercePage>;
}
function PreviewContent({ value, evidence }: { value: GuidedPreview; evidence: boolean }) {
  const synthetic = value.mode === 'synthetic_fixture';
  return <><Alert tone="warn" title={synthetic ? text('ผลจากข้อมูลจำลองสำหรับทดสอบ', 'Synthetic fixture evaluation') : text('ตรวจเกณฑ์แล้ว แหล่งข้อมูลจริงยังไม่พร้อม', 'Criteria checked; live source unavailable')}><p>{synthetic ? text('ผลนี้มาจากข้อมูลจำลองที่มีสิทธิ์และเวลาประเมินกำหนดไว้ ใช้ตรวจพฤติกรรมของระบบเท่านั้น', 'These results use owned synthetic data with fixed scope and evaluation time. They verify application behavior only.') : text('เซิร์ฟเวอร์ตรวจเกณฑ์แล้ว จำนวนและสมาชิกยังไม่มีหลักฐานจากข้อมูลจริง', 'The server validated the criteria. Live counts and membership have no verified source.')}</p></Alert>
    <div className="grid gap-3 md:grid-cols-3">{(['matched', 'excluded', 'unknown'] as const).map(key => <WorkspaceMetric key={key} label={key === 'matched' ? text('สาขาที่เข้าเกณฑ์', 'Included branches') : key === 'excluded' ? text('สาขาที่ไม่เข้าเกณฑ์', 'Excluded branches') : text('สาขาที่ยังยืนยันไม่ได้', 'Unknown branches')} value={value.counts[key]} reason={text('ยังไม่มีขอบเขตสาขาและฐานข้อมูลที่ยืนยันได้', 'Verified branch scope and source evidence are unavailable.')} note={text('จำนวนจากผลจำลองที่ประเมินแล้ว', 'Count from evaluated synthetic evidence.')} />)}</div>
    <Panel><PanelHead title={text('เกณฑ์ที่เซิร์ฟเวอร์ตรวจแล้ว', 'Server-validated criteria')} /><ol className="list-decimal space-y-2 p-4 pl-9 text-sm">{value.criteria.map(c => <li key={c.kind}>{criterionLabel(c)}</li>)}</ol><p className="px-4 pb-4 text-sm text-on-surface-variant">{text('รวมจุดเริ่มต้นและไม่รวมเวลาประเมิน การไม่มีข้อมูลไม่ใช่จำนวนศูนย์ และสถานะยังยืนยันไม่ได้ยังคงเป็นเช่นเดิมเมื่อใช้ NOT', 'Intervals include the start and exclude evaluation time. Missing evidence is not zero; NOT preserves unknown evidence.')}</p></Panel>
    {evidence ? <EvidenceContent value={value} /> : <Panel><PanelHead title={text('ตัวอย่างขั้นตอนสำหรับทบทวน', 'Journey steps for review')} sub={text('ตัวอย่างกติกาเท่านั้น', 'Rule preview only')} /><ol className="grid gap-3 p-4 md:grid-cols-3">{[text('1. ตรวจสิทธิ์และตัวตนของสาขา', '1. Verify branch scope and identity'), text('2. ตรวจเกณฑ์กับช่วงประวัติที่ครบ', '2. Evaluate criteria over complete history'), text('3. แสดงเหตุผลและส่วนที่ยังยืนยันไม่ได้', '3. Review reasons and unknown evidence')].map(step => <li key={step} className="min-w-0 rounded-lg border border-secondary-container p-3 text-sm">{step}</li>)}</ol><p className="px-4 pb-4 text-sm">{text('ไม่มีปลายทางส่งข้อความหรือการเปิดใช้งาน Journey ในการตรวจนี้', 'Messaging destinations and journey activation are unavailable in this review.')}</p></Panel>}
  </>;
}
function EvidenceContent({ value }: { value: GuidedPreview }) {
  return <><Panel><PanelHead title={text('เวลาและฐานข้อมูล', 'Time and source basis')} /><dl className="grid gap-2 p-4 text-sm md:grid-cols-2"><div><dt>{text('สร้างคำตอบเมื่อ', 'Response generated at')}</dt><dd className="break-all">{value.capturedAt}</dd></div><div><dt>{text('เวลาประเมินที่กำหนด', 'Fixed evaluation time')}</dt><dd>{value.evaluatedAt ?? text('ยังไม่มีการประเมินข้อมูลจริง', 'Live data not evaluated')}</dd></div></dl><p className="px-4 pb-4 text-sm">{text('เวลาที่อ่านคำตอบไม่ใช่ความสดหรือหลักฐานว่าข้อมูลครบ', 'Response time does not establish source freshness or completeness.')}</p></Panel>
    <Panel><PanelHead title={text('สัญญาที่ต้องครบก่อนใช้ข้อมูลจริง', 'Contracts required for live evaluation')} /><ul className="list-disc space-y-2 p-4 pl-9 text-sm">{value.missingContracts.map(id => <li key={id}>{contractLabel(id)}</li>)}</ul></Panel>
    <Panel><PanelHead title={text('เหตุผลรายสาขา', 'Branch evidence')} />{value.mode === 'live_unavailable' ? <Empty>{text('ยังไม่มีขอบเขตสาขาที่แหล่งข้อมูลจริงยืนยันได้ จึงไม่แสดงรายชื่อหรือจำนวนศูนย์', 'Verified live branch scope is unavailable. No member list or zero count can be established.')}</Empty> : !value.branches.length ? <Empty>{text('ขอบเขตจำลองที่มีสิทธิ์ไม่มีสาขา', 'The authorized synthetic scope contains no branches.')}</Empty> : <div className="overflow-x-auto"><Table><THead><TH>{text('สาขาจำลอง', 'Synthetic branch')}</TH><TH>{text('ผลเกณฑ์', 'Membership')}</TH><TH>{text('เหตุผลตามหลักฐาน', 'Evidence reasons')}</TH></THead><TBody>{value.branches.map(branch => <TR key={branch.branchId}><TD kind="mono">{branch.branchId}</TD><TD><Chip tone={branch.result === 'unknown' ? 'warn' : 'muted'}>{membershipLabel(branch.result)}</Chip></TD><TD><ul className="space-y-2">{branch.reasons.map((reason, index) => <li key={index}>{membershipLabel(reason.result)} · {branch.reasons.length === value.criteria.length ? criterionLabel(value.criteria[index]) : reason.description}{reason.observedCount !== undefined && <p>{text('จำนวนที่หลักฐานยืนยัน', 'Verified observed count')}: {reason.observedCount === null ? text('ยังยืนยันไม่ได้', 'Unknown') : reason.observedCount}</p>}</li>)}</ul></TD></TR>)}</TBody></Table></div>}</Panel>
    {value.mode === 'synthetic_fixture' && <Panel><PanelHead title={text('หลักฐานความครบถ้วนของข้อมูลจำลอง', 'Synthetic completeness evidence')} />{!value.source.coverageAssertions.length ? <Empty>{text('ไม่มีหลักฐานช่วงประวัติในขอบเขตนี้', 'No interval coverage assertions returned for this scope.')}</Empty> : <div className="overflow-x-auto"><Table><THead><TH>{text('สาขา', 'Branch')}</TH><TH>{text('เหตุการณ์', 'Event')}</TH><TH>{text('ครบตั้งแต่ / จนถึง', 'Complete from / through')}</TH><TH>{text('ยืนยันช่วงข้อมูลเมื่อ', 'Coverage asserted at')}</TH><TH>{text('ยืนยันตัวตนครบ', 'Identity complete')}</TH></THead><TBody>{value.source.coverageAssertions.map(c => <TR key={c.branchId + ':' + c.event}><TD kind="mono">{c.branchId}</TD><TD>{c.event === 'order_accepted' ? text('ออเดอร์ที่ยืนยัน', 'Confirmed order') : c.event === 'checkout_started' ? text('เริ่มชำระเงิน', 'Checkout attempt') : text('เลือกสาขา', 'Branch selection')}</TD><TD><p className="break-all">{c.completeFrom}</p><p className="break-all">{c.completeThrough}</p></TD><TD><p className="break-all">{c.assertedAt}</p></TD><TD>{c.identityComplete ? text('ยืนยัน', 'Verified') : text('ยังยืนยันไม่ได้', 'Unknown')}</TD></TR>)}</TBody></Table></div>}<dl className="space-y-2 p-4 text-sm">{value.source.profileAsOf.map(p => <div key={p.branchId}><dt>{text('หลักฐานข้อมูลสาขา ณ', 'Branch profile evidence as of')} · {p.branchId}</dt><dd className="break-all">{p.asOf ?? text('ยังไม่มีหลักฐาน', 'Unavailable')}</dd></div>)}</dl></Panel>}
  </>;
}
