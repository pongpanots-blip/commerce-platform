import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Button, Empty, ErrorText, Field, FormPanel, Input, KeyValueGrid, Loading, Page, PageHeader, Panel, PanelHead, RowLink,
  StatusChip, TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { api, customersApi, Customer, OrderRow, Paginated } from '../../lib/api';
import { useAsync } from '../hooks';

type Form = { name: string; code: string; email: string; phone: string };
const toForm = (c: Customer): Form => ({ name: c.name, code: c.code ?? '', email: c.email ?? '', phone: c.phone ?? '' });

/** One commerce customer: facts, edit (PATCH /customers/:id) and their orders. */
export function CustomerDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const customer = useAsync<Customer>(() => customersApi.get(id), [id]);
  const orders = useAsync(() => api.get<Paginated<OrderRow>>(`/orders?customerId=${encodeURIComponent(id)}&pageSize=100`), [id]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>({ name: '', code: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const c = customer.data;
  useEffect(() => { if (c) setForm(toForm(c)); }, [c]);

  async function save() {
    if (!window.confirm(`Save changes to ${c?.name}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await customersApi.update(id, { name: form.name.trim(), code: form.code.trim() || null, email: form.email.trim() || null, phone: form.phone.trim() || null });
      setMsg('Saved');
      setEditing(false);
      customer.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const list = orders.data?.items ?? [];
  const spent = list.reduce((sum, o) => sum + Number(o.total || 0), 0);

  return (
    <Page>
      <PageHeader
        back={{ to: '/customers', label: 'Customers' }}
        title={c?.name ?? 'Customer'}
        badge={c && <StatusChip status={c.status} />}
        subtitle={c?.code && <span className="font-mono">{c.code}</span>}
        actions={
          <>
            {c && !editing && <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
            <Button icon="refresh" onClick={() => { customer.reload(); orders.reload(); }}>Refresh</Button>
          </>
        }
      />

      {msg && <Alert tone="ok" onClose={() => setMsg('')}>{msg}</Alert>}
      <ErrorText error={customer.error} />

      {customer.loading && !c ? (
        <Loading />
      ) : c ? (
        <>
          {editing ? (
            <FormPanel title="Edit customer" icon="edit" busy={busy} error={error} onSubmit={save} onCancel={() => { setEditing(false); setForm(toForm(c)); setError(null); }}>
              <Field label="Name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Code"><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
              <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            </FormPanel>
          ) : (
            <Panel className="p-4">
              <KeyValueGrid
                items={[
                  { label: 'Code', value: c.code ?? '—', mono: true },
                  { label: 'Email', value: c.email ?? '—' },
                  { label: 'Phone', value: c.phone ?? '—' },
                  { label: 'Customer ID', value: c.id, mono: true },
                  { label: 'Orders', value: orders.data ? fmt.num(orders.data.total) : '…' },
                  { label: 'Order value (shown)', value: list.length ? `${list[0].currency} ${fmt.num(spent.toFixed(2))}` : '—' },
                ]}
              />
            </Panel>
          )}

          <Panel className="overflow-hidden">
            <PanelHead icon="receipt_long" title="Orders" sub={orders.data && `${fmt.num(orders.data.total)} total`} />
            <ErrorText error={orders.error} />
            {orders.loading && !orders.data ? (
              <Loading />
            ) : list.length ? (
              <Table>
                <THead>
                  <TH>Code</TH>
                  <TH>Status</TH>
                  <TH right>Total</TH>
                  <TH>Created</TH>
                </THead>
                <TBody>
                  {list.map((o) => (
                    <TR key={o.id} onClick={() => navigate(`/orders/${o.id}`)}>
                      <TD><RowLink to={`/orders/${o.id}`}>{o.code ?? `${o.id.slice(0, 8)}…`}</RowLink></TD>
                      <TD><StatusChip status={o.status} /></TD>
                      <TD kind="money">{o.currency} {fmt.num(o.total)}</TD>
                      <TD kind="time">{fmt.when(o.createdAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <Empty icon="receipt_long">No orders yet</Empty>
            )}
          </Panel>
        </>
      ) : null}
    </Page>
  );
}
