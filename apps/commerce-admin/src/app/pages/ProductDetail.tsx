import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert, Button, Empty, ErrorText, Field, FormPanel, Input, KeyValueGrid, Loading, Page, PageHeader, Panel, PanelHead, Span,
  StatusChip, TBody, TD, TH, THead, TR, Table, Textarea, fmt,
} from '@cp/ui';
import { api, InventoryLevel, Paginated, Product, productsApi } from '../../lib/api';
import { useAsync } from '../hooks';

type Form = { sku: string; name: string; description: string };
const toForm = (p: Product): Form => ({ sku: p.sku, name: p.name, description: p.description ?? '' });

/** One commerce product: facts, edit (PATCH /products/:id) and stock per warehouse. */
export function ProductDetail() {
  const { id = '' } = useParams();
  const product = useAsync<Product>(() => productsApi.get(id), [id]);
  const inventory = useAsync(() => api.get<Paginated<InventoryLevel>>(`/inventory?productId=${encodeURIComponent(id)}&pageSize=100`), [id]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>({ sku: '', name: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const p = product.data;
  useEffect(() => { if (p) setForm(toForm(p)); }, [p]);

  async function save() {
    if (!window.confirm(`Save changes to ${p?.sku}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await productsApi.update(id, { sku: form.sku.trim(), name: form.name.trim(), description: form.description.trim() || null });
      setMsg('Saved');
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

  return (
    <Page>
      <PageHeader
        back={{ to: '/products', label: 'Products' }}
        title={p?.name ?? 'Product'}
        badge={p && <StatusChip status={p.status} />}
        subtitle={p && <span className="font-mono">{p.sku}</span>}
        actions={
          <>
            {p && !editing && <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
            <Button icon="refresh" onClick={() => { product.reload(); inventory.reload(); }}>Refresh</Button>
          </>
        }
      />

      {msg && <Alert tone="ok" onClose={() => setMsg('')}>{msg}</Alert>}
      <ErrorText error={product.error} />

      {product.loading && !p ? (
        <Loading />
      ) : p ? (
        <>
          {editing ? (
            <FormPanel title="Edit product" icon="edit" busy={busy} error={error} onSubmit={save} onCancel={() => { setEditing(false); setForm(toForm(p)); setError(null); }}>
              <Field label="SKU"><Input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
              <Field label="Name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Span><Field label="Description"><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field></Span>
            </FormPanel>
          ) : (
            <Panel className="p-4">
              <KeyValueGrid
                items={[
                  { label: 'SKU', value: p.sku, mono: true },
                  { label: 'Fulfillment', value: p.fulfillmentMode ?? '—' },
                  { label: 'Lead time', value: p.leadTimeDays !== null && p.leadTimeDays !== undefined ? `${p.leadTimeDays} days` : '—' },
                  { label: 'Updated', value: p.updatedAt ? fmt.when(p.updatedAt) : '—' },
                  { label: 'Description', value: p.description || '—', wide: true },
                ]}
              />
            </Panel>
          )}

          <Panel className="overflow-hidden">
            <PanelHead
              icon="warehouse"
              title="Stock by warehouse"
              sub={levels.length > 0 && `on hand ${fmt.num(totals.qty)} · reserved ${fmt.num(totals.reserved)} · available ${fmt.num(totals.qty - totals.reserved)}`}
            />
            <ErrorText error={inventory.error} />
            {inventory.loading && !inventory.data ? (
              <Loading />
            ) : levels.length ? (
              <Table>
                <THead>
                  <TH>Warehouse</TH>
                  <TH right>Quantity</TH>
                  <TH right>Reserved</TH>
                  <TH right>Available</TH>
                </THead>
                <TBody>
                  {levels.map((l) => {
                    const available = Number(l.quantity) - Number(l.reserved);
                    return (
                      <TR key={l.id}>
                        <TD kind="mono">{l.warehouseId}</TD>
                        <TD kind="num">{fmt.num(l.quantity)}</TD>
                        <TD kind="num">{fmt.num(l.reserved)}</TD>
                        <TD kind="num" className={available <= 0 ? 'text-[#c2333f] font-semibold' : undefined}>{fmt.num(available)}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            ) : (
              <Empty icon="warehouse">No stock recorded</Empty>
            )}
          </Panel>
        </>
      ) : null}
    </Page>
  );
}
