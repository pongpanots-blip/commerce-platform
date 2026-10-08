import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, Empty, ErrorText, Field, FormPanel, Input, Loading, Page, PageHeader, Panel, PanelHead, Pager, StatusChip, TBody, TD, TH, THead, TR, Table, fmt, RowLink, Icon } from '@cp/ui';
import { api, ordersApi, OrderRow, Paginated, session } from '../../lib/api';
import { useAsync } from '../hooks';

interface LineForm {
  productId: string;
  qty: string;
  unitPrice: string;
}

const emptyLine: LineForm = { productId: '', qty: '', unitPrice: '' };

export function Orders() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { data, loading, error, reload } = useAsync(
    () => api.get<Paginated<OrderRow>>(`/orders?page=${page}&pageSize=${pageSize}`),
    [page],
  );

  const [customerId, setCustomerId] = useState('');
  const [lines, setLines] = useState<LineForm[]>([{ ...emptyLine }, { ...emptyLine }, { ...emptyLine }]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function updateLine(i: number, patch: Partial<LineForm>) {
    setLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const payload = {
        customerId,
        lines: lines
          .filter((l) => l.productId)
          .map((l) => ({
            productId: l.productId,
            qty: Number(l.qty),
            unitPrice: Number(l.unitPrice),
          })),
      };
      if (!payload.lines.length) {
        setFormError('Add at least one line.');
        setSubmitting(false);
        return;
      }
      await api.post('/orders', payload);
      setCustomerId('');
      setLines([{ ...emptyLine }, { ...emptyLine }, { ...emptyLine }]);
      if (page !== 1) setPage(1);
      else reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }


  const total = data?.total ?? 0;
  const readOnly = session.claims()?.role === 'business_analyst';

  return (
    <Page>
      <PageHeader
        title="Orders"
        subtitle="Create orders, walk checkout / payment, and inspect reservations."
        actions={<Button icon="refresh" variant="secondary" onClick={reload}>Refresh</Button>}
      />

      {!readOnly && <FormPanel
        title="New order"
        icon="add_circle"
        cols={3}
        error={formError}
        submitLabel="Create order"
        busy={submitting}
        onSubmit={submit}
      >
        <Field label="Customer ID">
          <Input
            required
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="uuid"
          />
        </Field>
        {lines.map((l, i) => (
          <div key={i} className="col-span-full grid grid-cols-3 gap-3">
            <Field label={i === 0 ? 'Product ID' : undefined}>
              <Input
                value={l.productId}
                onChange={(e) => updateLine(i, { productId: e.target.value })}
                placeholder="uuid"
              />
            </Field>
            <Field label={i === 0 ? 'Qty' : undefined}>
              <Input
                value={l.qty}
                onChange={(e) => updateLine(i, { qty: e.target.value })}
                placeholder="1"
              />
            </Field>
            <Field label={i === 0 ? 'Unit price' : undefined}>
              <Input
                value={l.unitPrice}
                onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                placeholder="0.00"
              />
            </Field>
          </div>
        ))}
      </FormPanel>}

      <Panel>
        <PanelHead title={`${total.toLocaleString()} total`} />
        <ErrorText error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.items.length ? (
          <Empty>No orders yet.</Empty>
        ) : (
          <>
            <Table>
              <THead>
                <TH>Code</TH>
                <TH>Status</TH>
                <TH>Total</TH>
                <TH>Created</TH>
                <TH>Actions</TH>
              </THead>
              <TBody>
                {data.items.map((o) => (
                  <TR key={o.id} onClick={() => navigate(`/orders/${o.id}`)}>
                    <TD><RowLink to={`/orders/${o.id}`}>{o.code ?? o.id.slice(0, 8) + '…'}</RowLink></TD>
                    <TD><StatusChip status={o.status} /></TD>
                    <TD kind="money">{fmt.baht(o.total)}</TD>
                    <TD kind="time">{fmt.when(o.createdAt)}</TD>
                    <TD kind="actions">
                      <Icon name="chevron_right" size={18} className="text-outline" />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
          </>
        )}
      </Panel>

    </Page>
  );
}
