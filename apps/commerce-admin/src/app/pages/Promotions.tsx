import { FormEvent, Fragment, useState } from 'react';
import { Alert, Button, CodeBlock, Empty, ErrorText, ExpandRow, ExpandToggle, Field, FormPanel, Input, Loading, Page, PageHeader, Panel, PanelHead, Segmented, Span, Table, TBody, TD, TH, THead, TR, Tone, fmt, Textarea } from '@cp/ui';
import { PromotionRow, promotionsApi } from '../../lib/api';
import { useAsync } from '../hooks';

const STATE: Record<PromotionRow['state'], string> = {
  running: 'กำลังใช้', scheduled: 'รอเริ่ม', ended: 'จบแล้ว', sold_out: 'ครบโควตา', off: 'ปิด',
};
const STATE_TONE: Record<PromotionRow['state'], Tone> = {
  running: 'ok', scheduled: 'info', ended: 'muted', sold_out: 'warn', off: 'danger',
};
const when = (v: string | null) => (v ? new Date(v).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const local = (v: string) => { const d = new Date(v); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

/**
 * josh promotion mechanics. Read from josh's replica; every change is done by josh's own
 * PromotionMechanicService (josh COMMERCE_OWNS_PROMOTIONS=true locks josh admin's mechanic editing).
 * Product sets and promotion pages stay in josh admin.
 */
export function Promotions() {
  const [state, setState] = useState<string>('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<PromotionRow | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const list = useAsync(() => promotionsApi.list({ state, search }), [state, search]);
  const shadow = useAsync(() => promotionsApi.shadow(7), []);
  const detail = useAsync(() => (open ? promotionsApi.detail(open) : Promise.resolve(null)), [open]);
  const sh = shadow.data;

  async function run(done: string, fn: () => Promise<unknown>) {
    setBusy(true); setMsg('');
    try { await fn(); setMsg(done); setEditing(null); setCreating(null); list.reload(); detail.reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const toggle = (p: PromotionRow) => window.confirm(`${p.is_active ? 'ปิด' : 'เปิด'}โปร "${p.name}"? หน้าร้านเห็นทันที`)
    && run(`${p.is_active ? 'ปิด' : 'เปิด'} "${p.name}" แล้ว`, () => promotionsApi.update(p.id, { is_active: !p.is_active }));
  const remove = (p: PromotionRow) => window.confirm(`ลบโปร "${p.name}" ถาวร?\n\nราคาจะกลับเป็นราคาปกติทันที — ถ้าแค่หยุดชั่วคราวให้กด "ปิด" แทน`)
    && run(`ลบ "${p.name}" แล้ว`, () => promotionsApi.remove(p.id));
  const copyOf = (p: PromotionRow) => JSON.stringify({
    name: `${p.name} (สำเนา)`, start_date: p.start_date, end_date: p.end_date, value: p.value, badge_text: p.badge_text, badge_text_en: p.badge_text_en,
    product_set_ids: p.product_set_ids, max_units: p.max_units, audience: p.audience === 'companies' ? 'all' : p.audience, is_active: false,
  }, null, 2);

  return (
    <Page>
      <PageHeader
        title="โปรโมชัน"
        subtitle="โปรของ josh (promotion mechanics) · แก้ที่นี่ → josh บันทึกด้วยระบบของ josh เอง (ตรวจราคา/SKU ซ้ำ ล้าง cache) · Product Set และหน้าโปรยังแก้ที่ josh"
        actions={<Button variant="primary" onClick={() => setCreating(list.data?.[0] ? copyOf(list.data[0]) : '{\n  "name": "",\n  "start_date": "",\n  "end_date": "",\n  "value": {},\n  "product_set_ids": []\n}')}>สร้างโปรใหม่</Button>}
      />

      {sh && (
        <Panel>
          <div className="px-4 py-3 space-y-2">
            <div className="text-sm font-semibold">ทดลองคู่กัน: เลือกโปรตรง josh (7 วัน)</div>
            <div className={`text-2xl font-bold ${sh.sameMechanicRate != null && sh.sameMechanicRate < 100 ? 'text-amber-600' : 'text-on-surface'}`}>
              {sh.sameMechanicRate == null ? '—' : `${sh.sameMechanicRate}%`}
            </div>
            <div className="text-xs text-on-surface-variant">{sh.same_mechanic} / {sh.lines} บรรทัด order ที่มีโปร · จาก "ราคา: commerce คิดคู่กัน"</div>
          </div>
        </Panel>
      )}

      {msg && <Alert tone="ok">{msg}</Alert>}
      <ErrorText error={list.error || shadow.error} />

      {creating !== null && <CreateForm initial={creating} busy={busy} onCancel={() => setCreating(null)}
        onSave={(m) => run(`สร้าง "${String(m.name)}" แล้ว`, () => promotionsApi.create(m))} />}

      <Panel>
        <PanelHead title="ตัวกรอง" />
        <div className="px-4 py-3 space-y-3">
          <Segmented<string>
            value={state}
            onChange={setState}
            options={[
              { value: '', label: 'ทั้งหมด' },
              ...Object.entries(STATE).map(([k, label]) => ({ value: k, label }))
            ]}
          />
          <form onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }} className="flex gap-2">
            <Input
              aria-label="ค้นหาชื่อโปร"
              placeholder="ชื่อโปร"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" variant="secondary">ค้นหา</Button>
          </form>
        </div>
      </Panel>

      {list.data && (
        <Panel className="overflow-hidden">
          {list.data.length ? (
            <Table>
              <THead>
                <TH>โปร</TH>
                <TH>สถานะ</TH>
                <TH>ช่วงเวลา</TH>
                <TH right>ขายแล้ว / โควตา</TH>
                <TH right>SKU</TH>
                <TH>ลูกค้า</TH>
                <TH className="w-32" />
              </THead>
              <TBody>
                {list.data.map((p) => (
                  <Fragment key={p.id}>
                    <TR>
                      <TD>
                        <div className="font-medium">{p.name}</div>
                        {p.badge_text && <div className="text-[10px] text-on-surface-variant">{p.badge_text}</div>}
                        {p.campaign_name && <div className="text-[10px] text-on-surface-variant">แคมเปญ: {p.campaign_name}</div>}
                      </TD>
                      <TD>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATE_TONE[p.state] === 'ok' ? 'bg-[#e7f5ec] text-[#157347]' : STATE_TONE[p.state] === 'warn' ? 'bg-[#fef7e0] text-[#b08900]' : STATE_TONE[p.state] === 'danger' ? 'bg-[#fdecee] text-[#c2333f]' : 'bg-surface-container text-on-surface-variant'}`}>
                          {STATE[p.state]}
                        </span>
                      </TD>
                      <TD kind="time">{when(p.start_date)} – {when(p.end_date)}</TD>
                      <TD kind="num">{p.sold_units}{p.max_units ? ` / ${p.max_units}` : ''}</TD>
                      <TD kind="num">{p.sku_count}</TD>
                      <TD kind="muted">{p.audience === 'companies' ? `${p.audience_companies} บริษัท` : p.audience}</TD>
                      <TD className="text-right space-x-1">
                        <ExpandToggle open={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)} label="ดู" />
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(p)}>แก้</Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => toggle(p)}>{p.is_active ? 'ปิด' : 'เปิด'}</Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setCreating(copyOf(p))}>คัดลอก</Button>
                        <Button variant="danger-ghost" size="sm" disabled={busy} onClick={() => remove(p)}>ลบ</Button>
                      </TD>
                    </TR>
                    {editing?.id === p.id && <ExpandRow colSpan={7}><EditForm p={p} busy={busy} onCancel={() => setEditing(null)}
                      onSave={(changes) => run(`บันทึก "${p.name}" แล้ว`, () => promotionsApi.update(p.id, changes))} /></ExpandRow>}
                    {open === p.id && (
                      <ExpandRow colSpan={7}>
                        <ErrorText error={detail.error} />
                        {!detail.data ? (
                          <Loading />
                        ) : (
                          <div className="space-y-3">
                            <div>
                              <div className="text-xs font-semibold text-on-surface-variant mb-2">เงื่อนไข (value)</div>
                              <CodeBlock value={detail.data.value} />
                            </div>
                            <div>
                              <div className="text-xs font-semibold text-on-surface-variant mb-2">SKU และราคา</div>
                              <Table>
                                <THead>
                                  <TH>SKU</TH>
                                  <TH>สินค้า</TH>
                                  <TH>ป้าย</TH>
                                  <TH>ราคา/ขั้น</TH>
                                </THead>
                                <TBody>
                                  {detail.data.skus.map((s) => (
                                    <TR key={s.sku}>
                                      <TD kind="mono">{s.sku}</TD>
                                      <TD kind="muted">{s.name_th ?? '—'}</TD>
                                      <TD kind="muted">{s.badge_text ?? '—'}</TD>
                                      <TD kind="mono">{JSON.stringify(s.value ?? s.quantity_rules)}</TD>
                                    </TR>
                                  ))}
                                </TBody>
                              </Table>
                            </div>
                          </div>
                        )}
                      </ExpandRow>
                    )}
                  </Fragment>
                ))}
              </TBody>
            </Table>
          ) : (
            <div className="px-4 py-8"><Empty icon="local_offer">ไม่พบโปร</Empty></div>
          )}
        </Panel>
      )}
    </Page>
  );
}

/** The everyday edits: name, badges, window, unit cap. Conditions and product sets: copy into a new promotion. */
function EditForm({ p, busy, onSave, onCancel }: { p: PromotionRow; busy: boolean; onSave: (c: Record<string, unknown>) => void; onCancel: () => void }) {
  const [v, setV] = useState({ name: p.name, badge_text: p.badge_text ?? '', badge_text_en: p.badge_text_en ?? '', start_date: local(p.start_date),
    end_date: local(p.end_date), max_units: p.max_units == null ? '' : String(p.max_units) });
  const [err, setErr] = useState('');
  function save() {
    if (!v.name.trim()) return setErr('ต้องมีชื่อโปร');
    if (new Date(v.end_date) <= new Date(v.start_date)) return setErr('วันจบต้องหลังวันเริ่ม');
    const cap = v.max_units.trim() === '' ? null : Number(v.max_units);
    if (cap !== null && (!Number.isInteger(cap) || cap < 1)) return setErr('โควตาต้องเป็นจำนวนเต็มตั้งแต่ 1 หรือเว้นว่าง');
    const changes: Record<string, unknown> = {};
    if (v.name.trim() !== p.name) changes.name = v.name.trim();
    if (v.badge_text !== (p.badge_text ?? '')) changes.badge_text = v.badge_text || null;
    if (v.badge_text_en !== (p.badge_text_en ?? '')) changes.badge_text_en = v.badge_text_en || null;
    if (v.start_date !== local(p.start_date)) changes.start_date = new Date(v.start_date).toISOString();
    if (v.end_date !== local(p.end_date)) changes.end_date = new Date(v.end_date).toISOString();
    if (cap !== p.max_units) changes.max_units = cap;
    if (!Object.keys(changes).length) return onCancel();
    onSave(changes);
  }
  return (
    <FormPanel
      title="แก้โปรโมชัน"
      icon="edit"
      cols={3}
      busy={busy}
      error={err}
      onSubmit={save}
      onCancel={onCancel}
    >
      <Field label="ชื่อโปร">
        <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </Field>
      <Field label="ป้าย (ไทย)">
        <Input value={v.badge_text} onChange={(e) => setV({ ...v, badge_text: e.target.value })} />
      </Field>
      <Field label="ป้าย (อังกฤษ)">
        <Input value={v.badge_text_en} onChange={(e) => setV({ ...v, badge_text_en: e.target.value })} />
      </Field>
      <Field label="เริ่ม">
        <Input type="datetime-local" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} />
      </Field>
      <Field label="จบ">
        <Input type="datetime-local" value={v.end_date} onChange={(e) => setV({ ...v, end_date: e.target.value })} />
      </Field>
      <Field label="โควตา (ชิ้น)">
        <Input type="number" value={v.max_units} onChange={(e) => setV({ ...v, max_units: e.target.value })} placeholder="เว้นว่าง = ไม่จำกัด" />
      </Field>
      {p.campaign_id && (
        <Span className="text-xs text-on-surface-variant">
          โปรนี้อยู่ในแคมเปญ "{p.campaign_name}" — ช่วงเวลาที่ใช้จริงมาจากแคมเปญ
        </Span>
      )}
    </FormPanel>
  );
}

/** New promotion as josh's CreatePromotionMechanicDto JSON (prefilled from an existing one, created switched off). */
function CreateForm({ initial, busy, onSave, onCancel }: { initial: string; busy: boolean; onSave: (m: Record<string, unknown>) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [err, setErr] = useState('');
  const sets = useAsync(() => promotionsApi.productSets(), []);
  function save() {
    let m: unknown;
    try { m = JSON.parse(text); } catch { return setErr('JSON ไม่ถูกต้อง'); }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return setErr('ต้องเป็น object');
    setErr('');
    onSave(m as Record<string, unknown>);
  }
  return (
    <FormPanel
      title="สร้างโปรใหม่"
      icon="add_circle"
      cols={1}
      description="รูปแบบเดียวกับ josh · ตั้งต้นจากโปรที่เลือกและปิดไว้ก่อน · josh ตรวจเงื่อนไขและ SKU ซ้ำให้"
      busy={busy}
      error={err}
      onSubmit={save}
      onCancel={onCancel}
    >
      <Field label="ข้อมูลโปร (JSON)">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} />
      </Field>
      {sets.data && (
        <Span className="space-y-2">
          <details className="text-xs">
            <summary className="cursor-pointer font-medium text-on-surface-variant hover:text-on-surface">Product Set ที่มี ({sets.data.length}) — ใส่ id ใน product_set_ids</summary>
            <Table className="mt-2">
              <THead>
                <TH>ID</TH>
                <TH>ชื่อ</TH>
                <TH right>สินค้า</TH>
                <TH>สถานะ</TH>
              </THead>
              <TBody>
                {sets.data.map((s) => (
                  <TR key={s.id}>
                    <TD kind="mono">{s.id}</TD>
                    <TD>{s.name}</TD>
                    <TD kind="num">{s.products}</TD>
                    <TD kind="muted">{s.is_active ? 'เปิด' : 'ปิด'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </details>
        </Span>
      )}
    </FormPanel>
  );
}
