import { FormEvent, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import {
  Alert, Button, Chip, DetailSection, Empty, ErrorText, Field, FormPanel, Hint, Input, KeyValueGrid, Loading,
  Page, PageHeader, Panel, PanelHead, Select, Span, Textarea,
  TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { joshActionsApi, joshAdmin, joshProductApi, JoshProductDetail as JoshProductDetailType, productContentsApi, productPricesApi } from '../../lib/api';
import { useAsync } from '../hooks';

const STATUS: Record<string, string> = { active: 'เปิดขาย', draft: 'draft (ยังไม่เปิด)', inactive: 'ปิด' };
const show = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

const EDIT_FIELDS: { key: string; label: string; get: (p: JoshProductDetailType) => unknown; kind?: 'number' | 'text' | 'long' }[] = [
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
  { key: 'reorder_quantity', label: 'จำนวนสั่งเติม', get: (p) => p.reorder_quantity, kind: 'number' },
  { key: 'buying_price', label: 'ต้นทุน', get: (p) => p.buying_price, kind: 'number' },
  { key: 'product_short_code', label: 'รหัสย่อ', get: (p) => p.product_short_code },
  { key: 'maximum_shelf_life', label: 'อายุสินค้าสูงสุด', get: (p) => p.maximum_shelf_life },
  { key: 'is_organic', label: 'ออร์แกนิก', get: (p) => p.is_organic },
  { key: 'ingredients', label: 'ส่วนผสม', get: (p) => p.ingredients, kind: 'long' },
  { key: 'allergens', label: 'สารก่อภูมิแพ้', get: (p) => p.allergens, kind: 'long' },
  { key: 'expiration_info', label: 'ข้อมูลวันหมดอายุ', get: (p) => p.expiration_info, kind: 'long' },
  { key: 'usage_direction', label: 'วิธีใช้', get: (p) => p.usage_direction, kind: 'long' },
  { key: 'best_paired_food', label: 'เข้ากับอาหาร', get: (p) => p.best_paired_food, kind: 'long' },
];

/**
 * `content`: commerce's own copy of the content keys once it owns product content (stage 4b) — shown over josh's copy,
 * which follows a moment later.
 */
function ProductEditor({ p, content, categories, onSaved, onClose }: { p: JoshProductDetailType; content: Record<string, unknown> | null; categories: { id: string; category_name_th: string | null; category_path: string | null }[]; onSaved: (msg: string) => void; onClose: () => void }) {
  const valueOf = (f: (typeof EDIT_FIELDS)[number]) => (content && f.key in content ? content[f.key] : f.get(p));
  const initial = (): Record<string, string> => ({
    ...Object.fromEntries(EDIT_FIELDS.map((f) => [f.key, valueOf(f) == null ? '' : String(valueOf(f))])),
    product_status: p.product_status ?? '', category_id: p.category_id ?? '',
  });
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
    if (!window.confirm(`บันทึก ${changed.length} ช่องของ ${p.product_inventory_sku}?\n\n${changed.join(', ')}\n\n(josh บันทึกในนามของคุณ — josh บันทึกอีเมลคุณไว้ใน audit · หน้าร้านเห็นทันที)`)) return;
    setBusy(true); setErr('');
    try { await joshActionsApi.updateProduct(p.product_inventory_id, fields); onClose(); onSaved(`บันทึก ${p.product_inventory_sku} แล้ว (${changed.join(', ')})`); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <FormPanel
      title={`แก้สินค้า ${p.product_inventory_sku}`}
      icon="edit"
      cols={2}
      error={err}
      busy={busy}
      onSubmit={save}
      onCancel={onClose}
      submitLabel={`บันทึก${changed.length ? ` (${changed.length})` : ''}`}
      description={content
        ? 'ชื่อ รายละเอียด ส่วนผสม ต้นทุน ฯลฯ เก็บที่ commerce แล้วส่งให้ josh (ช่องว่าง = ล้างค่า ยกเว้นชื่อ) · ช่องอื่นยังบันทึกที่ josh (ช่องว่างไม่ลบค่าเดิม) · ราคาลูกค้า/สัญญาแก้ที่หน้า ราคาพนักงาน'
        : 'ช่องว่างไม่ลบค่าเดิม (josh ข้ามค่าว่าง) · ราคาลูกค้า/สัญญาแก้ที่หน้า ราคาพนักงาน'}
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

/** Product detail page (from expanded row). */
export function JoshProductDetail() {
  const { id = '' } = useParams();
  const location = useLocation();
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const detail = useAsync(() => joshProductApi.detail(id), [id]);
  const categories = useAsync(() => joshProductApi.categories(), []);
  const p = detail.data;
  // Stage 4b: commerce's content row (none yet → josh's values stand).
  const content = useAsync(async () => {
    if (!p || !(await productPricesApi.ownership()).productContent) return null;
    return productContentsApi.get(p.product_inventory_sku).then((r) => r.fields, () => ({}));
  }, [p?.product_inventory_sku, p?.updated_at]);

  const backTo = `${location.state?.from ?? '/reports/products'}${location.state?.search ?? ''}`;

  async function decide(action: 'approve' | 'reject') {
    if (!p) return;
    const verb = action === 'approve' ? 'อนุมัติ' : 'ไม่อนุมัติ';
    if (!window.confirm(`${verb}ข้อมูลจาก ERP ของสินค้า ${p.product_inventory_sku}?\n\n${action === 'approve' ? 'สินค้า draft จะขึ้นขาย และค่าที่ ERP ส่งมาจะใช้ทันที' : 'ค่าที่ ERP ส่งมาจะถูกทิ้ง สินค้าคงค่าเดิม'} (josh ทำในนามของคุณ — josh บันทึกอีเมลคุณไว้ใน audit)`)) return;
    setBusy(true); setMsg('');
    try {
      const r = action === 'approve' ? await joshActionsApi.approveProducts([p.product_inventory_id]) : await joshActionsApi.rejectProducts([p.product_inventory_id]);
      setMsg(`${verb}แล้ว: ${JSON.stringify(r)}`); detail.reload(); categories.reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Page>
      <PageHeader
        back={{ to: backTo, label: 'สินค้า (josh)' }}
        title={p ? p.product_inventory_sku : id}
        badge={p && <Chip tone={p.product_status === 'active' ? 'ok' : 'muted'}>{STATUS[p.product_status] ?? p.product_status}</Chip>}
        subtitle={p ? [p.name_th || p.name_en, p.brand_name, p.pack_size].filter(Boolean).join(' · ') : undefined}
        actions={p && !editing && <Button icon="edit" onClick={() => setEditing(true)}>แก้ข้อมูลสินค้า</Button>}
      />

      <ErrorText error={detail.error} />
      {msg && <div className="px-4 py-2 text-xs text-on-surface-variant bg-surface-container-low">{msg}</div>}

      {detail.loading && !p ? (
        <Loading />
      ) : !p ? (
        <Panel><Empty>ไม่พบสินค้า</Empty></Panel>
      ) : (
        <>
          <ProductImages p={p} onSaved={(m) => { setMsg(m); detail.reload(); }} />

          <Panel>
            <div className="p-4 text-xs text-on-surface-variant">
              ราคา: ขาย {fmt.baht(p.selling_unit_price)} · สั่ง {fmt.baht(p.ordering_price)} · ตั้ง {fmt.baht(p.original_price)} · MOQ {show(p.moq)} · supplier {show(p.sup_code)} · เก็บ {show(p.storage_temperature)} · ประเทศ {show(p.country_code_source)} · VAT {show(p.vat_type)}
            </div>
          </Panel>

          {editing && !content.loading && <ProductEditor key={p.updated_at} p={p} content={content.data ?? null} categories={categories.data ?? []} onClose={() => setEditing(false)} onSaved={(m) => { setMsg(m); detail.reload(); content.reload(); }} />}

          {p.pendingChanges && p.pendingChanges.length > 0 && (
            <Panel>
              <div className="space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-on-surface-variant">ERP ส่งมาเมื่อ {new Date(p.erp_pending_at!).toLocaleString('th-TH')} — รออนุมัติ:</span>
                  <Button size="sm" disabled={busy} onClick={() => decide('approve')}>อนุมัติ</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide('reject')}>ไม่อนุมัติ</Button>
                </div>
                <Table>
                  <THead>
                    <TH>ฟิลด์ ERP</TH>
                    <TH>ตอนนี้</TH>
                    <TH>ERP ส่งมา</TH>
                  </THead>
                  <TBody>
                    {p.pendingChanges.map((c) => (
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
            </Panel>
          )}
        </>
      )}
    </Page>
  );
}

/**
 * Product images (COMMERCE_OWNS_CATALOG): josh's own PATCH /product/:id with only images — files to add
 * and `removed_media_ids`. josh keeps at most 3 images, stores them in its media storage, makes thumbnails.
 */
function ProductImages({ p, onSaved }: { p: JoshProductDetailType; onSaved: (msg: string) => void }) {
  const images = p.media.filter((m) => m.media_type === 'image');
  const [removed, setRemoved] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const keep = images.filter((m) => !removed.includes(m.id)).length;
  const dirty = files.length > 0 || removed.length > 0;
  async function save() {
    if (keep + files.length > 3) return setErr('รูปได้สูงสุด 3 รูป (josh)');
    if (!window.confirm(`${files.length ? `เพิ่ม ${files.length} รูป` : ''}${files.length && removed.length ? ' · ' : ''}${removed.length ? `ลบ ${removed.length} รูป` : ''} ของ ${p.product_inventory_sku}? หน้าร้าน josh เห็นทันที`)) return;
    setBusy(true);
    setErr('');
    try {
      const fields = { removed_media_ids: JSON.stringify(removed) };
      await (files.length
        ? joshAdmin.upload('PATCH', `/product/${p.product_inventory_id}`, fields, files.map((file) => ({ field: 'images', file })))
        : joshAdmin.call('PATCH', `/product/${p.product_inventory_id}`, fields));
      setRemoved([]);
      setFiles([]);
      onSaved(`บันทึกรูปของ ${p.product_inventory_sku} แล้ว`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHead
        icon="photo_library"
        title="รูปสินค้า"
        sub={`${keep}/3 รูป`}
        actions={dirty && (
          <>
            <Button variant="ghost" size="sm" onClick={() => { setFiles([]); setRemoved([]); setErr(''); }}>ยกเลิก</Button>
            <Button variant="primary" size="sm" icon="cloud_upload" disabled={busy} onClick={save}>{busy ? 'กำลังอัปโหลด…' : 'บันทึกรูป'}</Button>
          </>
        )}
      />
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          {images.map((m) => {
            const gone = removed.includes(m.id);
            return (
              <figure key={m.id} className={`m-0 space-y-1 ${gone ? 'opacity-35' : ''}`}>
                <img src={m.source} alt="" width={120} height={120} className="object-cover rounded border border-secondary-container bg-surface-container-low w-[120px] h-[120px]" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                <figcaption>
                  <Button variant={gone ? 'ghost' : 'danger-ghost'} size="sm" icon={gone ? 'undo' : 'delete'} onClick={() => setRemoved(gone ? removed.filter((x) => x !== m.id) : [...removed, m.id])}>
                    {gone ? 'ไม่ลบ' : 'ลบ'}
                  </Button>
                </figcaption>
              </figure>
            );
          })}
          {!images.length && <Hint>ยังไม่มีรูป</Hint>}
        </div>
        <Field label="เพิ่มรูป" hint={files.length ? files.map((f) => f.name).join(', ') : 'jpg / png / webp / gif — รวมแล้วไม่เกิน 3 รูป'}>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="text-xs file:mr-3 file:rounded-lg file:border file:border-secondary-container file:bg-surface-container-lowest file:px-3 file:py-1.5 file:text-xs" />
        </Field>
        {err && <Alert tone="danger">{err}</Alert>}
      </div>
    </Panel>
  );
}
