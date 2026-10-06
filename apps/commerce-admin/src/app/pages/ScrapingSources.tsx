import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Button, Checkbox, DetailSection, Empty, ErrorText, Field, Icon, Input, KeyValueGrid, Loading, Page,
  PageHeader, Panel, PanelHead, Select, Textarea, fmt, FormPanel,
} from '@cp/ui';
import { scrapingApi, type ScrapingAutomation, type ScrapingConfig, type ScrapingDiscovery, type ScrapingLogin,
  type ScrapingPreview, type ScrapingSource, type ScrapingSourceInput } from '../../lib/api';

export const scrapingError = (error: unknown) => {
  const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(message) ? message.join(', ') : message || (error instanceof Error ? error.message : 'ทำรายการไม่สำเร็จ กรุณาลองใหม่');
};

const defaults: ScrapingSourceInput = { name: '', origin: '', enabled: false, config: { startUrls: [], pathPrefixes: ['/'],
  mode: 'html', itemSelector: '', fields: [], currency: 'THB', vatIncluded: false, priceContext: 'ข้อมูลสาธารณะ ไม่ใช้บัญชีสมาชิก',
  collectionAllowed: false, intervalHours: 24, maxPages: 100, delayMs: 2000 } };
const statuses: Record<ScrapingSource['status'], string> = { idle: 'ยังไม่ได้เก็บ', running: 'กำลังเก็บ', paused: 'พักการเก็บ', completed: 'เก็บครบลิงก์ที่พบในขอบเขต', limited: 'เก็บบางส่วน / ถึงเพดาน' };

