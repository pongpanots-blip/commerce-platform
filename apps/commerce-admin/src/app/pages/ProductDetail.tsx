// ui-metadata-migration: static labels and UI notices only
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert, Button, Empty, ErrorText, Field, FormPanel, Input, KeyValueGrid, Loading, Modal, Page, PageHeader, Panel, PanelHead, Span, Stack2,
  StatusChip, TBody, TD, TH, THead, TR, Table, Textarea, fmt,
} from '@cp/ui';
import { productFields, missingRequired } from './catalog-fields';
import { api, InventoryLevel, Paginated, Product, productPricesApi, productsApi, stockApi, session } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Form = { sku: string; name: string; description: string };
const FULFILLMENT: Record<string, string> = { on_hand: 'ส่งจากสต็อกในคลัง', to_order: 'สั่งเข้าหลังลูกค้าสั่งซื้อ', both: 'ส่งจากสต็อก หรือสั่งเข้าเมื่อหมด' };
const toForm = (p: Product): Form => ({ sku: p.sku, name: p.name, description: p.description ?? '' });

/** One commerce product: facts, edit (PATCH /products/:id) and stock per warehouse. */
export function ProductDetail() {
  __useUiLocale();
  const canEdit = ['admin', 'merchandising'].includes(session.claims()?.role ?? '');
  const { id = '' } = useParams();
  const product = useAsync<Product>(() => productsApi.get(id), [id]);
  const inventory = useAsync(() => api.get<Paginated<InventoryLevel>>(`/inventory?productId=${encodeURIComponent(id)}&pageSize=100`), [id]);
  const warehouses = useAsync(() => canEdit ? stockApi.warehouses() : Promise.resolve([]), []);
  const sku = product.data?.sku;
  // Prices are a merchandising API; other roles see the product without them.
  const price = useAsync(async () => canEdit && sku ? (await productPricesApi.list(sku, 1, 20)).items.find(row => row.sku === sku) ?? null : null, [sku]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>({ sku: '', name: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const p = product.data;
  useEffect(() => { if (p) setForm(toForm(p)); }, [p]);

  async function save() {
    const missing = missingRequired(productFields, form);
    if (missing) { setError(missing); return; }
    if (!window.confirm(__uiText("บันทึกการแก้ไขสินค้า {0}?", {"0": p?.sku}))) return;
    setBusy(true);
    setError(null);
    try {
      await productsApi.update(id, { sku: form.sku.trim(), name: form.name.trim(), description: form.description.trim() || null });
      setMsg(__uiMessage("บันทึกการแก้ไขสินค้าเรียบร้อยแล้ว"));
      setEditing(false);
      product.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const levels = inventory.data?.items ?? [];
  const totals = levels.reduce((t, l) => ({ qty: t.qty + Number(l.quantity), reserved: t.reserved + Number(l.reserved) }), { qty: 0, reserved: 0 });
  function cancelEdit() {
    if (busy) return;
    setEditing(false);
    if (p) setForm(toForm(p));
    setError(null);
  }

  return (
    <Page>
      <PageHeader
        back={{ to: '/products', label: 'ค้นหาสินค้าตามรหัส' }}
        title={p?.name ?? __uiText("รายละเอียดสินค้า")}
        badge={p && <StatusChip status={p.status} />}
        subtitle={p && <span className="font-mono">{p.sku}</span>}
        actions={<>
          <Button icon="refresh" onClick={() => { product.reload(); inventory.reload(); warehouses.reload(); }}>{__uiText("รีเฟรช")}</Button>
          {p && canEdit && <Button icon="edit" variant="primary" onClick={() => setEditing(true)}>{__uiText("แก้ไขสินค้า")}</Button>}
        </>}
      />

      {msg && <Alert tone="ok" onClose={() => setMsg('')}>{(typeof msg === 'string' ? __uiText(msg) : msg)}</Alert>}
      <ErrorText error={product.error} />

      {product.loading && !p ? (
        <Loading />
      ) : p ? (
        <>
          {editing && <Modal title={__uiText("แก้ไขสินค้า")} onClose={cancelEdit} width={640}>
            <FormPanel title={__uiText("ข้อมูลสินค้า")} description={__uiText("ช่องเดียวกับตอนเพิ่มสินค้า")} icon="edit" submitLabel={__uiText("บันทึกสินค้า")} busy={busy} error={error} onSubmit={save} onCancel={cancelEdit}>
              {productFields.map((f) => {
                const key = f.name as keyof Form;
                const control = f.type === 'textarea'
                  ? <Textarea mono={false} rows={3} placeholder={f.placeholder} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
                  : <Input placeholder={f.placeholder} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />;
                const field = <Field key={f.name} label={f.label} required={f.required} hint={f.hint}>{control}</Field>;
                return f.type === 'textarea' ? <Span key={f.name}>{field}</Span> : field;
              })}
            </FormPanel>
          </Modal>}
            <Panel className="p-4">
              <KeyValueGrid
                items={[
                  { label: __uiText('รหัสสินค้า'), value: p.sku, mono: true, copy: true },
                  { label: __uiText("รูปแบบจัดส่ง"), value: p.fulfillmentMode ? (FULFILLMENT[p.fulfillmentMode] ? __uiText(FULFILLMENT[p.fulfillmentMode]) : p.fulfillmentMode) : '—' },
                  { label: __uiText("ระยะเวลาเตรียมสินค้า"), value: p.leadTimeDays !== null && p.leadTimeDays !== undefined ? __uiText('{0} วัน', {'0': p.leadTimeDays}) : '—' },
                  { label: __uiText("อัปเดตล่าสุด"), value: p.updatedAt ? fmt.when(p.updatedAt) : '—' },
                  ...(canEdit ? [
                    { label: __uiText("ราคาขายต่อหน่วย"), value: price.loading ? '…' : price.error ? __uiText("โหลดราคาไม่ได้") : price.data?.selling_unit_price != null ? fmt.baht(price.data.selling_unit_price) : __uiText("ยังไม่มีราคา") },
                    { label: __uiText("ราคาสั่งซื้อ"), value: price.loading ? '…' : price.data?.ordering_price != null ? fmt.baht(price.data.ordering_price) : '—' },
                    { label: __uiText("สั่งขั้นต่ำ"), value: price.loading ? '…' : price.data?.moq != null ? fmt.num(price.data.moq) : '—' },
                  ] : []),
                  { label: __uiText("รายละเอียด"), value: p.description || '—', wide: true },
                ]}
              />
            </Panel>

          <Panel className="overflow-hidden">
            <PanelHead
              icon="warehouse"
              title={__uiText("สต็อกแยกตามคลัง")}
              sub={inventory.data && __uiText("แสดง {0} จาก {1} รายการ · ยอดในรายการที่แสดง: คงเหลือ {2} · จอง {3} · พร้อมใช้ {4}",{'0':levels.length,'1':inventory.data.total,'2':fmt.num(totals.qty),'3':fmt.num(totals.reserved),'4':fmt.num(totals.qty - totals.reserved)})}
            />
            <ErrorText error={inventory.error} />
            {inventory.loading && !inventory.data ? (
              <Loading />
            ) : inventory.error && !inventory.data ? null : levels.length ? (
              <Table>
                <THead>
                  <TH>{__uiText("คลังสินค้า")}</TH>
                  <TH right>{__uiText("คงเหลือ")}</TH>
                  <TH right>{__uiText("จองแล้ว")}</TH>
                  <TH right>{__uiText("พร้อมใช้")}</TH>
                </THead>
                <TBody>
                  {levels.map((l) => {
                    const available = Number(l.quantity) - Number(l.reserved);
                    const warehouse = warehouses.data?.find(item => item.id === l.warehouseId);
                    return (
                      <TR key={l.id}>
                        <TD>{warehouse ? <Stack2 top={warehouse.name} bottom={warehouse.code !== warehouse.name ? warehouse.code : undefined} /> : <span className="font-mono">{l.warehouseId}</span>}</TD>
                        <TD kind="num">{fmt.num(l.quantity)}</TD>
                        <TD kind="num">{fmt.num(l.reserved)}</TD>
                        <TD kind="num" className={available <= 0 ? 'text-danger font-semibold' : undefined}>{fmt.num(available)}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            ) : (
              <Empty icon="warehouse">{__uiText("ยังไม่มีสต็อกที่บันทึกไว้ บันทึกรับเข้าได้ที่หน้ารับเข้า ปรับ และโอนสต็อก")}</Empty>
            )}
          </Panel>
        </>
      ) : null}
    </Page>
  );
}
