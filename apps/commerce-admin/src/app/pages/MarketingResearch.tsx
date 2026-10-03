import { FormEvent, Fragment, useState } from 'react';
import {
  marketingResearchApi, RESEARCH_AREAS, RESEARCH_KINDS, RESEARCH_SECTORS,
  ResearchKind, ResearchRun, ResearchTopic, ResearchTopicInput,
} from '../../lib/api';
import { useAsync, statusBadgeClass } from '../hooks';

const KIND_LABEL: Record<ResearchKind, string> = {
  sales: 'โอกาสขาย', competitor: 'คู่แข่ง', procurement: 'จัดซื้อ / วัตถุดิบ', trend: 'เทรนด์ตลาด',
};
const FREE = ['tat', 'osm'];
const blank: ResearchTopicInput = {
  title: '', kind: 'trend', area: RESEARCH_AREAS[0], days: 30, sector: RESEARCH_SECTORS[0], sources: ['tat', 'osm'], followHourly: false,
};

/** Marketing research (moved from josh web-admin). A worker collects evidence; this page asks and reads. */
export function MarketingResearch() {
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

  function submit(e: FormEvent) {
    e.preventDefault();
    act('create', () => marketingResearchApi.create(form), 'บันทึกโจทย์แล้ว').then(() => setForm(blank));
  }

  const ready = new Set((sources.data ?? []).filter((s) => s.ready).map((s) => s.id));
  const total = topics.data?.totalCount ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / 20));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Marketing Research</h1>
          <p>ค้นรายชื่อธุรกิจจริงจาก ททท. และ OpenStreetMap ฟรี พร้อมหลักฐานอ้างอิง · ผลค้นยังไม่ยืนยันความต้องการซื้อ ราคา หรือกระแสย้อนหลัง · Facebook, Instagram, Google, TikTok และ YouTube ยังไม่เชื่อม</p>
        </div>
        <button className="btn ghost" type="button" onClick={topics.reload}>Refresh</button>
      </div>

      {note && <div className={note.ok ? 'hint' : 'err'} role="status" style={{ marginBottom: 12 }}>{note.text}</div>}

      <form className="panel" onSubmit={submit}>
        <div className="panel-head">ตั้งโจทย์ใหม่</div>
        <div className="row" style={{ padding: 16, flexWrap: 'wrap', gap: 12 }}>
          <label className="field" style={{ flex: '2 1 280px' }}>หัวข้อ
            <input required maxLength={400} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="เช่น ร้านอาหารญี่ปุ่นเปิดใหม่ในกรุงเทพ" />
          </label>
          <label className="field">ประเภท
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ResearchKind })}>
              {RESEARCH_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="field">พื้นที่
            <select value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}>
              {RESEARCH_AREAS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          <label className="field">ย้อนหลัง
            <select value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}>
              {[7, 14, 30].map((d) => <option key={d} value={d}>{d} วัน</option>)}
            </select>
          </label>
          <label className="field">กลุ่มลูกค้า
            <select value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })}>
              {RESEARCH_SECTORS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <fieldset className="checks" style={{ border: 0, margin: 0, padding: '0 16px 12px' }}>
          <legend className="hint">แหล่งข้อมูล (สีเทา = ยังไม่เชื่อม) · ททท. และ OpenStreetMap ค้นได้ฟรี</legend>
          {(sources.data ?? []).map((s) => (
            <label key={s.id} className="check" title={s.ready ? '' : s.reason}>
              <input type="checkbox" checked={form.sources.includes(s.id)}
                onChange={(e) => setForm({ ...form, sources: e.target.checked ? [...form.sources, s.id] : form.sources.filter((x) => x !== s.id) })} />
              <span style={{ opacity: s.ready ? 1 : 0.55 }}>{s.id}</span>
            </label>
          ))}
          <label className="check">
            <input type="checkbox" checked={form.followHourly} onChange={(e) => setForm({ ...form, followHourly: e.target.checked })} />
            ติดตามทุกชั่วโมง
          </label>
        </fieldset>
        <div style={{ padding: '0 16px 16px' }}>
          <button className="btn" type="submit" disabled={busy === 'create' || !form.sources.length}>{busy === 'create' ? 'กำลังบันทึก…' : 'บันทึกโจทย์'}</button>
          {!form.sources.some((s) => ready.has(s)) && <span className="hint" style={{ marginLeft: 12 }}>ยังไม่มีแหล่งที่พร้อม — โจทย์จะรอจนกว่าแหล่งข้อมูลจะเชื่อม</span>}
        </div>
      </form>

      <section className="panel">
        <div className="panel-head">
          <span>โจทย์ทั้งหมด · {total}</span>
          <span>
            <button className="btn ghost sm" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>{' '}
            <span className="hint">{page} / {maxPage}</span>{' '}
            <button className="btn ghost sm" type="button" disabled={page >= maxPage} onClick={() => setPage(page + 1)}>ถัดไป</button>
          </span>
        </div>
        {topics.error && <div className="err" style={{ padding: 16 }}>{topics.error}</div>}
        {topics.loading ? <div className="empty">Loading…</div> : !topics.data?.items.length ? <div className="empty">ยังไม่มีโจทย์</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>หัวข้อ</th><th>ประเภท</th><th>พื้นที่ / ช่วง</th><th>แหล่ง</th><th>รอบถัดไป</th><th></th></tr></thead>
              <tbody>
                {topics.data.items.map((t) => (
                  <Fragment key={t.id}>
                    <tr>
                      <td>{t.title}{t.archivedAt && <span className="badge" style={{ marginLeft: 6 }}>archived</span>}</td>
                      <td>{KIND_LABEL[t.kind] ?? t.kind}</td>
                      <td>{t.area} · {t.days} วัน</td>
                      <td className="mono">{t.sources.join(', ')}</td>
                      <td>{t.nextRunAt ? new Date(t.nextRunAt).toLocaleString('th-TH') : '—'}</td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button className="btn ghost sm" type="button" onClick={() => toggleRuns(t)}>{open === t.id ? 'ซ่อน' : 'รายงาน'}</button>{' '}
                        {t.canManage && !t.archivedAt && <>
                          <button className="btn sm" type="button" disabled={busy === `run-${t.id}`} onClick={() => act(`run-${t.id}`, () => marketingResearchApi.requestRun(t.id), 'ส่งเข้าคิวแล้ว')}>รันตอนนี้</button>{' '}
                          {!t.sources.some((s) => FREE.includes(s)) && <><button className="btn ghost sm" type="button" disabled={busy === `free-${t.id}`}
                            onClick={() => act(`free-${t.id}`, async () => {
                              const { title, kind, area, days, sector, followHourly, sources } = t;
                              const updated = await marketingResearchApi.update(t, { title, kind, area, days, sector, followHourly, sources: [...sources, ...FREE] });
                              await marketingResearchApi.requestRun(updated.id);
                            }, 'เพิ่มแหล่งฟรีและส่งเข้าคิวแล้ว')}>เพิ่มแหล่งฟรีและรัน</button>{' '}</>}
                          <button className="btn ghost sm" type="button" disabled={busy === `arc-${t.id}`} onClick={() => act(`arc-${t.id}`, () => marketingResearchApi.archive(t), 'เก็บโจทย์แล้ว')}>เก็บ</button>
                        </>}
                      </td>
                    </tr>
                    {open === t.id && (
                      <tr><td colSpan={6}>
                        {!(runs[t.id] ?? []).length ? <div className="hint">ยังไม่มีการรัน</div> : (runs[t.id] ?? []).map((r) => (
                          <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                            <span className={statusBadgeClass(r.status)}>{r.status}</span>{' '}
                            <span className="hint">{new Date(r.createdAt).toLocaleString('th-TH')} · พบ {r.findingsCount} ข้อ</span>
                            {r.message && <div className="hint">{r.message}</div>}
                            {r.report?.summary && <p style={{ margin: '6px 0' }}>{r.report.summary}</p>}
                            {r.report?.findings?.length ? <ul style={{ margin: 0 }}>{r.report.findings.map((f, i) => <li key={i}>{f.text}</li>)}</ul> : null}
                            {r.report?.evidence?.length ? <details><summary className="hint">หลักฐาน {r.report.evidence.length} รายการ</summary>
                              <ul style={{ margin: 0 }}>{r.report.evidence.map((e) => <li key={e.id}><a href={e.url} target="_blank" rel="noopener noreferrer">{e.excerpt || e.url}</a> <span className="hint">· {e.source}</span></li>)}</ul></details> : null}
                            {r.report?.limitations?.map((l, i) => <div key={i} className="hint">ข้อจำกัด: {l}</div>)}
                            {r.report && !r.keptAt && <button className="btn ghost sm" type="button" onClick={() => act(`keep-${r.id}`, () => marketingResearchApi.keepRun(r.id), 'เก็บรายงานไว้แล้ว')}>เก็บรายงานนี้</button>}
                          </div>
                        ))}
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
