import { Fragment, useState } from 'react';
import { erpIngestApi, ErpIngestRecordRow, Paginated } from '../../lib/api';
import { useAsync } from '../hooks';
import { Page, PageHeader, Panel, PanelHead, Table, THead, TH, TBody, TR, TD, ExpandRow, ExpandToggle, Pager, ErrorText, Empty, Loading, Alert, CodeBlock, StatusChip, fmt, DetailSection, Button } from '@cp/ui';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const ENTITY_TYPES = ['product_qty', 'product_price', 'product_moq', 'product', 'stock', 'customer', 'sale_order'];
const STATUSES = ['received', 'applied', 'failed', 'skipped', 'stale', 'ignored'];

export function ErpIngest() {
  __useUiLocale();
  const [entityType, setEntityType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, loading, error, reload } = useAsync<Paginated<ErpIngestRecordRow>>(
    () => erpIngestApi.list({ entityType: entityType || undefined, status: status || undefined, page, pageSize }),
    [entityType, status, page],
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function changeEntityType(v: string) {
    setEntityType(v);
    setPage(1);
  }

  function changeStatus(v: string) {
    setStatus(v);
    setPage(1);
  }

  async function applyOrRetry(id: string) {
    setBusy(id);
    setActionError(null);
    try {
      await erpIngestApi.apply(id);
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
      <PageHeader title={__uiText("ERP ingest")} subtitle={__uiText("Staged ERP payloads — review parse/apply outcomes and retry failures.")} actions={<Button icon="refresh" onClick={reload}>{__uiText("Refresh")}</Button>} />

      <Panel>
        <PanelHead title={__uiText("Filters")} actions={<div className="flex flex-wrap gap-2">
          <select value={entityType} onChange={(e) => changeEntityType(e.target.value)} className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60">
            <option value="">{__uiText("All entity types")}</option>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={status} onChange={(e) => changeStatus(e.target.value)} className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs focus:outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors disabled:opacity-60">
            <option value="">{__uiText("All statuses")}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>} />
        <ErrorText error={error} />
        <ErrorText error={actionError} />
        {loading && !data ? <Loading /> : !data?.items.length ? (
          <Empty>{__uiText("No staged ERP rows yet.")}</Empty>
        ) : (
          <Table>
            <THead>
              <TH>{__uiText("Created")}</TH><TH>{__uiText("Entity type")}</TH><TH>{__uiText("External ID")}</TH><TH>{__uiText("Status")}</TH><TH>{__uiText("Error")}</TH><TH></TH>
            </THead>
            <TBody>
              {data.items.map((r) => (
                <Fragment key={r.id}>
                  <TR>
                    <TD kind="time">{fmt.when(r.createdAt)}</TD>
                    <TD kind="mono">{r.entityType}</TD>
                    <TD kind="mono">{r.externalId ?? '—'}</TD>
                    <TD><StatusChip status={r.status} /></TD>
                    <TD className="text-on-surface-variant text-xs">{r.error ?? '—'}</TD>
                    <TD kind="actions"><ExpandToggle open={expandedId === r.id} onClick={() => setExpandedId(cur => cur === r.id ? null : r.id)} /> {(r.status === 'received' || r.status === 'failed') && <Button variant="primary" disabled={busy === r.id} onClick={() => applyOrRetry(r.id)}>{busy === r.id ? '…' : r.status === 'failed' ? __uiText("Retry") : __uiText("Apply")}</Button>}</TD>
                  </TR>
                  {expandedId === r.id && (
                    <ExpandRow colSpan={6}>
                      <DetailSection title={__uiText("Payloads")}>
                        <div className="grid md:grid-cols-2 gap-3">
                          <CodeBlock title={__uiText("Raw")} value={r.rawPayload} maxHeight={300} />
                          <CodeBlock title={__uiText("Parsed")} value={r.parsedPayload} maxHeight={300} />
                        </div>
                      </DetailSection>
                      {r.error && (
                        <DetailSection title={__uiText("Error")}>
                          <p className="text-xs text-on-surface whitespace-pre-wrap break-words">{r.error}</p>
                        </DetailSection>
                      )}
                    </ExpandRow>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
        )}
        <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
      </Panel>
    </Page>
  );
}
