import { useState } from 'react';
import {
  Button, DetailPanel, DetailSection, Empty, ErrorText, Field, FormPanel, Input, KeyValueGrid, Loading, Page, PageHeader, Panel, PanelHead, Pager, Span, StatusChip, TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { api, ordersApi, OrderFull, OrderRow, Paginated } from '../../lib/api';
import { useAsync } from '../hooks';

interface LineForm {
  productId: string;
  qty: string;
  unitPrice: string;
}

const emptyLine: LineForm = { productId: '', qty: '', unitPrice: '' };

export function Orders() {
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

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const detail = useAsync<OrderFull | null>(
    () => (expandedId ? ordersApi.full(expandedId) : Promise.resolve(null)),
    [expandedId],
  );

  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  function toggleExpand(id: string) {
    setActionError(null);
    setExpandedId((cur) => (cur === id ? null : id));
  }

  async function runAction(key: string, fn: () => Promise<unknown>) {
    setActionBusy(key);
    setActionError(null);
    try {
      await fn();
      detail.reload();
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(null);
    }
  }

  const total = data?.total ?? 0;

  return (
    <Page>
      <PageHeader
        title="Orders"
        subtitle="Create orders, walk checkout / payment, and inspect reservations."
        actions={<Button icon="refresh" variant="secondary" onClick={reload}>Refresh</Button>}
      />

      <FormPanel
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
      </FormPanel>

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
                  <TR key={o.id}>
                    <TD kind="mono">{o.code ?? o.id.slice(0, 8) + '…'}</TD>
                    <TD><StatusChip status={o.status} /></TD>
                    <TD kind="money">{fmt.baht(o.total)}</TD>
                    <TD kind="time">{fmt.when(o.createdAt)}</TD>
                    <TD kind="actions">
                      <Button variant="ghost" size="sm" onClick={() => toggleExpand(o.id)}>
                        {expandedId === o.id ? 'Hide' : 'View'}
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
          </>
        )}
      </Panel>

      {expandedId && (
        <DetailPanel
          title={`Order`}
          subtitle={expandedId.slice(0, 8) + '…'}
          status={detail.data ? <StatusChip status={detail.data.order.status} /> : undefined}
          actions={
            detail.data ? (
              <>
                {detail.data.order.status === 'draft' && (
                  <Button size="sm" disabled={actionBusy === 'checkout'} onClick={() => runAction('checkout', () => ordersApi.checkout(detail.data!.order.id))}>
                    {actionBusy === 'checkout' ? '…' : 'Checkout'}
                  </Button>
                )}
                {detail.data.order.status === 'pending_payment' && detail.data.payment?.status === 'pending' && (
                  <>
                    <Button size="sm" disabled={actionBusy === 'pay'} onClick={() => runAction('pay', () => ordersApi.pay(detail.data!.payment!.id))}>
                      {actionBusy === 'pay' ? '…' : 'Mark paid'}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={actionBusy === 'fail'} onClick={() => runAction('fail', () => ordersApi.failPay(detail.data!.payment!.id))}>
                      {actionBusy === 'fail' ? '…' : 'Mark failed'}
                    </Button>
                  </>
                )}
                {detail.data.reservations.some((r) => r.status === 'held') && (
                  <Button variant="ghost" size="sm" disabled={actionBusy === 'release'} onClick={() => runAction('release', () => ordersApi.releaseReservations(detail.data!.order.id))}>
                    {actionBusy === 'release' ? '…' : 'Release holds'}
                  </Button>
                )}
              </>
            ) : undefined
          }
          onClose={() => setExpandedId(null)}
        >
          {detail.loading && !detail.data ? (
            <Loading />
          ) : detail.error ? (
            <ErrorText error={detail.error} />
          ) : !detail.data ? (
            <Empty>No detail.</Empty>
          ) : (
            <>
              <ErrorText error={actionError} />

              <DetailSection title="Lines">
                {!detail.data.lines.length ? (
                  <Empty>No lines.</Empty>
                ) : (
                  <Table>
                    <THead>
                      <TH>Product</TH>
                      <TH>Qty</TH>
                      <TH>Unit price</TH>
                      <TH right>Line total</TH>
                    </THead>
                    <TBody>
                      {detail.data.lines.map((l) => (
                        <TR key={l.id}>
                          <TD kind="mono">{l.productId.slice(0, 8)}…</TD>
                          <TD>{l.qty}</TD>
                          <TD kind="money">{fmt.baht(l.unitPrice)}</TD>
                          <TD kind="money">{fmt.baht(l.lineTotal)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </DetailSection>

              <DetailSection title="Fulfillments">
                {!detail.data.fulfillments.length ? (
                  <Empty>No fulfillments.</Empty>
                ) : (
                  <Table>
                    <THead>
                      <TH>Source</TH>
                      <TH>Mode</TH>
                      <TH>Status</TH>
                    </THead>
                    <TBody>
                      {detail.data.fulfillments.map((f) => (
                        <TR key={f.id}>
                          <TD kind="mono">{f.source}</TD>
                          <TD kind="mono">{f.mode}</TD>
                          <TD><StatusChip status={f.status} /></TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </DetailSection>

              <DetailSection title="Reservations">
                {!detail.data.reservations.length ? (
                  <Empty>No reservations.</Empty>
                ) : (
                  <Table>
                    <THead>
                      <TH>SKU</TH>
                      <TH>Qty</TH>
                      <TH>Status</TH>
                      <TH>External ref</TH>
                      <TH>Expires</TH>
                      <TH>Promised</TH>
                      <TH>Fail reason</TH>
                    </THead>
                    <TBody>
                      {detail.data.reservations.map((r) => (
                        <TR key={r.id}>
                          <TD kind="mono">{r.sku}</TD>
                          <TD>{r.qty}</TD>
                          <TD><StatusChip status={r.status} /></TD>
                          <TD kind="mono">{r.externalRef ?? '—'}</TD>
                          <TD kind="time">{r.expiresAt ? fmt.when(r.expiresAt) : '—'}</TD>
                          <TD>{r.promisedDate ?? '—'}</TD>
                          <TD>{r.failReason ?? '—'}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </DetailSection>

              {detail.data.payment && (
                <DetailSection title="Payment">
                  <Table>
                    <THead>
                      <TH>Status</TH>
                      <TH>Method</TH>
                      <TH right>Amount</TH>
                    </THead>
                    <TBody>
                      <TR>
                        <TD><StatusChip status={detail.data.payment.status} /></TD>
                        <TD>{detail.data.payment.method ?? '—'}</TD>
                        <TD kind="money">{fmt.baht(detail.data.payment.amount)}</TD>
                      </TR>
                    </TBody>
                  </Table>
                </DetailSection>
              )}
            </>
          )}
        </DetailPanel>
      )}
    </Page>
  );
}
