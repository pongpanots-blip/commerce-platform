import { FormEvent, Fragment, useState } from 'react';
import {
  Button, Chip, Empty, ErrorText, Field, FormPanel, Input, Loading, Page, PageHeader, Panel, Pager, Select, Span, StatGrid, StatTile, Textarea,
  TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { joshActionsApi, joshProductApi, JoshProductDetail, ProductIssueKey } from '../../lib/api';
import { useAsync } from '../hooks';

const ISSUES: [ProductIssueKey, string][] = [
  ['pending_approval', 'รออนุมัติข้อมูลจาก ERP'], ['no_image', 'ไม่มีรูป'], ['no_category', 'ไม่มีหมวด'],
  ['no_price', 'ไม่มีราคาขาย'], ['out_of_stock', 'หมด'], ['low_stock', 'ใกล้หมด'],
];
const STATUS: Record<string, string> = { active: 'เปิดขาย', draft: 'draft (ยังไม่เปิด)', inactive: 'ปิด' };
const LIMIT = 50;
const show = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** josh's product catalog from josh's replica. ERP approval and master-data edits go through josh's own services; images stay in josh admin. */
export function JoshProducts() {
  const summary = useAsync(() => joshProductApi.summary(), []);
  const categories = useAsync(() => joshProductApi.categories(), []);
  const [draft, setDraft] = useState({ search: '', status: '', categoryId: '', orderTaking: '' });
  const [f, setF] = useState({ ...draft, issue: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(LIMIT);
  const [open, setOpen] = useState<string | null>(null);
  const list = useAsync(() => joshProductApi.list({ ...f, page, limit: pageSize }), [f, page, pageSize]);
  const detail = useAsync(() => (open ? joshProductApi.detail(open) : Promise.resolve(null)), [open]);
  const s = summary.data;
  const pickIssue = (issue: string) => { setPage(1); setF({ ...f, issue: f.issue === issue ? '' : issue }); };
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const togglePick = (id: string) => { const next = new Set(picked); if (next.has(id)) next.delete(id); else next.add(id); setPicked(next); };

  async function decide(action: 'approve' | 'reject', ids: string[]) {
    const verb = action === 'approve' ? 'อนุมัติ' : 'ไม่อนุมัติ';
    if (!ids.length || !window.confirm(`${verb}ข้อมูลจาก ERP ของสินค้า ${ids.length} รายการ?\n\n${action === 'approve' ? 'สินค้า draft จะขึ้นขาย และค่าที่ ERP ส่งมาจะใช้ทันที' : 'ค่าที่ ERP ส่งมาจะถูกทิ้ง สินค้าคงค่าเดิม'} (josh ทำในชื่อบัญชี josh ที่อีเมลตรงกับคุณ)`)) return;
    setBusy(true); setMsg('');
    try {
      const r = action === 'approve' ? await joshActionsApi.approveProducts(ids) : await joshActionsApi.rejectProducts(ids);
      setMsg(`${verb}แล้ว: ${JSON.stringify(r)}`); setPicked(new Set()); summary.reload(); list.reload(); detail.reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const pending = (p: { product_status: string; erp_pending_at: string | null }) => p.product_status === 'draft' || !!p.erp_pending_at;

  return (
    <Page>
      <PageHeader
        title="สินค้า (josh)"
        subtitle="แค็ตตาล็อกหน้าร้าน อ่านจาก replica ของ josh · อนุมัติ / ไม่อนุมัติข้อมูลจาก ERP ทำที่นี่ได้ (josh เป็นคนบันทึก) · แก้ไขอื่นๆ / ใส่รูป ยังทำที่ josh admin"
        actions={<Button icon="refresh" onClick={() => { summary.reload(); list.reload(); }}>Refresh</Button>}
      />
      <div className="border-t border-secondary-container" />

      <ErrorText error={summary.error || list.error} />
      {msg && <div className="px-4 py-2 text-xs text-on-surface-variant bg-surface-container-low">{msg}</div>}

      {s && (
        <div>
          <StatGrid cols={2}>
            <StatTile
              label="สินค้าทั้งหมด"
              value={fmt.num(s.total)}
              foot={s.byStatus.map((b) => `${STATUS[b.status] ?? b.status} ${b.n}`).join(' · ')}
            />
            {ISSUES.map(([k, label]) => (
              <StatTile
                key={k}
                accent={s[k as ProductIssueKey] > 0}
                tone={s[k as ProductIssueKey] > 0 ? 'warn' : 'ok'}
                icon={s[k as ProductIssueKey] > 0 ? 'warning' : 'check_circle'}
                label={label}
                value={fmt.num(s[k as ProductIssueKey])}
                selected={f.issue === k}
                onClick={() => pickIssue(k)}
              />
            ))}
          </StatGrid>
        </div>
      )}

      <Panel className="overflow-hidden">
        <form className="flex flex-wrap items-end gap-3 p-4" onSubmit={(e: FormEvent) => { e.preventDefault(); setPage(1); setF({ ...draft, issue: f.issue }); }}>
          <Field label="ค้นหา" className="flex-1 min-w-48">
            <Input value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} placeholder="SKU หรือชื่อสินค้า" />
          </Field>
          <Field label="สถานะ">
            <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              <option value="">ทั้งหมด</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="หมวด">
            <Select value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
              <option value="">ทั้งหมด</option>
              {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.category_path ?? c.category_name_th}</option>)}
            </Select>
          </Field>
          <Field label="แบบสั่งจอง (order taking)">
            <Select value={draft.orderTaking} onChange={(e) => setDraft({ ...draft, orderTaking: e.target.value })}>
              <option value="">ทั้งหมด</option>
              <option value="Y">ใช่</option>
              <option value="N">ไม่ใช่</option>
            </Select>
          </Field>
          <Button type="submit">ค้นหา</Button>
        </form>
        {f.issue && (
          <div className="px-4 py-2 text-xs text-on-surface-variant border-t border-secondary-container flex items-center gap-2">
            <span>กรอง: {ISSUES.find(([k]) => k === f.issue)?.[1]}</span>
            <Button size="sm" variant="ghost" onClick={() => pickIssue(f.issue)}>ล้าง</Button>
          </div>
        )}
      </Panel>

      {list.loading && !list.data ? (
        <Loading />
      ) : list.data ? (
        <>
          <div className="flex items-center gap-4 px-4 py-3 text-xs text-on-surface-variant">
            <span>{fmt.num(list.data.total)} รายการ</span>
            {picked.size > 0 && (
              <>
                <Button size="sm" disabled={busy} onClick={() => decide('approve', [...picked])}>อนุมัติที่เลือก ({picked.size})</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide('reject', [...picked])}>ไม่อนุมัติที่เลือก</Button>
              </>
            )}
          </div>

          <Panel className="overflow-hidden">
            {list.data.items.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH></TH>
                    <TH></TH>
                    <TH>SKU</TH>
                    <TH>สินค้า</TH>
                    <TH>หมวด</TH>
                    <TH>ราคาขาย</TH>
                    <TH>สต็อก</TH>
                    <TH>สถานะ</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {list.data.items.map((p) => (
                    <Fragment key={p.product_inventory_id}>
                      <TR>
                        <TD>
                          {pending(p) && (
                            <input
                              type="checkbox"
                              aria-label={`เลือก ${p.product_inventory_sku}`}
                              checked={picked.has(p.product_inventory_id)}
                              onChange={() => togglePick(p.product_inventory_id)}
                            />
                          )}
                        </TD>
                        <TD className="w-16">
                          {p.image_url ? (
                            <img src={p.image_url} alt="" width={40} height={40} className="object-cover rounded" />
                          ) : (
                            <Chip tone="warn">ไม่มีรูป</Chip>
                          )}
                        </TD>
                        <TD kind="code">{p.product_inventory_sku}</TD>
                        <TD>
                          {p.name_th ?? p.name_en ?? '—'}
                          <div className="text-[11px] text-on-surface-variant">{[p.brand_name, p.pack_size, p.selling_unit].filter(Boolean).join(' · ')}</div>
                        </TD>
                        <TD>{p.category_name_th ?? <Chip tone="warn">ไม่มีหมวด</Chip>}</TD>
                        <TD kind="money">
                          {p.selling_unit_price ? fmt.baht(p.selling_unit_price) : <Chip tone="danger">ไม่มีราคา</Chip>}
                        </TD>
                        <TD>
                          {p.order_taking_flag === 'Y' ? <Chip>สั่งจอง</Chip> : p.product_inventory_quantity ?? '—'}
                        </TD>
                        <TD>
                          <Chip tone={p.product_status === 'active' ? 'ok' : 'muted'}>{STATUS[p.product_status] ?? p.product_status}</Chip>
                          {p.erp_pending_at && (
                            <div className="mt-1">
                              <Chip tone="warn">ERP รออนุมัติ ({p.erp_pending_source})</Chip>
                            </div>
                          )}
                        </TD>
                        <TD>
                          <Button size="sm" variant="ghost" onClick={() => setOpen(open === p.product_inventory_id ? null : p.product_inventory_id)}>
                            {open === p.product_inventory_id ? 'ซ่อน' : 'รายละเอียด'}
                          </Button>
                        </TD>
                      </TR>
                      {open === p.product_inventory_id && (
                        <TR>
                          <TD colSpan={9}>
                            {detail.error ? (
                              <ErrorText error={detail.error} />
                            ) : !detail.data ? (
                              <Loading />
                            ) : (
                              <div className="space-y-4 p-4">
                                <div className="flex flex-wrap gap-2">
                                  {detail.data.media.map((m) => (
                                    <img key={m.source} src={m.source} alt="" width={72} height={72} className="object-cover rounded" />
                                  ))}
                                </div>
                                <div className="text-xs text-on-surface-variant">
                                  ราคา: ขาย {fmt.baht(detail.data.selling_unit_price)} · สั่ง {fmt.baht(detail.data.ordering_price)} · ตั้ง {fmt.baht(detail.data.original_price)} · MOQ {show(detail.data.moq)} · supplier {show(detail.data.sup_code)} · เก็บ {show(detail.data.storage_temperature)} · ประเทศ {show(detail.data.country_code_source)} · VAT {show(detail.data.vat_type)}
                                </div>
                                <ProductEditor key={detail.data.updated_at} p={detail.data} categories={categories.data ?? []} onSaved={(m) => { setMsg(m); list.reload(); detail.reload(); }} />
                                {!!detail.data.pendingChanges.length && (
                                  <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-on-surface-variant">ERP ส่งมาเมื่อ {new Date(detail.data.erp_pending_at!).toLocaleString('th-TH')} — รออนุมัติ:</span>
                                      <Button size="sm" disabled={busy} onClick={() => decide('approve', [p.product_inventory_id])}>อนุมัติ</Button>
                                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide('reject', [p.product_inventory_id])}>ไม่อนุมัติ</Button>
                                    </div>
                                    <Table>
                                      <THead>
                                        <TR>
                                          <TH>ฟิลด์ ERP</TH>
                                          <TH>ตอนนี้</TH>
                                          <TH>ERP ส่งมา</TH>
                                        </TR>
                                      </THead>
                                      <TBody>
                                        {detail.data.pendingChanges.map((c) => (
                                          <TR key={c.field}>
                                            <TD kind="code">{c.field}</TD>
                                            <TD>{show(c.current)}</TD>
                                            <TD>
                                              {c.changed ? <strong>{show(c.pending)}</strong> : show(c.pending)}
                                              {c.changed && <Chip tone="warn" className="ml-2">เปลี่ยน</Chip>}
                                            </TD>
                                          </TR>
                                        ))}
                                      </TBody>
                                    </Table>
                                  </div>
                                )}
                              </div>
                            )}
                          </TD>
                        </TR>
                      )}
                    </Fragment>
                  ))}
                </TBody>
              </Table>
            ) : (
              <Empty>ไม่พบสินค้า</Empty>
            )}
          </Panel>

          <Pager page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} onPageSize={setPageSize} />
        </>
      ) : null}
    </Page>
  );
}

