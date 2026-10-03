import { FormEvent, useState } from 'react';
import { scrapingApi, ScrapingSource } from '../../lib/api';
import { useAsync } from '../hooks';

const STATUS: Record<ScrapingSource['status'], string> = {
  idle: 'ยังไม่ได้เก็บ', running: 'กำลังเก็บ', paused: 'พักการเก็บ', completed: 'เก็บครบลิงก์ที่พบ', limited: 'เก็บบางส่วน / ถึงเพดาน',
};
const INTERVALS = [{ h: 24, label: 'วันละครั้ง' }, { h: 168, label: 'สัปดาห์ละครั้ง' }, { h: 720, label: 'เดือนละครั้ง' }];

interface Discovery { ready: boolean; proposal: Pick<ScrapingSource, 'name' | 'origin' | 'enabled' | 'config'> | null; warnings?: string[] }

/** Competitor web sources (moved from josh). The crawler runs here, never on josh's API servers. */
export function ScrapingSources() {
  const sources = useAsync(() => scrapingApi.sources(), []);
  const [website, setWebsite] = useState('');
  const [allowed, setAllowed] = useState(false);
  const [found, setFound] = useState<Discovery | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function act(key: string, work: () => Promise<unknown>, done: string) {
    setBusy(key); setNote(null);
    try { await work(); setNote({ ok: true, text: done }); sources.reload(); return true; }
    catch (e) { setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }); return false; }
    finally { setBusy(null); }
  }

  async function discover(e: FormEvent) {
    e.preventDefault();
    setFound(null);
    await act('discover', async () => setFound(await scrapingApi.discover(website, allowed) as Discovery), 'ตรวจเว็บเสร็จ');
  }

  const update = (s: ScrapingSource, patch: Partial<Pick<ScrapingSource, 'enabled' | 'config'>>) =>
    act(`save-${s.id}`, () => scrapingApi.save({ name: s.name, origin: s.origin, enabled: patch.enabled ?? s.enabled, config: patch.config ?? s.config, revision: s.revision }, s.id), 'บันทึกแล้ว');

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>ตั้งค่าเก็บข้อมูลเว็บ</h1>
          <p>เว็บคู่แข่งที่เก็บราคาอัตโนมัติ · ตัวเก็บข้อมูลทำงานที่ commerce ไม่แย่งเครื่องของ shop</p>
        </div>
        <button className="btn ghost" type="button" onClick={sources.reload}>Refresh</button>
      </div>

      {note && <div className={note.ok ? 'hint' : 'err'} role="status" style={{ marginBottom: 12 }}>{note.text}</div>}

      <form className="panel" onSubmit={discover}>
        <div className="panel-head">เพิ่มเว็บ</div>
        <div className="row" style={{ padding: 16, gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '1 1 260px' }}>ชื่อเว็บหรือโดเมน
            <input required value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="เช่น Makro, Big C หรือ example.com" />
          </label>
          <label className="check"><input type="checkbox" checked={allowed} onChange={(e) => setAllowed(e.target.checked)} /> ยืนยันว่าได้รับอนุญาตให้เก็บข้อมูลสาธารณะจากเว็บนี้</label>
          <button className="btn" type="submit" disabled={busy === 'discover'}>{busy === 'discover' ? 'กำลังตรวจเว็บ… (อาจใช้ 1–2 นาที)' : 'ตรวจเว็บ'}</button>
        </div>
        {found && (
          <div style={{ padding: '0 16px 16px' }}>
            {found.warnings?.map((w) => <div key={w} className="hint">• {w}</div>)}
            {found.ready && found.proposal ? (
              <button className="btn" type="button" disabled={busy === 'add'}
                onClick={() => act('add', () => scrapingApi.save({ ...found.proposal!, config: { ...found.proposal!.config, intervalHours: 168 } }), 'เพิ่มเว็บแล้ว').then((ok) => ok && setFound(null))}>
                เพิ่ม {found.proposal.name} (เก็บสัปดาห์ละครั้ง)
              </button>
            ) : <div className="err">ยังเก็บข้อมูลจากเว็บนี้ไม่ได้ — ดูหมายเหตุข้างบน</div>}
          </div>
        )}
      </form>

      <section className="panel">
        <div className="panel-head">เว็บที่ตั้งไว้</div>
        {sources.error && <div className="err" style={{ padding: 16 }}>{sources.error}</div>}
        {sources.loading ? <div className="empty">Loading…</div> : !sources.data?.length ? <div className="empty">ยังไม่มีเว็บ</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>เว็บ</th><th>สถานะ</th><th>ความคืบหน้า</th><th>รอบอัตโนมัติ</th><th>ล่าสุด</th><th></th></tr></thead>
              <tbody>
                {sources.data.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong><div className="hint mono">{s.origin}</div>{s.lastError && <div className="err">{s.lastError}</div>}</td>
                    <td><span className={s.status === 'running' ? 'badge ok' : 'badge'}>{STATUS[s.status] ?? s.status}</span></td>
                    <td className="hint">{s.progress.items} สินค้า · สำเร็จ {s.progress.successful} · พลาด {s.progress.failed}</td>
                    <td>
                      <label className="check"><input type="checkbox" checked={s.enabled} onChange={(e) => update(s, { enabled: e.target.checked })} /> อัตโนมัติ</label>
                      <select aria-label={`รอบเก็บของ ${s.name}`} value={s.config.intervalHours} onChange={(e) => update(s, { config: { ...s.config, intervalHours: Number(e.target.value) } })}>
                        {[...INTERVALS, ...(INTERVALS.some((i) => i.h === s.config.intervalHours) ? [] : [{ h: s.config.intervalHours, label: `ทุก ${s.config.intervalHours} ชม.` }])].map((i) => <option key={i.h} value={i.h}>{i.label}</option>)}
                      </select>
                    </td>
                    <td>{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString('th-TH') : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {s.status === 'running'
                        ? <button className="btn ghost sm" type="button" disabled={busy === `stop-${s.id}`} onClick={() => act(`stop-${s.id}`, () => scrapingApi.stop(s), 'หยุดแล้ว')}>หยุด</button>
                        : <button className="btn sm" type="button" disabled={busy === `start-${s.id}`} onClick={() => act(`start-${s.id}`, () => scrapingApi.start(s), 'เริ่มเก็บแล้ว')}>เก็บตอนนี้</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
