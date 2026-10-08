// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-caption-migration: literal captions only
// ui-metadata-migration: static labels and UI notices only
import { Fragment, useState } from 'react';
import { Alert, Button, ButtonLink, Checkbox, CodeBlock, Empty, ErrorText, ExpandRow, ExpandToggle, Field, FormPanel, Input, Loading, Page, PageHeader, Panel, PanelHead, Select, Span, Table, TBody, TD, TH, THead, TR, fmt } from '@cp/ui';
import {
  marketingResearchApi, RESEARCH_AREAS, RESEARCH_KINDS, RESEARCH_SECTORS,
  ResearchKind, ResearchRun, ResearchTopic, ResearchTopicInput,
} from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const KIND_LABEL: Record<ResearchKind, string> = {
  get sales(){return __uiText("โอกาสขาย");}, get competitor(){return __uiText("คู่แข่ง");}, get procurement(){return __uiText("จัดซื้อ / วัตถุดิบ");}, get trend(){return __uiText("เทรนด์ตลาด");},
};
const FREE = ['tat', 'osm'];
const blank: ResearchTopicInput = {
  title: '', kind: 'trend', area: RESEARCH_AREAS[0], days: 30, sector: RESEARCH_SECTORS[0], sources: ['tat', 'osm'], followHourly: false,
};