export function ScrapingSources() {
  const navigate = useNavigate();
  const [sources, setSources] = useState<ScrapingSource[]>([]);
  const [form, setForm] = useState<ScrapingSourceInput | null>(null);
  const [editId, setEditId] = useState<string>();
  const [seeds, setSeeds] = useState('');
  const [paths, setPaths] = useState('/');
  const [sample, setSample] = useState('');
  const [preview, setPreview] = useState<ScrapingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [website, setWebsite] = useState('');
  const [allowed, setAllowed] = useState(false);
  const [discovery, setDiscovery] = useState<ScrapingDiscovery | null>(null);
  const [started, setStarted] = useState('');
  const [vatChoice, setVatChoice] = useState<'included' | 'unsure' | null>(null);
  const [login, setLogin] = useState<ScrapingLogin>({ url: '', username: '', password: '' });
  const [loginEdit, setLoginEdit] = useState<{ sourceId: string; value: ScrapingLogin } | null>(null);
  const [automation, setAutomation] = useState<ScrapingAutomation | null>(null);

  const loginReady = !!(login.url.trim() && login.username.trim() && login.password);

  const load = useCallback(async () => {
    try {
      const [list, switchState] = await Promise.all([scrapingApi.sources(), scrapingApi.automation()]);
      setSources(list);
      setAutomation(switchState);
    } catch (err) {
      setError(scrapingError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const running = sources.some(source => source.activity === 'reading' || source.activity === 'queued' || source.activity === 'retrying');
  useEffect(() => { if (running) { const timer = setInterval(() => void load(), 5000); return () => clearInterval(timer); } }, [running, load]);

  function edit(source?: ScrapingSource) {
    setDiscovery(null);
    setEditId(source?.id);
    setForm(source ? structuredClone(source) : structuredClone(defaults));
    setSeeds(source?.config.startUrls.join('\n') || '');
    setPaths(source?.config.pathPrefixes.join('\n') || '/');
    setSample(source?.config.startUrls[0] || '');
    setPreview(null);
    setError('');
  }

  async function discover() {
    setForm(null);
    setEditId(undefined);
    setDiscovery(null);
    setPreview(null);
    setStarted('');
    setVatChoice(null);
    await action(async () => {
      const result = await scrapingApi.discover(website, allowed, loginReady ? login : undefined);
      setDiscovery(result);
      if (result.proposal) {
        const existing = sources.find(source => source.origin === result.proposal!.origin);
        setEditId(existing?.id);
        setForm({ ...result.proposal, enabled: true, ...(existing ? { revision: existing.revision } : {}) });
        setSeeds(result.proposal.config.startUrls.join('\n'));
        setPaths(result.proposal.config.pathPrefixes.join('\n'));
        setSample(result.preview?.url || '');
        setPreview(result.preview);
      }
    });
  }

  function selectField(key: string, checked: boolean) {
    if (!form) return;
    const selected = new Set(form.config.selectedFields || []);
    if (checked) selected.add(key);
    else selected.delete(key);
    config({ selectedFields: [...selected] });
  }

  function config(change: Partial<ScrapingConfig>) {
    if (form) {
      if (change.fields) setDiscovery(null);
      setForm({ ...form, config: { ...form.config, ...change, ...(change.fields ? { selectedFields: undefined } : {}) } });
      setPreview(null);
    }
  }

  function input(): ScrapingSourceInput {
    return { ...form!, config: { ...form!.config,
      startUrls: seeds.split('\n').map(s => s.trim()).filter(Boolean),
      pathPrefixes: paths.split('\n').map(s => s.trim()).filter(Boolean) } };
  }

  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError(scrapingError(err));
    } finally {
      await load();
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void action(async () => { await scrapingApi.save(input(), editId); setForm(null); });
  }

  function saveAndStart() {
    void action(async () => {
      let saved = await scrapingApi.save(input(), editId);
      setEditId(saved.id);
      setForm({ ...saved });
      if (loginReady) saved = await scrapingApi.saveLogin(saved.id, login);
      await scrapingApi.start(saved, true);
      setLogin({ url: '', username: '', password: '' });
      setForm(null);
      setDiscovery(null);
      setStarted(saved.config.nightOnly ? `ตั้งค่า ${saved.name} แล้ว — จะเก็บช่วง 00:00–06:00 เบื้องหลัง ดูความคืบหน้าด้านล่าง` : `เริ่มเก็บ ${saved.name} แล้ว — ระบบทำงานเบื้องหลัง ดูความคืบหน้าด้านล่าง`);
    });
  }

  const picked = (key: string) => !!discovery?.fields.find(field => field.key === key)?.required || !!form?.config.selectedFields?.includes(key);
  const columns = discovery?.fields.filter(field => field.key !== 'url' && picked(field.key)) || [];

  return (
    <Page>
      <PageHeader
        title="ตั้งค่าเก็บข้อมูลจากเว็บ"
        subtitle="กำหนดหน้าที่เก็บและฟิลด์เองได้"
        actions={<Button icon="add" onClick={() => edit()}>ตั้งค่าเองแบบละเอียด</Button>}
      />

      {automation && (
        <Alert tone={automation.enabled ? 'ok' : 'warn'}>
          <strong>การเก็บข้อมูลเบื้องหลัง: {automation.enabled ? 'เปิดอยู่' : 'ปิดอยู่'}</strong>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant={automation.enabled ? 'ghost' : 'primary'}
              disabled={busy}
              onClick={() => {
                if (!automation.enabled || window.confirm('ปิดการเก็บข้อมูลเบื้องหลังทุกเว็บ?'))
                  void action(async () => setAutomation(await scrapingApi.setAutomation(!automation.enabled)));
              }}
            >
              {automation.enabled ? 'ปิด' : 'เปิด'}
            </Button>
          </div>
        </Alert>
      )}

      <ErrorText error={error} />

      <Panel>
        <PanelHead title="ขั้นตอนที่ 1" sub="ใส่ลิงก์เว็บแล้วลองดึงข้อมูล" />
        <div className="space-y-3 p-4">
          <Field label="ลิงก์เว็บ (หรือชื่อเช่น Makro PRO)">
            <Input
              maxLength={2000}
              disabled={busy}
              value={website}
              placeholder="https://example.com/products"
              onChange={e => { setWebsite(e.target.value); setDiscovery(null); setForm(null); setStarted(''); }}
              onKeyDown={e => { if (e.key === 'Enter' && !busy && allowed && website.trim()) void discover(); }}
            />
          </Field>
          <Checkbox label="เป็นข้อมูลสาธารณะและมีสิทธิ์อ่าน/เก็บ" checked={allowed} onChange={e => setAllowed(e.target.checked)} disabled={busy} />
          <details className="text-xs">
            <summary className="cursor-pointer font-medium text-primary hover:underline mb-2">เว็บนี้ต้องล็อกอิน? (ไม่บังคับ)</summary>
            <div className="grid gap-3 md:grid-cols-3 mt-3 p-3 bg-surface-container-low rounded">
              <Field label="หน้าล็อกอิน">
                <Input type="url" value={login.url} placeholder="https://…/login" onChange={e => setLogin({ ...login, url: e.target.value })} />
              </Field>
              <Field label="ชื่อผู้ใช้">
                <Input autoComplete="off" value={login.username} onChange={e => setLogin({ ...login, username: e.target.value })} />
              </Field>
              <Field label="รหัสผ่าน">
                <Input type="password" autoComplete="new-password" value={login.password} onChange={e => setLogin({ ...login, password: e.target.value })} />
              </Field>
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-2">
            <Button icon="search" disabled={busy || !allowed || !website.trim()} onClick={() => void discover()}>
              {busy ? 'กำลังดึงข้อมูล…' : 'ลองดึงข้อมูล'}
            </Button>
            {!busy && website.trim() && !allowed && <span className="text-xs text-[#b08900]">ติ๊กยืนยันสิทธิ์ก่อน</span>}
          </div>
          {started && <Alert tone="ok">{started}</Alert>}
        </div>
      </Panel>

      {discovery && discovery.ready && (
        <Panel>
          <PanelHead title="ขั้นตอนที่ 2" sub="ตรวจผลดึง ถ้าถูกต้องกดเริ่มเก็บ" />
          <div className="space-y-4 p-4">
            {discovery.warnings.map((w, i) => <Alert key={i} tone="warn">{w}</Alert>)}

            <DetailSection title="เลือกข้อมูลที่จะเก็บ">
              <div className="flex flex-wrap gap-2">
                {discovery.fields.map(field => (
                  <Checkbox
                    key={field.key}
                    label={field.label}
                    checked={picked(field.key)}
                    disabled={field.required}
                    onChange={e => selectField(field.key, e.target.checked)}
                  />
                ))}
              </div>
              {!discovery.fields.some(f => f.key === 'price') && <Alert tone="warn">✗ ไม่พบราคา</Alert>}
            </DetailSection>

            {discovery.paging && (
              <DetailSection title="จำนวนหน้า">
                {discovery.paging.works ? (
                  <p className="text-xs">✓ เลื่อนหน้าเองได้ — {discovery.paging.pages.map(p => `หน้า ${p.page} พบ ${p.found}`).join(' · ')}</p>
                ) : (
                  <p className="text-xs text-[#b08900]">เก็บได้เฉพาะหน้านี้</p>
                )}
              </DetailSection>
            )}

            {discovery.fields.some(f => f.key === 'price') && (
              <DetailSection title="ราคา: รวม VAT หรือไม่">
                <div className="space-y-2">
                  <Checkbox label="รวม VAT" checked={vatChoice === 'included'} onChange={() => { setVatChoice('included'); config({ vatIncluded: true }); }} />
                  <Checkbox label="ไม่รวม VAT / ไม่แน่ใจ" checked={vatChoice === 'unsure'} onChange={() => { setVatChoice('unsure'); config({ vatIncluded: false }); }} />
                </div>
              </DetailSection>
            )}

            {!!columns.length && !!discovery.preview?.items.length && (
              <DetailSection title="ตัวอย่างข้อมูล">
                <div className="overflow-x-auto text-xs border border-secondary-container rounded">
                  <table className="w-full"><thead className="border-b"><tr>
                    {columns.map(f => <th key={f.key} className="px-2 py-1 text-left font-medium">{f.label}</th>)}
                  </tr></thead><tbody>
                    {discovery.preview.items.slice(0, 5).map((item, i) => (
                      <tr key={i} className="border-b border-secondary-container/50">
                        {columns.map(f => (
                          <td key={f.key} className="px-2 py-1">
                            {f.key === 'image' && item.fields.image ? (
                              <img src={item.fields.image} alt={item.name} className="h-6 w-6 rounded object-cover" />
                            ) : f.key === 'price' && item.price ? (
                              `${item.price} ${item.currency}`
                            ) : (
                              (item.fields[f.key] || '—').slice(0, 50)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              </DetailSection>
            )}

            <div className="flex gap-2">
              <Button disabled={busy || (discovery.fields.some(f => f.key === 'price') && !vatChoice)} onClick={saveAndStart}>
                เริ่มเก็บเบื้องหลัง
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => { setForm(null); setDiscovery(null); }}>ยกเลิก</Button>
            </div>
          </div>
        </Panel>
      )}

      {form && (
        <Panel>
          <PanelHead title={editId ? 'แก้ไขเว็บ' : 'เพิ่มเว็บใหม่'} />
          <form onSubmit={submit} className="space-y-4 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="ชื่อเว็บ">
                <Input required maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="ที่อยู่เว็บหลัก">
                <Input type="url" required disabled={!!editId} value={form.origin} onChange={e => { setForm({ ...form, origin: e.target.value }); setPreview(null); }} />
              </Field>
            </div>

            <Field label="หน้าเริ่มต้น (หนึ่งลิงก์ต่อบรรทัด)">
              <Textarea required rows={3} value={seeds} onChange={e => { setSeeds(e.target.value); setPreview(null); }} />
            </Field>

            <Field label="ขอบเขต path (หนึ่ง path ต่อบรรทัด)">
              <Textarea required rows={3} value={paths} onChange={e => { setPaths(e.target.value); setPreview(null); }} />
            </Field>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="วิธีเปิดหน้า">
                <Select value={form.config.mode} onChange={e => config({ mode: e.target.value as ScrapingConfig['mode'] })}>
                  <option value="html">HTML</option>
                  <option value="browser">Browser</option>
                </Select>
              </Field>
              <Field label="CSS selector รายการ">
                <Input value={form.config.itemSelector} onChange={e => config({ itemSelector: e.target.value })} />
              </Field>
            </div>

            <details className="text-xs border border-secondary-container rounded p-3">
              <summary className="cursor-pointer font-medium">ตั้งค่าเพิ่มเติม</summary>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="text-xs font-semibold block mb-2">ฟิลด์</label>
                  <div className="space-y-2">
                    {form.config.fields.map((f, i) => (
                      <div key={i} className="grid gap-2 grid-cols-[1fr_1fr_1fr_auto] items-end">
                        <Input required value={f.key} placeholder="key" onChange={e => config({ fields: form.config.fields.map((x, j) => j === i ? { ...x, key: e.target.value } : x) })} />
                        <Input required value={f.label} placeholder="ป้ายกำกับ" onChange={e => config({ fields: form.config.fields.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
                        <Input required value={f.selector} placeholder=".price" onChange={e => config({ fields: form.config.fields.map((x, j) => j === i ? { ...x, selector: e.target.value } : x) })} />
                        <Button type="button" size="sm" variant="ghost" onClick={() => config({ fields: form.config.fields.filter((_, j) => j !== i) })}>ลบ</Button>
                      </div>
                    ))}
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => config({ fields: [...form.config.fields, { key: '', label: '', selector: '' }] })}>+ เพิ่ม</Button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="สกุลเงิน"><Input required maxLength={3} value={form.config.currency} onChange={e => config({ currency: e.target.value.toUpperCase() })} /></Field>
                  <Field label="เก็บซ้ำทุก (ชั่วโมง)"><Input type="number" required min={1} value={form.config.intervalHours} onChange={e => config({ intervalHours: Number(e.target.value) })} /></Field>
                  <Field label="เพดานหน้า"><Input type="number" required min={1} value={form.config.maxPages} onChange={e => config({ maxPages: Number(e.target.value) })} /></Field>
                  <Field label="พักระหว่างหน้า (วินาที)"><Input type="number" required min={1} value={form.config.delayMs / 1000} onChange={e => config({ delayMs: Number(e.target.value) * 1000 })} /></Field>
                </div>

                <Field label="เงื่อนไขราคา"><Textarea maxLength={1000} value={form.config.priceContext} onChange={e => config({ priceContext: e.target.value })} /></Field>

                <div className="space-y-1">
                  <Checkbox label="ราคารวม VAT" checked={form.config.vatIncluded} onChange={e => config({ vatIncluded: e.target.checked })} />
                  <Checkbox label="มีสิทธิ์เก็บ" checked={form.config.collectionAllowed} onChange={e => { config({ collectionAllowed: e.target.checked }); if (!e.target.checked) setForm({ ...form, enabled: false }); }} />
                  <Checkbox label="เก็บอัตโนมัติ" disabled={!form.config.collectionAllowed} checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />
                  <Checkbox label="เก็บเฉพาะกลางคืน" checked={!!form.config.nightOnly} onChange={e => config({ nightOnly: e.target.checked })} />
                </div>

                <DetailSection title="ลองดึง">
                  <Field label="ลิงก์ทดลอง"><Input type="url" value={sample} onChange={e => { setSample(e.target.value); setPreview(null); }} /></Field>
                  <Button type="button" size="sm" variant="ghost" disabled={busy || !sample || !form.config.collectionAllowed} onClick={() => void action(async () => setPreview(await scrapingApi.preview({ ...input(), sampleUrl: sample })))}>
                    ทดลองดึง
                  </Button>
                  {preview && (
                    <div className="mt-2 text-xs">
                      <p>พบ {preview.found} รายการ</p>
                      {preview.items.map((item, i) => (
                        <details key={i} className="mt-1 border border-secondary-container rounded p-2">
                          <summary>{item.name} · {item.price || 'ไม่ชัด'}</summary>
                          <div className="mt-1 space-y-1 text-[10px]">
                            {Object.entries(item.fields).map(([k, v]) => <div key={k}><strong>{k}:</strong> {v || '—'}</div>)}
                          </div>
                        </details>
                      ))}
                    </div>
                  )}
                </DetailSection>
              </div>
            </details>

            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>บันทึก</Button>
              <Button type="button" variant="ghost" onClick={() => setForm(null)}>ยกเลิก</Button>
            </div>
          </form>
        </Panel>
      )}

      {loading ? (
        <Loading />
      ) : !sources.length ? (
        <Empty icon="add">เริ่มจากใส่เว็บด้านบน</Empty>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {sources.map(source => (
            <Panel key={source.id}>
              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold">{source.name}</h3>
                    <p className="text-[11px] text-on-surface-variant font-mono truncate">{source.origin}</p>
                  </div>
                  <span className="text-xs text-primary">{statuses[source.status]}</span>
                </div>

                <KeyValueGrid items={[
                  { label: 'อ่านแล้ว', value: `${source.progress.pages}` },
                  { label: 'พบ', value: fmt.num(source.progress.items) },
                  { label: 'สำเร็จ / ไม่สำเร็จ', value: `${source.progress.successful} / ${source.progress.failed}` },
                ]} cols={3} />

                {source.lastError && <Alert tone="warn">{source.lastError}</Alert>}

                {source.config.pagination !== 'browser' && !source.config.pagination && (
                  <Alert tone="warn">
                    <strong>เว็บแบบเก่า:</strong> อ่านเฉพาะลิงก์ที่เห็น
                    <Button type="button" size="sm" className="mt-2" disabled={busy || !source.config.collectionAllowed} onClick={() => void action(() => scrapingApi.enablePaging(source))}>
                      เก็บทุกหน้า
                    </Button>
                  </Alert>
                )}

                <div className="flex flex-wrap gap-1">
                  {source.status === 'running' ? (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void action(() => scrapingApi.stop(source))}>หยุด</Button>
                  ) : (
                    <>
                      <Button size="sm" disabled={busy || !source.config.collectionAllowed} onClick={() => void action(() => scrapingApi.start(source, false))}>
                        {source.progress.pending ? 'ต่อ' : 'เริ่ม'}
                      </Button>
                      {!!source.progress.pages && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void action(() => scrapingApi.start(source, true))}>ใหม่</Button>}
                      {source.activity === 'gave_up' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void action(() => scrapingApi.runNow(source))}>ตอนนี้</Button>}
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/marketing/scraped-catalog?sourceId=${source.id}`)}>ดูรายการ</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => edit(source)}>ตั้งค่า</Button>
                </div>

                {source.login && (
                  <div className="text-[11px] text-on-surface-variant space-y-2">
                    <div>🔒 {source.login.username}</div>
                    <button type="button" className="text-primary text-xs hover:underline" disabled={busy} onClick={() => setLoginEdit(loginEdit?.sourceId === source.id ? null : { sourceId: source.id, value: source.login! })}>
                      {loginEdit?.sourceId === source.id ? 'ยกเลิก' : 'แก้ไขล็อกอิน'}
                    </button>
                    {loginEdit?.sourceId === source.id && (
                      <form onSubmit={async (e) => { e.preventDefault(); await action(async () => { await scrapingApi.saveLogin(source.id, loginEdit.value); setLoginEdit(null); }); }} className="space-y-2 p-2 bg-surface-container-low rounded border border-secondary-container">
                        <Field label="URL"><Input type="url" required value={loginEdit.value.url} onChange={e => setLoginEdit({ ...loginEdit, value: { ...loginEdit.value, url: e.target.value } })} /></Field>
                        <Field label="ชื่อผู้ใช้"><Input required autoComplete="off" value={loginEdit.value.username} onChange={e => setLoginEdit({ ...loginEdit, value: { ...loginEdit.value, username: e.target.value } })} /></Field>
                        <Field label="รหัสผ่าน"><Input type="password" autoComplete="new-password" value={loginEdit.value.password || ''} onChange={e => setLoginEdit({ ...loginEdit, value: { ...loginEdit.value, password: e.target.value || undefined } })} /></Field>
                        <div className="flex gap-2">
                          <Button type="submit" size="sm" disabled={busy}>บันทึก</Button>
                          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(`ลบล็อกอิน ${source.name}?`)) void action(async () => { await scrapingApi.clearLogin(source.id); setLoginEdit(null); }); }}>ลบ</Button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </Page>
  );
}
