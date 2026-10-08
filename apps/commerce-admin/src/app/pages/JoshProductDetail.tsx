// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-caption-migration: literal captions only
// ui-metadata-migration: static labels and UI notices only
import { FormEvent, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import {
  Alert, Button, Chip, DetailSection, Empty, ErrorText, Field, FormPanel, Hint, Input, KeyValueGrid, Loading,
  Page, PageHeader, Panel, PanelHead, Select, Span, Textarea,
  TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { joshActionsApi, joshAdmin, joshProductApi, JoshProductDetail as JoshProductDetailType, orderingApi, productContentsApi, productImagesApi, productMastersApi, productPricesApi } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const STATUS: Record<string, string> = { active: 'เปิดขาย', draft: 'draft (ยังไม่เปิด)', inactive: 'ปิด' };
const show = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Stage 4f: josh's weekday rows → "MONDAY,FRIDAY" (empty = every day); restock date → YYYY-MM-DD. */
const days = (v: unknown) => (Array.isArray(v) ? v.map((d) => (typeof d === 'object' && d ? (d as { day?: string }).day : d)).join(',') : v);
const day = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : v);

/** `ordering`: only editable once commerce owns ordering (josh's own form has no such field). */
const EDIT_FIELDS: { key: string; label: string; get: (p: JoshProductDetailType) => unknown; kind?: 'number' | 'text' | 'long'; norm?: (v: unknown) => unknown; ordering?: boolean }[] = [
  { key: 'product_name_th', get label(){return __uiText("ชื่อ (ไทย)");}, get: (p) => p.name_th },
  { key: 'product_name_en', get label(){return __uiText("ชื่อ (อังกฤษ)");}, get: (p) => p.name_en },
  { key: 'product_description_th', get label(){return __uiText("รายละเอียด (ไทย)");}, get: (p) => p.description_th, kind: 'long' },
  { key: 'product_description_en', get label(){return __uiText("รายละเอียด (อังกฤษ)");}, get: (p) => p.description_en, kind: 'long' },
  { key: 'brand_name', get label(){return __uiText("แบรนด์");}, get: (p) => p.brand_name },
  { key: 'selling_unit', get label(){return __uiText("หน่วยขาย");}, get: (p) => p.selling_unit },
  { key: 'pack_size', get label(){return __uiText("ขนาดแพ็ก");}, get: (p) => p.pack_size },
  { key: 'storage_temperature', get label(){return __uiText("อุณหภูมิเก็บ");}, get: (p) => p.storage_temperature },
  { key: 'selling_unit_price', get label(){return __uiText("ราคาขาย (รวม VAT)");}, get: (p) => p.selling_unit_price, kind: 'number' },
  { key: 'original_price', get label(){return __uiText("ราคาตั้ง");}, get: (p) => p.original_price, kind: 'number' },
  { key: 'low_stock_threshold', get label(){return __uiText("เตือนใกล้หมดที่");}, get: (p) => p.low_stock_threshold, kind: 'number' },
  { key: 'reorder_quantity', get label(){return __uiText("จำนวนสั่งเติม");}, get: (p) => p.reorder_quantity, kind: 'number' },
  { key: 'buying_price', get label(){return __uiText("ต้นทุน");}, get: (p) => p.buying_price, kind: 'number' },
  { key: 'product_short_code', get label(){return __uiText("รหัสย่อ");}, get: (p) => p.product_short_code },
  { key: 'maximum_shelf_life', get label(){return __uiText("อายุสินค้าสูงสุด");}, get: (p) => p.maximum_shelf_life },
  { key: 'is_organic', get label(){return __uiText("ออร์แกนิก");}, get: (p) => p.is_organic },
  { key: 'ingredients', get label(){return __uiText("ส่วนผสม");}, get: (p) => p.ingredients, kind: 'long' },
  { key: 'allergens', get label(){return __uiText("สารก่อภูมิแพ้");}, get: (p) => p.allergens, kind: 'long' },
  { key: 'expiration_info', get label(){return __uiText("ข้อมูลวันหมดอายุ");}, get: (p) => p.expiration_info, kind: 'long' },
  { key: 'usage_direction', get label(){return __uiText("วิธีใช้");}, get: (p) => p.usage_direction, kind: 'long' },
  { key: 'best_paired_food', get label(){return __uiText("เข้ากับอาหาร");}, get: (p) => p.best_paired_food, kind: 'long' },
  { key: 'unit_ratio', get label(){return __uiText("อัตราส่วนหน่วย");}, get: (p) => p.unit_ratio },
  { key: 'sub_packing_unit', get label(){return __uiText("หน่วยแพ็กย่อย");}, get: (p) => p.sub_packing_unit },
  { key: 'product_unit', get label(){return __uiText("หน่วยสินค้า");}, get: (p) => p.product_unit },
  { key: 'expected_restock_at', get label(){return __uiText("คาดว่าของเข้า (YYYY-MM-DD)");}, get: (p) => p.expected_restock_at, norm: day },
  { key: 'delivery_dates', get label(){return __uiText("วันที่ส่งได้ (MONDAY,FRIDAY … ว่าง = ทุกวัน)");}, get: (p) => p.delivery_dates, norm: days, ordering: true },
];

/**
 * `content`: commerce's own copy of the content keys once it owns product content (stage 4b) — shown over josh's copy,
 * which follows a moment later.
 */
function ProductEditor({ p, content, ordering, categories, onSaved, onClose }: { p: JoshProductDetailType; content: Record<string, unknown> | null; ordering: boolean; categories: { id: string; category_name_th: string | null; category_path: string | null }[]; onSaved: (msg: string) => void; onClose: () => void }) {
  __useUiLocale();
  const shown = EDIT_FIELDS.filter((f) => !f.ordering || ordering);
  const valueOf = (f: (typeof EDIT_FIELDS)[number]) => {
    const v = content && f.key in content ? content[f.key] : f.get(p);
    return f.norm ? f.norm(v) : v;
  };
  const initial = (): Record<string, string> => ({
    ...Object.fromEntries(shown.map((f) => [f.key, valueOf(f) == null ? '' : String(valueOf(f))])),
    product_status: String((content && 'product_status' in content ? content.product_status : p.product_status) ?? ''), category_id: p.category_id ?? '',
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
    if (!window.confirm(__uiText("บันทึก {0} ช่องของ {1}?\n\n{2}\n\n(josh บันทึกในนามของคุณ — josh บันทึกอีเมลคุณไว้ใน audit · หน้าร้านเห็นทันที)", {"0": changed.length, "1": p.product_inventory_sku, "2": changed.join(', ')}))) return;
    setBusy(true); setErr('');
    try { await joshActionsApi.updateProduct(p.product_inventory_id, fields); onClose(); onSaved(`บันทึก ${p.product_inventory_sku} แล้ว (${changed.join(', ')})`); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <FormPanel
      title={__uiText("แก้สินค้า {0}", {"0": p.product_inventory_sku})}
      icon="edit"
      cols={2}
      error={err}
      busy={busy}
      onSubmit={save}
      onCancel={onClose}
      submitLabel={__uiText("บันทึก{0}", {"0": changed.length ? ` (${changed.length})` : ''})}
      description={content
        ? __uiText("ชื่อ รายละเอียด ส่วนผสม ต้นทุน ฯลฯ เก็บที่ commerce แล้วส่งให้ josh (ช่องว่าง = ล้างค่า ยกเว้นชื่อ) · ช่องอื่นยังบันทึกที่ josh (ช่องว่างไม่ลบค่าเดิม) · ราคาลูกค้า/สัญญาแก้ที่หน้า ราคาพนักงาน")
        : __uiText("ช่องว่างไม่ลบค่าเดิม (josh ข้ามค่าว่าง) · ราคาลูกค้า/สัญญาแก้ที่หน้า ราคาพนักงาน")}
    >
      <Field label={__uiText("สถานะ")}>
        <Select value={v.product_status} onChange={(e) => setV({ ...v, product_status: e.target.value })}>
          {Object.entries(STATUS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          {!(v.product_status in STATUS) && <option value={v.product_status}>{v.product_status || '—'}</option>}
        </Select>
      </Field>
      <Field label={__uiText("หมวด")}>
        <Select value={v.category_id} onChange={(e) => setV({ ...v, category_id: e.target.value })}>
          <option value="">{__uiText("— ไม่มีหมวด —")}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.category_path ?? c.category_name_th}</option>)}
        </Select>
      </Field>
      {shown.map((f) => (
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
  __useUiLocale();
  const { id = '' } = useParams();
  const location = useLocation();
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const detail = useAsync(() => joshProductApi.detail(id), [id]);
  const categories = useAsync(() => joshProductApi.categories(), []);
  const p = detail.data;
  // Stage 4b / 4d / 4f: commerce's content, ERP master and logistics rows (none yet → josh's values stand). Category stays josh's id.
  const content = useAsync(async () => {
    const owned = p ? await productPricesApi.ownership() : null;
    if (!p || !owned || (!owned.productContent && !owned.productMaster && !owned.ordering)) return { fields: null, ordering: false };
    const [c, m, l] = await Promise.all([
      owned.productContent ? productContentsApi.get(p.product_inventory_sku).then((r) => r.fields, () => ({})) : {},
      owned.productMaster ? productMastersApi.get(p.product_inventory_sku).then((r) => r.fields, () => ({})) : {},
      owned.ordering ? orderingApi.logistics(p.product_inventory_sku).then((r) => r.fields, () => ({})) : {},
    ]);
    return { fields: { ...c, ...m, ...l }, ordering: !!owned.ordering };
  }, [p?.product_inventory_sku, p?.updated_at]);

  const backTo = `${location.state?.from ?? '/reports/products'}${location.state?.search ?? ''}`;

  async function decide(action: 'approve' | 'reject') {
    if (!p) return;
    const verb = action === 'approve' ? 'อนุมัติ' : 'ไม่อนุมัติ';
    if (!window.confirm(__uiText("{0}ข้อมูลจาก ERP ของสินค้า {1}?\n\n{2} (josh ทำในนามของคุณ — josh บันทึกอีเมลคุณไว้ใน audit)", {"0": verb, "1": p.product_inventory_sku, "2": action === 'approve' ? 'สินค้า draft จะขึ้นขาย และค่าที่ ERP ส่งมาจะใช้ทันที' : 'ค่าที่ ERP ส่งมาจะถูกทิ้ง สินค้าคงค่าเดิม'}))) return;
    setBusy(true); setMsg('');
    try {
      const r = action === 'approve' ? await joshActionsApi.approveProducts([p.product_inventory_id]) : await joshActionsApi.rejectProducts([p.product_inventory_id]);
      setMsg(__uiMessage("{0}แล้ว: {1}", {"0": verb, "1": JSON.stringify(r)})); detail.reload(); categories.reload();
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
        actions={p && !editing && <Button icon="edit" onClick={() => setEditing(true)}>{__uiText("แก้ข้อมูลสินค้า")}</Button>}
      />

      <ErrorText error={detail.error} />
      {msg && <div className="px-4 py-2 text-xs text-on-surface-variant bg-surface-container-low">{(typeof msg === 'string' ? __uiText(msg) : msg)}</div>}

      {detail.loading && !p ? (
        <Loading />
      ) : !p ? (
        <Panel><Empty>{__uiText("ไม่พบสินค้า")}</Empty></Panel>
      ) : (
        <>
          <ProductImages p={p} onSaved={(m) => { setMsg(m); detail.reload(); }} />

          <Panel>
            <div className="p-4 text-xs text-on-surface-variant">
              {__uiText("ราคา: ขาย ")}{fmt.baht(p.selling_unit_price)} {__uiText(" · สั่ง ")}{fmt.baht(p.ordering_price)} {__uiText(" · ตั้ง ")}{fmt.baht(p.original_price)} {__uiText(" · MOQ ")}{show(p.moq)} {__uiText(" · supplier ")}{show(p.sup_code)} {__uiText(" · เก็บ ")}{show(p.storage_temperature)} {__uiText(" · ประเทศ ")}{show(p.country_code_source)} {__uiText(" · VAT ")}{show(p.vat_type)}
            </div>
          </Panel>

          {editing && !content.loading && <ProductEditor key={p.updated_at} p={p} content={content.data?.fields ?? null} ordering={!!content.data?.ordering} categories={categories.data ?? []} onClose={() => setEditing(false)} onSaved={(m) => { setMsg(m); detail.reload(); content.reload(); }} />}

          {p.pendingChanges && p.pendingChanges.length > 0 && (
            <Panel>
              <div className="space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-on-surface-variant">{__uiText("ERP ส่งมาเมื่อ ")}{new Date(p.erp_pending_at!).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'))} {__uiText(" — รออนุมัติ:")}</span>
                  <Button size="sm" disabled={busy} onClick={() => decide('approve')}>{__uiText("อนุมัติ")}</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide('reject')}>{__uiText("ไม่อนุมัติ")}</Button>
                </div>
                <Table>
                  <THead>
                    <TH>{__uiText("ฟิลด์ ERP")}</TH>
                    <TH>{__uiText("ตอนนี้")}</TH>
                    <TH>{__uiText("ERP ส่งมา")}</TH>
                  </THead>
                  <TBody>
                    {p.pendingChanges.map((c) => (
                      <TR key={c.field}>
                        <TD kind="code">{c.field}</TD>
                        <TD>{show(c.current)}</TD>
                        <TD>
                          {c.changed ? <strong>{show(c.pending)}</strong> : show(c.pending)}
                          {c.changed && <Chip tone="warn" className="ml-2">{__uiText("เปลี่ยน")}</Chip>}
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
 * Product images. Before stage 4e (COMMERCE_OWNS_CATALOG): josh's own PATCH /product/:id with only images — files to add
 * and `removed_media_ids`; josh keeps at most 3, stores them, makes thumbnails. Once commerce owns galleries
 * (COMMERCE_OWNS_PRODUCT_IMAGES): commerce's gallery (same bucket), sent to josh as product.images.snapshot.
 */
function ProductImages({ p, onSaved }: { p: JoshProductDetailType; onSaved: (msg: string) => void }) {
  __useUiLocale();
  const gallery = useAsync(async () => {
    if (!(await productPricesApi.ownership()).productImages) return null;
    return productImagesApi.get(p.product_inventory_sku).then((r) => r.images, () => p.media.filter((m) => m.media_type === 'image').map((m) => m.source));
  }, [p.product_inventory_sku, p.updated_at]);
  const owned = gallery.data != null;
  const images = owned ? gallery.data!.map((url) => ({ id: url, source: url, media_type: 'image', sort_order: 0 })) : p.media.filter((m) => m.media_type === 'image');
  const [removed, setRemoved] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const keep = images.filter((m) => !removed.includes(m.id)).length;
  const dirty = files.length > 0 || removed.length > 0;
  async function save() {
    if (keep + files.length > 3) return setErr('รูปได้สูงสุด 3 รูป (josh)');
    if (!window.confirm(__uiText("{0}{1}{2} ของ {3}? หน้าร้าน josh เห็นทันที", {"0": files.length ? `เพิ่ม ${files.length} รูป` : '', "1": files.length && removed.length ? ' · ' : '', "2": removed.length ? `ลบ ${removed.length} รูป` : '', "3": p.product_inventory_sku}))) return;
    setBusy(true);
    setErr('');
    try {
      if (owned) {
        // Remove first so the 3-image limit counts what stays.
        if (removed.length) await productImagesApi.set(p.product_inventory_sku, images.filter((m) => !removed.includes(m.id)).map((m) => m.source));
        if (files.length) await productImagesApi.upload(p.product_inventory_sku, files);
        gallery.reload();
      } else {
        const fields = { removed_media_ids: JSON.stringify(removed) };
        await (files.length
          ? joshAdmin.upload('PATCH', `/product/${p.product_inventory_id}`, fields, files.map((file) => ({ field: 'images', file })))
          : joshAdmin.call('PATCH', `/product/${p.product_inventory_id}`, fields));
      }
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
        title={__uiText("รูปสินค้า")}
        sub={__uiText("{0}/3 รูป",{'0':keep})}
        actions={dirty && (
          <>
            <Button variant="ghost" size="sm" onClick={() => { setFiles([]); setRemoved([]); setErr(''); }}>{__uiText("ยกเลิก")}</Button>
            <Button variant="primary" size="sm" icon="cloud_upload" disabled={busy} onClick={save}>{busy ? __uiText("กำลังอัปโหลด…") : __uiText("บันทึกรูป")}</Button>
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
                    {gone ? __uiText("ไม่ลบ") : __uiText("ลบ")}
                  </Button>
                </figcaption>
              </figure>
            );
          })}
          {!images.length && <Hint>{__uiText("ยังไม่มีรูป")}</Hint>}
        </div>
        <Field label={__uiText("เพิ่มรูป")} hint={files.length ? files.map((f) => f.name).join(', ') : __uiText("jpg / png / webp / gif — รวมแล้วไม่เกิน 3 รูป")}>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="text-xs file:mr-3 file:rounded-lg file:border file:border-secondary-container file:bg-surface-container-lowest file:px-3 file:py-1.5 file:text-xs" />
        </Field>
        {err && <Alert tone="danger">{err}</Alert>}
      </div>
    </Panel>
  );
}
