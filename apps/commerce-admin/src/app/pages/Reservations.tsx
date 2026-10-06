import { useState } from 'react';
import { Button, Empty, ErrorText, Loading, Page, PageHeader, Panel, PanelHead, Pager, Select, StatusChip, TBody, TD, TH, THead, TR, Table, fmt } from '@cp/ui';
import { api, Paginated, ReservationRow, ordersApi } from '../../lib/api';
import { useAsync } from '../hooks';

const STATUSES = ['', 'held', 'confirmed', 'released', 'expired', 'failed', 'reconcile'];

function remainingHint(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const mins = Math.round(ms / 60000);
  return mins < 1 ? '<1 min left' : `${mins} min left`;
}

export function Reservations() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { data, loading, error, reload } = useAsync(
    () => api.get<Paginated<ReservationRow>>(
      `/reservations?page=${page}&pageSize=${pageSize}${status ? `&status=${status}` : ''}`),
    [page, status],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function release(orderId: string) {
    setBusy(orderId);
    setActionError(null);
    try {
      await ordersApi.releaseReservations(orderId);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const total = data?.total ?? 0;

  return (
    <Page>
      <PageHeader
        crumbs={['Reservations']}
        title="Reservations"
        subtitle="Stock holds created during checkout — held, confirmed, released, or expired."
        actions={<Button icon="refresh" variant="secondary" onClick={reload}>Refresh</Button>}
      />

      <Panel>
        <PanelHead
          title={`${total.toLocaleString()} total`}
          actions={
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-48">
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s || 'all statuses'}</option>
              ))}
            </Select>
          }
        />
        <ErrorText error={error} />
        <ErrorText error={actionError} />
        {loading && !data ? (
          <Loading />
        ) : !data?.items.length ? (
          <Empty>No reservations yet.</Empty>
        ) : (
          <>
            <Table>
              <THead>
                <TH>SKU</TH>
                <TH>Qty</TH>
                <TH>Mode</TH>
                <TH>Status</TH>
                <TH>External ref</TH>
                <TH>Expires</TH>
                <TH>Promised</TH>
                <TH>Fail reason</TH>
                <TH>Order</TH>
                <TH>Actions</TH>
              </THead>
              <TBody>
                {data.items.map((r) => {
                  const remaining = remainingHint(r.expiresAt);
                  return (
                    <TR key={r.id}>
                      <TD kind="mono">{r.sku}</TD>
                      <TD>{r.qty}</TD>
                      <TD kind="mono">{r.mode}</TD>
                      <TD><StatusChip status={r.status} /></TD>
                      <TD kind="mono">{r.externalRef ?? '—'}</TD>
                      <TD kind="time">
                        {r.expiresAt ? fmt.when(r.expiresAt) : '—'}
                        {remaining && <div className="text-[10px] text-on-surface-variant">{remaining}</div>}
                      </TD>
                      <TD>{r.promisedDate ?? '—'}</TD>
                      <TD>{r.failReason ?? '—'}</TD>
                      <TD kind="mono">{r.orderId.slice(0, 8)}…</TD>
                      <TD kind="actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={r.status !== 'held' || busy === r.orderId}
                          title="Releases ALL held reservations on this order"
                          onClick={() => release(r.orderId)}
                        >
                          {busy === r.orderId ? '…' : 'Release'}
                        </Button>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
          </>
        )}
      </Panel>
    </Page>
  );
}
