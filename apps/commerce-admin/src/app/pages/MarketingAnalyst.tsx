import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { GrowthPlan, MarketAnalysisInput, MarketAnalysisReport } from '@cp/growth';
import { Alert, Button, ButtonLink, Chip, Empty, Field, Input, Page, PageHeader, Panel, PanelHead, Select, Textarea, fmt } from '@cp/ui';
import { api, session } from '../../lib/api';
import { useAsync } from '../hooks';
import { Evidence, LoadState } from './growth/shared';

const prompts = [
  { label: 'เทรนด์อาหาร / B2B', question: 'หาเทรนด์ช่วงนี้ในตลาดอาหาร B2B ที่เข้ากับสินค้าและลูกค้าของร้าน พร้อมแนะนำสิ่งที่ควรทำต่อ' },
  { label: 'GTM / ค้นหาไม่เจอ', question: 'จาก GTM funnel และคำค้นที่ไม่พบสินค้า เทียบกับเทรนด์ช่วงนี้ เราควรแก้จุดไหนก่อน?' },
  { label: 'โอกาสทำแผนเฉพาะบุคคล', question: 'จากพฤติกรรมดูสินค้า ค้นหาและตะกร้า กลุ่มไหนควรทำแผนเฉพาะบุคคล?' },
];
type ReportActions = {
  busy: string | null;
  draftError: { reportId: string; message: string } | null;
  onDraft: (report: MarketAnalysisReport, recommendationId: string) => void;
};

function Citations({ ids }: { ids: string[] }) {
  return <p className="text-xs text-on-surface-variant break-all">หลักฐาน: {ids.length ? ids.join(', ') : 'ยังไม่มีหลักฐานอ้างอิง'}</p>;
}

