// ui-metadata-migration: static labels and UI notices only
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert, Button, Empty, ErrorText, Field, FormPanel, Input, KeyValueGrid, Loading, Modal, Page, PageHeader, Panel, PanelHead, Span, Stack2,
  StatusChip, TBody, TD, TH, THead, TR, Table, Textarea, fmt,
} from '@cp/ui';
import { api, InventoryLevel, Paginated, Product, productsApi, stockApi, session } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Form = { sku: string; name: string; description: string };
const toForm = (p: Product): Form => ({ sku: p.sku, name: p.name, description: p.description ?? '' });

/** One commerce product: facts, edit (PATCH /products/:id) and stock per warehouse. */
export function ProductDetail() {
  __useUiLocale();
  const canEdit = ['admin', 'merchandising'].includes(session.claims()?.role ?? '');
  const { id = '' } = useParams();
  const product = useAsync<Product>(() => productsApi.get(id), [id]);
  const inventory = useAsync(() => api.get<Paginated<InventoryLevel>>(`/inventory?productId=${encodeURIComponent(id)}&pageSize=100`), [id]);
  const warehouses = useAsync(() => canEdit ? stockApi.warehouses() : Promise.resolve([]), []);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>({ sku: '', name: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const p = product.data;
  useEffect(() => { if (p) setForm(toForm(p)); }, [p]);

  async function save() {
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
        back={{ to: '/products', label: 'แคตตาล็อกแพลตฟอร์ม' }}
        title={p?.name ?? __uiText("รายละเอียดสินค้า")}
        badge={p && <StatusChip status={p.status} />}
        subtitle={p && <span className="font-mono">{p.sku}</span>}
        actions={
          <>
            <Button icon="refresh" onClick={() => { product.reload(); inventory.reload(); warehouses.reload(); }}>{__uiText("รีเฟรช")}</Button>
            {p && canEdit && <Button icon="edit" variant="primary" onClick={() => setEditing(true)}>{__uiText("แก้ไขสินค้า")}</Button>}
          </>
        }
      />

      {msg && <Alert tone="ok" onClose={() => setMsg('')}>{(typeof msg === 'string' ? __uiText(msg) : msg)}</Alert>}
      <ErrorText error={product.error} />

      {product.loading && !p ? (
        <Loading />
      ) : p ? (
        <>
          {editing && <Modal title={__uiText("แก้ไขสินค้า")} onClose={cancelEdit} width={640}>
            <FormPanel title={__uiText("ข้อมูลสินค้า")} icon="edit" busy={busy} error={error} onSubmit={save} onCancel={cancelEdit}>
              <Field label={__uiText("SKU")}><Input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
              <Field label={__uiText("ชื่อสินค้า")}><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Span><Field label={__uiText("รายละเอียด")}><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field></Span>
            </FormPanel>
          </Modal>}
            <Panel className="p-4">
              <KeyValueGrid
                items={[
                  { label: 'SKU', value: p.sku, mono: true },
                  { label: __uiText("รูปแบบจัดส่ง"), value: p.fulfillmentMode ?? '—' },
                  { label: __uiText("ระยะเวลาเตรียมสินค้า"), value: p.leadTimeDays !== null && p.leadTimeDays !== undefined ? __uiText('{0} วัน', {'0': p.leadTimeDays}) : '—' },
                  { label: __uiText("อัปเดตล่าสุด"), value: p.updatedAt ? fmt.when(p.updatedAt) : '—' },
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
                        <TD>{warehouse ? <Stack2 top={warehouse.name} bottom={warehouse.code} /> : <span className="font-mono">{l.warehouseId}</span>}</TD>
                        <TD kind="num">{fmt.num(l.quantity)}</TD>
                        <TD kind="num">{fmt.num(l.reserved)}</TD>
                        <TD kind="num" className={available <= 0 ? 'text-[#c2333f] font-semibold' : undefined}>{fmt.num(available)}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            ) : (
              <Empty icon="warehouse">{__uiText("ยังไม่มีสต็อกที่บันทึกไว้")}</Empty>
            )}
          </Panel>
        </>
      ) : null}
    </Page>
  );
}
