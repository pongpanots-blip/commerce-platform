// ui-metadata-migration: static labels and UI notices only
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert, Button, Empty, ErrorText, Loading, Page, PageHeader, Panel, Pager, SearchInput, Segmented, StatusChip, TBody, TD, TH, THead, TR, Table,
  TitleBadge, fmt,
} from '@cp/ui';
import { backofficeApi, BackofficeColumn } from '../../lib/api';
import { useAsync } from '../hooks';
import { ACTION_VIEWS, RowAction, ViewCreate } from './JoshBackofficeActions';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const tdKind = (k: BackofficeColumn['kind']) => (k === 'money' ? 'money' : k === 'number' ? 'num' : k === 'datetime' || k === 'date' ? 'time' : 'text');

function cell(col: BackofficeColumn, v: unknown) {
  if (v === null || v === undefined || v === '') return <span className="text-on-surface-variant">—</span>;
  switch (col.kind) {
    case 'money': return money.format(Number(v));
    case 'number': return Number(v).toLocaleString('th-TH');
    case 'datetime': return fmt.when(String(v));
    case 'date': return String(v).slice(0, 10);
    case 'bool': return v ? <span className="text-[#157347]">✓</span> : <span className="text-on-surface-variant">—</span>;
    case 'status': return <StatusChip status={String(v)} />;
    case 'code': return <span className="font-mono text-[11px] block max-w-[180px] truncate" title={String(v)}>{String(v)}</span>;
    default: return String(v);
  }
}

/**
 * josh back-office lists, read-only from josh's replica (KYC, credit, CN/CB, shipments, payments,
 * coupons, campaigns, segments, suppliers, admin access). Columns come from the API, keyed by josh's
 * column names. Changes still happen in josh's web-admin.
 */
export function JoshBackoffice() {
  __useUiLocale();
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
        badge={<TitleBadge icon={ACTION_VIEWS.has(view) ? 'touch_app' : 'visibility'}>{ACTION_VIEWS.has(view) ? __uiText("สั่ง josh ได้ · ตามสิทธิ์ใน josh") : __uiText("อ่านอย่างเดียว · ข้อมูลจาก josh")}</TitleBadge>}
        subtitle={d && <>{__uiText("แก้ไขอื่นๆ ยังทำที่ web-admin ของ josh (")}<span className="font-mono">{d.joshPage}</span>{__uiText(") · เบอร์ อีเมล ชื่อคน ถูกปิดบัง")}</>}
        actions={<Button icon="refresh" onClick={list.reload}>{__uiText("Refresh")}</Button>}
      />

      {msg && <Alert tone="ok" onClose={() => setMsg('')}>{(typeof msg === 'string' ? __uiText(msg) : msg)}</Alert>}
      <ErrorText error={list.error} />

      <ViewCreate key={view} view={view} onDone={(m) => { setMsg(m); list.reload(); }} />

      <Panel as="form" className="p-3 space-y-3" onSubmit={(e) => { e.preventDefault(); setQ(search.trim()); setPage(1); }}>
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchInput className="flex-1 min-w-60" placeholder={__uiText("ค้นหา…")} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={__uiText("ค้นหา")} />
          <Button type="submit" variant="primary" icon="search">{__uiText("ค้นหา")}</Button>
          {(q || status) && <Button variant="ghost" onClick={() => { setSearch(''); setQ(''); setStatus(''); setPage(1); }}>{__uiText("ล้างตัวกรอง")}</Button>}
        </div>
        {d && !!d.byStatus.length && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="overflow-x-auto">
              <Segmented
                value={status}
                onChange={(v) => { setStatus(v); setPage(1); }}
                options={[
                  { value: '', label: __uiText("ทั้งหมด"), count: d.byStatus.reduce((a, s) => a + s.n, 0) },
                  ...d.byStatus.filter((s) => s.status).map((s) => ({ value: s.status as string, label: s.status as string, count: s.n })),
                ]}
              />
            </div>
            <span className="text-[11px] text-on-surface-variant font-mono">{__uiText("พบ ")}<span className="font-bold text-on-surface">{fmt.num(d.total)}</span> {__uiText(" รายการ")}</span>
          </div>
        )}
      </Panel>

      <Panel className="overflow-hidden">
        {list.loading && !d ? (
          <Loading />
        ) : d && d.items.length ? (
          <>
            <Table maxHeight="calc(100vh - 330px)">
              <THead>
                {ACTION_VIEWS.has(view) && <TH>{__uiText("จัดการ")}</TH>}
                {d.columns.map((c) => <TH key={c.key} kind={tdKind(c.kind)}>{c.label}</TH>)}
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
                      <TD key={c.key} kind={tdKind(c.kind)}>{cell(c, r[c.key])}</TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pager page={page} pageSize={d.limit} total={d.total} onPage={setPage} />
          </>
        ) : d ? (
          <Empty>{__uiText("ไม่มีรายการ")}</Empty>
        ) : null}
      </Panel>
    </Page>
  );
}