const EDIT_FIELDS: { key: string; label: string; get: (p: JoshProductDetail) => unknown; kind?: 'number' | 'text' | 'long' }[] = [
  { key: 'product_name_th', label: 'ชื่อ (ไทย)', get: (p) => p.name_th },
  { key: 'product_name_en', label: 'ชื่อ (อังกฤษ)', get: (p) => p.name_en },
  { key: 'product_description_th', label: 'รายละเอียด (ไทย)', get: (p) => p.description_th, kind: 'long' },
  { key: 'product_description_en', label: 'รายละเอียด (อังกฤษ)', get: (p) => p.description_en, kind: 'long' },
  { key: 'brand_name', label: 'แบรนด์', get: (p) => p.brand_name },
  { key: 'selling_unit', label: 'หน่วยขาย', get: (p) => p.selling_unit },
  { key: 'pack_size', label: 'ขนาดแพ็ก', get: (p) => p.pack_size },
  { key: 'storage_temperature', label: 'อุณหภูมิเก็บ', get: (p) => p.storage_temperature },
  { key: 'selling_unit_price', label: 'ราคาขาย (รวม VAT)', get: (p) => p.selling_unit_price, kind: 'number' },
  { key: 'original_price', label: 'ราคาตั้ง', get: (p) => p.original_price, kind: 'number' },
  { key: 'low_stock_threshold', label: 'เตือนใกล้หมดที่', get: (p) => p.low_stock_threshold, kind: 'number' },
];