/** Marketing research (moved from josh web-admin). A worker collects evidence; this page asks and reads. */
export function MarketingResearch() {
  __useUiLocale();
  const [page, setPage] = useState(1);
  const topics = useAsync(() => marketingResearchApi.list(page, 20), [page]);
  const sources = useAsync(() => marketingResearchApi.sources(), []);
  const [form, setForm] = useState<ResearchTopicInput>(blank);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, ResearchRun[]>>({});

  async function act(key: string, work: () => Promise<unknown>, done: string) {
    setBusy(key); setNote(null);
    try { await work(); setNote({ ok: true, text: done }); topics.reload(); }
    catch (e) { setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }

  async function toggleRuns(topic: ResearchTopic) {
    if (open === topic.id) { setOpen(null); return; }
    setOpen(topic.id);
    try {
      const data = await marketingResearchApi.runs(topic.id);
      setRuns((r) => ({ ...r, [topic.id]: Array.isArray(data) ? data : data.items }));
    } catch (e) { setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
  }

  function submit() {
    act('create', () => marketingResearchApi.create(form), 'บันทึกโจทย์แล้ว').then(() => setForm(blank));
  }

  const ready = new Set((sources.data ?? []).filter((s) => s.ready).map((s) => s.id));
  const total = topics.data?.totalCount ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / 20));

  return (
    <Page>
      <PageHeader
        title={__uiText("Marketing Research")}
        subtitle={__uiText("ค้นรายชื่อธุรกิจจริงจาก ททท. และ OpenStreetMap ฟรี พร้อมหลักฐานอ้างอิง")}
        actions={<Button onClick={topics.reload} icon="refresh">{__uiText("Refresh")}</Button>}
      />

      {note && <Alert tone={note.ok ? 'ok' : 'danger'}>{note.text}</Alert>}

      <FormPanel
        title={__uiText("ตั้งโจทย์ใหม่")}
        icon="search"
        cols={3}
        busy={busy === 'create'}
        error={!form.sources.some((s) => ready.has(s)) ? __uiText("ยังไม่มีแหล่งที่พร้อม — โจทย์จะรอจนกว่าแหล่งข้อมูลจะเชื่อม") : undefined}
        onSubmit={submit}
        submitLabel={busy === 'create' ? __uiText("กำลังบันทึก…") : __uiText("บันทึกโจทย์")}
      >
        <Field label={__uiText("หัวข้อ")}>
          <Input required maxLength={400} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={__uiText("เช่น ร้านอาหารญี่ปุ่นเปิดใหม่ในกรุงเทพ")} />
        </Field>
        <Field label={__uiText("ประเภท")}>
          <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ResearchKind })}>
            {RESEARCH_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </Select>
        </Field>
        <Field label={__uiText("พื้นที่")}>
          <Select value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}>
            {RESEARCH_AREAS.map((a) => <option key={a}>{a}</option>)}
          </Select>
        </Field>
        <Field label={__uiText("ย้อนหลัง")}>
          <Select value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}>
            {[7, 14, 30].map((d) => <option key={d} value={d}>{d} {__uiText(" วัน")}</option>)}
          </Select>
        </Field>
        <Field label={__uiText("กลุ่มลูกค้า")}>
          <Select value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })}>
            {RESEARCH_SECTORS.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Field>
        <Span className="flex flex-wrap gap-2">
          <div className="text-xs text-on-surface-variant">{__uiText("แหล่งข้อมูล (สีเทา = ยังไม่เชื่อม)")}</div>
          {(sources.data ?? []).map((s) => (
            <Checkbox key={s.id} label={s.id} title={s.ready ? '' : s.reason} checked={form.sources.includes(s.id)}
              onChange={(e) => setForm({ ...form, sources: e.target.checked ? [...form.sources, s.id] : form.sources.filter((x) => x !== s.id) })}
              className={!s.ready ? 'opacity-50' : ''} />
          ))}
          <Checkbox label={__uiText("ติดตามทุกชั่วโมง")} checked={form.followHourly} onChange={(e) => setForm({ ...form, followHourly: e.target.checked })} />
        </Span>
      </FormPanel>

      <Panel className="overflow-hidden">
        <PanelHead
          title={__uiText("โจทย์ทั้งหมด")}
          sub={__uiText("{0} โจทย์",{'0':fmt.num(total)})}
          actions={
            <div className="flex items-center gap-2 text-xs">
              <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{__uiText("ก่อนหน้า")}</Button>
              <span className="text-on-surface-variant font-mono">{page} / {maxPage}</span>
              <Button variant="ghost" size="sm" disabled={page >= maxPage} onClick={() => setPage(page + 1)}>{__uiText("ถัดไป")}</Button>
            </div>
          }
        />
        <ErrorText error={topics.error} />
        {topics.loading ? (
          <Loading />
        ) : !topics.data?.items.length ? (
          <Empty icon="search">{__uiText("ยังไม่มีโจทย์")}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText("หัวข้อ")}</TH>
              <TH>{__uiText("ประเภท")}</TH>
              <TH>{__uiText("พื้นที่ / ช่วง")}</TH>
              <TH>{__uiText("แหล่ง")}</TH>
              <TH>{__uiText("รอบถัดไป")}</TH>
              <TH className="w-32" />
            </THead>
            <TBody>
              {topics.data.items.map((t) => (
                <Fragment key={t.id}>
                  <TR>
                    <TD>
                      <div className="font-medium">{t.title}</div>
                      {t.archivedAt && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-surface-container text-on-surface-variant mt-1">{__uiText("archived")}</span>}
                    </TD>
                    <TD kind="muted">{KIND_LABEL[t.kind] ?? t.kind}</TD>
                    <TD kind="muted">{t.area} · {t.days} {__uiText(" วัน")}</TD>
                    <TD kind="mono">{t.sources.join(', ')}</TD>
                    <TD kind="time">{t.nextRunAt ? new Date(t.nextRunAt).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')) : '—'}</TD>
                    <TD className="text-right space-x-1">
                      <ExpandToggle open={open === t.id} onClick={() => toggleRuns(t)} label={__uiText("รายงาน")} />
                      {t.canManage && !t.archivedAt && (
                        <>
                          <Button variant="ghost" size="sm" disabled={busy === `run-${t.id}`} onClick={() => act(`run-${t.id}`, () => marketingResearchApi.requestRun(t.id), 'ส่งเข้าคิวแล้ว')}>{__uiText("รันตอนนี้")}</Button>
                          {!t.sources.some((s) => FREE.includes(s)) && <Button variant="ghost" size="sm" disabled={busy === `free-${t.id}`}
                            onClick={() => act(`free-${t.id}`, async () => {
                              const { title, kind, area, days, sector, followHourly, sources } = t;
                              const updated = await marketingResearchApi.update(t, { title, kind, area, days, sector, followHourly, sources: [...sources, ...FREE] });
                              await marketingResearchApi.requestRun(updated.id);
                            }, 'เพิ่มแหล่งฟรีและส่งเข้าคิวแล้ว')}>{__uiText("เพิ่มแหล่งฟรี")}</Button>}
                          <Button variant="danger-ghost" size="sm" disabled={busy === `arc-${t.id}`} onClick={() => act(`arc-${t.id}`, () => marketingResearchApi.archive(t), 'เก็บโจทย์แล้ว')}>{__uiText("เก็บ")}</Button>
                        </>
                      )}
                    </TD>
                  </TR>
                  {open === t.id && (
                    <ExpandRow colSpan={6}>
                      {!(runs[t.id] ?? []).length ? (
                        <div className="text-xs text-on-surface-variant">{__uiText("ยังไม่มีการรัน")}</div>
                      ) : (
                        <div className="space-y-4">
                          {(runs[t.id] ?? []).map((r) => (
                            <div key={r.id} className="border-b border-secondary-container/70 pb-4 last:border-0">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-surface-container text-on-surface">{r.status}</span>
                                <span className="text-xs text-on-surface-variant">{new Date(r.createdAt).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'))} {__uiText(" · พบ ")}{fmt.num(r.findingsCount)} {__uiText(" ข้อ")}</span>
                              </div>
                              {r.message && <div className="text-xs text-on-surface-variant mb-2">{r.message}</div>}
                              {r.report?.summary && <p className="text-xs text-on-surface mb-2">{r.report.summary}</p>}
                              {r.report?.findings?.length ? (
                                <ul className="text-xs space-y-1 mb-2 list-disc list-inside">
                                  {r.report.findings.map((f, i) => <li key={i} className="text-on-surface">{f.text}</li>)}
                                </ul>
                              ) : null}
                              {r.report?.evidence?.length ? (
                                <details className="mb-2">
                                  <summary className="text-xs text-primary cursor-pointer hover:underline">{__uiText("หลักฐาน ")}{r.report.evidence.length} {__uiText(" รายการ")}</summary>
                                  <ul className="text-xs space-y-1 mt-1 list-disc list-inside">
                                    {r.report.evidence.map((e) => (
                                      <li key={e.id} className="text-on-surface">
                                        <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{e.excerpt || e.url}</a> <span className="text-on-surface-variant">· {e.source}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              ) : null}
                              {r.report?.limitations?.map((l, i) => <div key={i} className="text-xs text-on-surface-variant mb-1">{__uiText("ข้อจำกัด: ")}{l}</div>)}
                              {!!r.report?.evidence?.length && <div className="my-2"><ButtonLink to={`/marketing/growth/plans/new?${new URLSearchParams({ template: 'market', topicId: t.id, runId: r.id, title: t.title, goal: r.report.summary ?? '' })}`} icon="edit_note">{__uiText("ร่างแผน Growth จากหลักฐานนี้")}</ButtonLink></div>}
                              {r.report?.analysis ? (
                                <div className="text-xs mb-2 rounded bg-surface-container p-2">
                                  <div className="font-semibold mb-1">{__uiText("สรุปด้วย AI · ")}{{ queued: 'รอคิว', running: 'กำลังสรุป', completed: 'เสร็จแล้ว', not_configured: 'ยังไม่ได้ตั้งค่า AI', unavailable: 'AI ใช้งานไม่ได้ตอนนี้', insufficient_data: 'หลักฐานไม่พอ' }[r.report.analysis.status]}</div>
                                  {r.report.analysis.summary && <p className="text-on-surface mb-1">{r.report.analysis.summary}</p>}
                                  {r.report.analysis.findings.map((f, i) => <div key={i} className="text-on-surface">• {f.text}</div>)}
                                  {r.report.analysis.reason && r.report.analysis.status !== 'completed' && <div className="text-on-surface-variant">{r.report.analysis.reason}</div>}
                                </div>
                              ) : ['completed', 'partial'].includes(r.status) && !!r.report?.evidence?.length && (
                                <Button variant="ghost" size="sm" disabled={busy === `ai-${r.id}`} onClick={() => act(`ai-${r.id}`, async () => {
                                  const run = await marketingResearchApi.summarize(r.id);
                                  setRuns((all) => ({ ...all, [t.id]: (all[t.id] ?? []).map((x) => (x.id === run.id ? run : x)) }));
                                }, 'ส่งให้ AI สรุปแล้ว — กดเปิดรอบนี้อีกครั้งเพื่อดูผล')}>{__uiText("สรุปด้วย AI")}</Button>
                              )}
                              {r.report && !r.keptAt && <Button variant="ghost" size="sm" disabled={busy === `keep-${r.id}`} onClick={() => act(`keep-${r.id}`, () => marketingResearchApi.keepRun(r.id), 'เก็บรายงานไว้แล้ว')}>{__uiText("เก็บรายงานนี้")}</Button>}
                            </div>
                          ))}
                        </div>
                      )}
                    </ExpandRow>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </Page>
  );
}