function AnalystReport({ report, busy, draftError, onDraft }: { report: MarketAnalysisReport } & ReportActions) {
  return <div className="space-y-4 min-w-0 break-words">
    <Panel><PanelHead title="รายงานวิเคราะห์" icon="insights" />
      <div className="p-4 space-y-3">
        <p className="text-xs text-on-surface-variant">{report.area} · ย้อนหลัง {report.days} วัน · สร้างเมื่อ {fmt.when(report.createdAt)}</p>
        <p className="text-sm font-semibold">{report.question}</p>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{report.summary}</p>
        {report.limitations.length > 0 && <Alert tone="warn" title="ข้อจำกัดของรายงาน"><ul className="list-disc pl-4 space-y-1">{report.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></Alert>}
        <details><summary className="cursor-pointer text-sm font-semibold">ข้อเท็จจริงและสมมติฐาน {report.findings.length} รายการ</summary><div className="mt-3">
          {!report.findings.length ? <Empty>ยังไม่มีข้อค้นพบที่ยืนยันได้</Empty> : <div className="space-y-4">{report.findings.map((finding, index) => <article key={index} className="space-y-2">
            <Chip tone={finding.kind === 'fact' ? 'ok' : 'warn'}>{finding.kind === 'fact' ? 'ข้อเท็จจริง' : 'สมมติฐาน · ต้องตรวจเพิ่ม'}</Chip>
            <h3 className="text-sm font-semibold">{finding.title}</h3><p className="text-sm whitespace-pre-wrap">{finding.detail}</p><Citations ids={finding.evidenceIds} />
          </article>)}</div>}
        </div></details>
      </div>
    </Panel>
    <Panel><PanelHead title="สิ่งที่ควรทำต่อ" icon="lightbulb" />
      {!report.recommendations.length ? <Empty>ข้อมูลยังไม่พอแนะนำแผน · ตรวจข้อจำกัดและแหล่งข้อมูลก่อน</Empty> : <div className="divide-y divide-secondary-container">{report.recommendations.map((recommendation) => <article key={recommendation.id} className="p-4 space-y-3">
        <h3 className="text-sm font-semibold">{recommendation.title}</h3><p className="text-sm whitespace-pre-wrap">{recommendation.why}</p>
        <dl className="space-y-2 text-sm"><div><dt className="font-semibold">เริ่มจาก</dt><dd className="whitespace-pre-wrap">{recommendation.nextStep}</dd></div><div><dt className="font-semibold">วัดผลด้วย</dt><dd>{recommendation.successMetric}</dd></div><div><dt className="font-semibold">สินค้าที่เกี่ยวข้อง</dt><dd>{recommendation.productSkus.length ? recommendation.productSkus.join(', ') : 'ยังไม่ยืนยัน SKU'}</dd></div></dl>
        <Citations ids={recommendation.evidenceIds} />
        <Button icon="edit_note" variant="primary" className="min-h-11" disabled={!!busy} onClick={() => onDraft(report, recommendation.id)}>{busy === `plan:${recommendation.id}` ? 'กำลังสร้างร่าง…' : 'สร้างแผนร่าง'}</Button>
      </article>)}</div>}
      <p className="px-4 pb-4 text-xs text-on-surface-variant">แผนร่างจะเปิดให้ทีมแก้และตรวจ ก่อนลงมือทำ</p>
      {draftError?.reportId === report.id && <div className="px-4 pb-4" role="alert"><Alert tone="danger" title="สร้างแผนร่างไม่สำเร็จ">{draftError.message} · ลองกดสร้างแผนร่างอีกครั้ง</Alert></div>}
    </Panel>
    <Panel><PanelHead title="ตรวจข้อมูลต้นทาง" icon="manage_search" /><div className="p-4 space-y-3">
      <details><summary className="cursor-pointer text-sm font-semibold">หลักฐาน {report.evidence.length} รายการ</summary><div className="mt-3"><Evidence items={report.evidence} /></div></details>
      <details><summary className="cursor-pointer text-sm font-semibold">ข้อมูลที่ AI อ่าน {report.trace.length} รายการ</summary><div className="mt-3">
        {!report.trace.length ? <Empty>ยังไม่มีบันทึกการอ่านข้อมูล</Empty> : <ul className="space-y-3">{report.trace.map((item, index) => <li key={index} className="space-y-1">
          <div className="flex flex-wrap gap-2 items-center"><Chip tone={item.status === 'read' ? 'ok' : 'warn'}>{item.status === 'read' ? 'อ่านแล้ว' : 'อ่านไม่ได้'}</Chip><span className="font-mono text-xs break-all">{item.tool}</span></div><p className="text-sm">{item.detail}</p>
        </li>)}</ul>}
      </div></details>
    </div></Panel>
  </div>;
}

function SavedReport({ id, ...actions }: { id: string } & ReportActions) {
  const state = useAsync(() => api.get<MarketAnalysisReport>(`/marketing-analyst/reports/${encodeURIComponent(id)}`));
  return <><LoadState state={state} />{!state.loading && !state.error && state.data && <AnalystReport report={state.data} {...actions} />}</>;
}

export default function MarketingAnalyst() {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const reportId = search.get('report');
  const readiness = useAsync(() => api.get<{ configured: boolean; modelConfigured: boolean; limitations: string[] }>('/marketing-analyst/readiness'));
  const history = useAsync(() => api.get<{ items: MarketAnalysisReport[] }>('/marketing-analyst/reports'));
  const [input, setInput] = useState<MarketAnalysisInput>({ question: 'หาเทรนด์ช่วงนี้', area: 'กรุงเทพฯ', days: 14 });
  const [report, setReport] = useState<MarketAnalysisReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const analysisRequest = useRef<{ key: string; id: string } | null>(null);
  const draftRequests = useRef(new Map<string, string>());
  const [error, setError] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<ReportActions['draftError']>(null);
  const ready = !readiness.loading && !readiness.error && readiness.data?.configured && readiness.data.modelConfigured;

  async function analyze() {
    if (inFlight.current || !ready || !input.question.trim() || !input.area.trim()) return;
    const payload = { ...input, question: input.question.trim(), area: input.area.trim() };
    const key = JSON.stringify(payload);
    if (analysisRequest.current?.key !== key) analysisRequest.current = { key, id: crypto.randomUUID() };
    const storageKey = `cp_analyst_pending_request:${session.claims()?.sub ?? session.claims()?.email ?? 'staff'}`;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      if (saved?.key === key && typeof saved.id === 'string' && /^[\da-f-]{36}$/i.test(saved.id)) analysisRequest.current.id = saved.id;
      sessionStorage.setItem(storageKey, JSON.stringify(analysisRequest.current));
    } catch { /* Keep retry identity in memory when storage is unavailable. */ }
    const requestId = analysisRequest.current.id;
    inFlight.current = true; setBusy('analysis'); setError(null);
    try {
      const next = await api.post<MarketAnalysisReport>('/marketing-analyst/reports', { ...payload, requestId });
      analysisRequest.current = null;
      try { if (JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')?.id === requestId) sessionStorage.removeItem(storageKey); } catch { /* Storage may be unavailable. */ }
      if (!mounted.current) return;
      setReport(next); setSearch({ report: next.id }); history.reload();
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally { inFlight.current = false; if (mounted.current) setBusy(null); }
  }

  async function createDraft(selected: MarketAnalysisReport, recommendationId: string) {
    if (inFlight.current) return;
    const key = `${selected.id}:${recommendationId}`;
    if (!draftRequests.current.has(key)) draftRequests.current.set(key, crypto.randomUUID());
    inFlight.current = true; setBusy(`plan:${recommendationId}`); setDraftError(null);
    try {
      const plan = await api.post<GrowthPlan>(`/marketing-analyst/reports/${encodeURIComponent(selected.id)}/plan`, { recommendationId, requestId: draftRequests.current.get(key) });
      if (mounted.current) navigate(`/marketing/growth/plans/${encodeURIComponent(plan.id)}`);
    } catch (failure) {
      if (mounted.current) setDraftError({ reportId: selected.id, message: failure instanceof Error ? failure.message : String(failure) });
    } finally { inFlight.current = false; if (mounted.current) setBusy(null); }
  }

  const actions = { busy, draftError, onDraft: createDraft };
  return <Page>
    <PageHeader crumbs={['Marketing', 'Analyst']} title="Marketing Analyst" subtitle="ถามเรื่องตลาดหรือพฤติกรรมลูกค้า ให้ AI อ่านข้อมูลร้านและหลักฐานเว็บ แล้วแนะนำสิ่งที่ควรทำ" actions={<ButtonLink to="/marketing/growth/plans" icon="calendar_month">แผน Growth</ButtonLink>} />
    <Panel as="form" onSubmit={(event) => { event.preventDefault(); void analyze(); }}><PanelHead title="อยากรู้อะไรเกี่ยวกับร้าน?" icon="query_stats" />
      <div className="p-4 space-y-4">
        <Field label="คำถาม" hint="ระบุสิ่งที่อยากตัดสินใจ · ไม่เกิน 2,000 ตัวอักษร"><Textarea aria-label="คำถาม" rows={3} className="font-sans text-sm" required maxLength={2000} disabled={!!busy} value={input.question} onChange={(event) => setInput({ ...input, question: event.target.value })} /></Field>
        <div className="flex flex-wrap gap-2">{prompts.map((prompt) => <Button key={prompt.label} className="min-h-11 whitespace-normal text-left" disabled={!!busy} onClick={() => setInput({ ...input, question: prompt.question })}>{prompt.label}</Button>)}</div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="พื้นที่"><Input className="min-h-11 text-sm" required maxLength={200} disabled={!!busy} value={input.area} onChange={(event) => setInput({ ...input, area: event.target.value })} /></Field><Field label="ช่วงข้อมูล"><Select aria-label="ช่วงข้อมูล" className="min-h-11 text-sm" disabled={!!busy} value={input.days} onChange={(event) => setInput({ ...input, days: Number(event.target.value) })}>{[7, 14, 30].map((days) => <option key={days} value={days}>ย้อนหลัง {days} วัน</option>)}</Select></Field></div>
        <LoadState state={readiness} />
        {!readiness.loading && !readiness.error && readiness.data && <>
          {!ready && <Alert tone="warn" title="ยังไม่พร้อมวิเคราะห์">ยังไม่ได้ตั้งค่า AI หรือโมเดล ให้ผู้ดูแลตรวจการเชื่อมต่อ แล้วกดตรวจความพร้อมอีกครั้ง</Alert>}
          {readiness.data.limitations.length > 0 && <ul className="list-disc pl-4 text-xs text-on-surface-variant space-y-1">{readiness.data.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>}
        </>}
        {error && <div role="alert"><Alert tone="danger" title="วิเคราะห์ไม่สำเร็จ">{error} · กดวิเคราะห์อีกครั้งเพื่อใช้คำขอเดิม</Alert></div>}
        <div className="flex flex-wrap items-center gap-3"><Button type="submit" variant="primary" icon="search" className="min-h-11" disabled={!!busy || !ready || !input.question.trim() || !input.area.trim()}>{busy === 'analysis' ? 'กำลังวิเคราะห์…' : 'วิเคราะห์'}</Button><Button className="min-h-11" icon="refresh" disabled={!!busy || readiness.loading} onClick={readiness.reload}>ตรวจความพร้อม</Button></div>
        {busy === 'analysis' && <p role="status" className="text-sm text-on-surface-variant">กำลังอ่านข้อมูลร้านและค้นหลักฐานเว็บ อาจใช้เวลาถึง 3 นาที</p>}
      </div>
    </Panel>
    <Panel><PanelHead title="รายงานล่าสุดของคุณ" icon="history" actions={<Button icon="refresh" disabled={!!busy || history.loading} onClick={history.reload}>โหลดรายงานล่าสุด</Button>} /><div className="p-4 space-y-2">
      <LoadState state={history} />
      {!history.loading && !history.error && history.data && (!history.data.items.length ? <p className="text-sm text-on-surface-variant">ยังไม่มีรายงาน เริ่มจากคำถามด้านบน</p> : <Field label="เปิดรายงาน"><Select aria-label="เปิดรายงาน" className="min-h-11 text-sm" value={reportId ?? ''} disabled={!!busy} onChange={(event) => setSearch(event.target.value ? { report: event.target.value } : {})}><option value="">เลือกรายงานเพื่ออ่าน</option>{reportId && !history.data.items.some((item) => item.id === reportId) && <option value={reportId}>รายงานที่เปิดอยู่</option>}{history.data.items.map((item) => <option key={item.id} value={item.id}>{fmt.when(item.createdAt)} · {item.question}</option>)}</Select></Field>)}
    </div></Panel>
    {reportId ? report?.id === reportId ? <AnalystReport report={report} {...actions} /> : <SavedReport key={reportId} id={reportId} {...actions} /> : <Empty icon="insights">ผลวิเคราะห์จะแสดงที่นี่ พร้อมหลักฐานและขั้นตอนถัดไป</Empty>}
  </Page>;
}