function ProductEditor({ p, categories, onSaved }: { p: JoshProductDetail; categories: { id: string; category_name_th: string | null; category_path: string | null }[]; onSaved: (msg: string) => void }) {
  const initial = (): Record<string, string> => ({
    ...Object.fromEntries(EDIT_FIELDS.map((f) => [f.key, f.get(p) == null ? '' : String(f.get(p))])),
    product_status: p.product_status ?? '', category_id: p.category_id ?? '',
  });
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const start = initial();
  const changed = Object.keys(v).filter((k) => v[k] !== start[k]);

  async function save() {
    const fields: Record<string, unknown> = {};
    for (const k of changed) {
      const kind = EDIT_FIELDS.find((f) => f.key === k)?.kind;
      if (kind === 'number') {
        const n = Number(v[k]);
        if (v[k].trim() === '' || !Number.isFinite(n) || n < 0) { setErr(`${k}: ต้องเป็นตัวเลขไม่ติดลบ`); return; }
        fields[k] = n;
      } else fields[k] = k === 'category_id' && v[k] === '' ? null : v[k];
    }
    if (!window.confirm(`บันทึก ${changed.length} ช่องของ ${p.product_inventory_sku} ไปที่ josh?\n\n${changed.join(', ')}\n\n(josh บันทึกในชื่อบัญชี josh ที่อีเมลตรงกับคุณ · หน้าร้านเห็นทันที)`)) return;
    setBusy(true); setErr('');
    try { await joshActionsApi.updateProduct(p.product_inventory_id, fields); setOpen(false); onSaved(`บันทึก ${p.product_inventory_sku} แล้ว (${changed.join(', ')})`); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  if (!open) return <Button size="sm" variant="ghost" onClick={() => { setV(initial()); setOpen(true); }}>แก้ข้อมูลสินค้า</Button>;

  return (
    <FormPanel
      title={`แก้สินค้า ${p.product_inventory_sku}`}
      icon="edit"
      cols={2}
      error={err}
      busy={busy}
      onSubmit={save}
      onCancel={() => setOpen(false)}
      submitLabel={`บันทึก${changed.length ? ` (${changed.length})` : ''}`}
      description="ช่องว่างไม่ลบค่าเดิม (josh ข้ามค่าว่าง) · ราคาลูกค้า/สัญญาแก้ที่หน้า ราคาพนักงาน"
    >
      <Field label="สถานะ">
        <Select value={v.product_status} onChange={(e) => setV({ ...v, product_status: e.target.value })}>
          {Object.entries(STATUS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          {!(v.product_status in STATUS) && <option value={v.product_status}>{v.product_status || '—'}</option>}
        </Select>
      </Field>
      <Field label="หมวด">
        <Select value={v.category_id} onChange={(e) => setV({ ...v, category_id: e.target.value })}>
          <option value="">— ไม่มีหมวด —</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.category_path ?? c.category_name_th}</option>)}
        </Select>
      </Field>
      {EDIT_FIELDS.map((f) => (
        <div key={f.key}>
          {f.kind === 'long' ? (
            <Span>
              <Field label={f.label}>
                <Textarea rows={3} value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
              </Field>
            </Span>
          ) : (
            <Field label={f.label}>
              <Input inputMode={f.kind === 'number' ? 'decimal' : undefined} value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
            </Field>
          )}
        </div>
      ))}
    </FormPanel>
  );
}
