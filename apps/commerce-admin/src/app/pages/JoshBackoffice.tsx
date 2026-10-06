import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Button, Empty, ErrorText, Input, Loading, Page, PageHeader, Panel, Pager, StatusChip, TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { backofficeApi, BackofficeColumn } from '../../lib/api';
import { useAsync } from '../hooks';
import { ACTION_VIEWS, RowAction, ViewCreate } from './JoshBackofficeActions';

const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function cell(col: BackofficeColumn, v: unknown) {
  if (v === null || v === undefined || v === '') return <span className="text-on-surface-variant">—</span>;
  switch (col.kind) {
    case 'money': return money.format(Number(v));
    case 'number': return Number(v).toLocaleString('th-TH');
    case 'datetime': return fmt.when(String(v));
    case 'date': return String(v).slice(0, 10);
    case 'bool': return v ? '✓' : '—';
    case 'status': return <StatusChip status={String(v)} />;
    case 'code': return <span className="font-mono">{String(v)}</span>;
    default: return String(v);
  }
}

/**
 * josh back-office lists, read-only from josh's replica (KYC, credit, CN/CB, shipments, payments,
 * coupons, campaigns, segments, suppliers, admin access). Columns come from the API, keyed by josh's
 * column names. Changes still happen in josh's web-admin.
 */
export function JoshBackoffice() {
  const { view = 'kyc' } = useParams();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState('');
  useEffect(() => { setSearch(''); setQ(''); setStatus(''); setPage(1); setMsg(''); }, [view]);
  const list = useAsync(() => backofficeApi.list(view, { search: q, status, page }), [view, q, status, page]);
  const d = list.data;

  return (
    <Page>
      <PageHeader
        title={d?.title ?? '…'}
        subtitle={ACTION_VIEWS.has(view) ? 'ดูจาก josh · ปุ่มในตารางสั่งให้ josh ทำ (ตามสิทธิ์ใน josh)' : 'อ่านอย่างเดียวจาก josh'}
        actions={<Button icon="refresh" onClick={list.reload}>Refresh</Button>}
      />
      <div className="border-t border-secondary-container" />

      <div className="px-4 py-2 text-xs text-on-surface-variant">
        {d && (
          <>
            แก้ไขอื่นๆ ยังทำที่ web-admin ของ josh (<span className="font-mono">{d.joshPage}</span>) · เบอร์ อีเมล ชื่อคน ถูกปิดบัง
          </>
        )}
      </div>

      <Panel className="overflow-hidden">
        <form className="flex gap-2 p-4" onSubmit={(e) => { e.preventDefault(); setQ(search.trim()); setPage(1); }}>
          <Input
            className="flex-1"
            placeholder="ค้นหา…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="ค้นหา"
          />
          <Button type="submit">ค้นหา</Button>
          <Button type="button" variant="ghost" onClick={list.reload}>Refresh</Button>
        </form>
      </Panel>

      <div className="px-4 py-2">
        <ViewCreate key={view} view={view} onDone={(m) => { setMsg(m); list.reload(); }} />
      </div>

      {msg && <div className="px-4 py-2 text-xs text-on-surface-variant bg-surface-container-low">{msg}</div>}
      <ErrorText error={list.error} />

      {d && !!d.byStatus.length && (
        <div className="flex flex-wrap gap-2 px-4 py-3 border-y border-secondary-container">
          <Button
            size="sm"
            variant={status === '' ? 'primary' : 'secondary'}
            onClick={() => { setStatus(''); setPage(1); }}
          >
            ทั้งหมด ({d.byStatus.reduce((a, s) => a + s.n, 0)})
          </Button>
          {d.byStatus.map((s) => s.status && (
            <Button
              key={s.status}
              size="sm"
              variant={status === s.status ? 'primary' : 'secondary'}
              onClick={() => { setStatus(s.status!); setPage(1); }}
            >
              {s.status} ({s.n})
            </Button>
          ))}
        </div>
      )}

      {list.loading && !d ? (
        <Loading />
      ) : d ? (
        <>
          <Panel className="overflow-x-auto overflow-hidden">
            {d.items.length ? (
              <Table>
                <THead>
                    {ACTION_VIEWS.has(view) && <TH />}
                    {d.columns.map((c) => <TH key={c.key}>{c.label}</TH>)}
                  </THead>
                <TBody>
                  {d.items.map((r, i) => (
                    <TR key={i}>
                      {ACTION_VIEWS.has(view) && (
                        <TD>
                          <RowAction view={view} row={r} onDone={(m) => { setMsg(m); list.reload(); }} />
                        </TD>
                      )}
                      {d.columns.map((c) => (
                        <TD key={c.key}>{cell(c, r[c.key])}</TD>
                      ))}
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <Empty>ไม่มีรายการ</Empty>
            )}
          </Panel>

          {d.total > d.limit && (
            <Pager page={page} pageSize={d.limit} total={d.total} onPage={setPage} />
          )}
        </>
      ) : null}
    </Page>
  );
}
