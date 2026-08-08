import { Fragment, useState } from 'react';
import { erpIngestApi, ErpIngestRecordRow, Paginated } from '../../lib/api';
import { useAsync, statusBadgeClass } from '../hooks';

const ENTITY_TYPES = ['product', 'stock', 'customer', 'sale_order'];
const STATUSES = ['received', 'applied', 'failed', 'skipped'];

export function ErpIngest() {
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

  function toggleExpand(id: string) {
    setExpandedId((cur) => (cur === id ? null : id));
  }

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
  const maxPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>ERP ingest</h1>
          <p>Staged ERP payloads (เอามากรองก่อน) — review parse/apply outcomes and retry failures.</p>
        </div>
        <button className="btn ghost" onClick={reload}>Refresh</button>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="row">
            <label className="field">
              Entity type
              <select value={entityType} onChange={(e) => changeEntityType(e.target.value)}>
                <option value="">All</option>
                {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="field">
              Status
              <select value={status} onChange={(e) => changeStatus(e.target.value)}>
                <option value="">All</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <span>
            <span>{total} total</span>{' '}
            <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>{' '}
            <span className="hint">{page} / {maxPage}</span>{' '}
            <button className="btn ghost sm" disabled={page >= maxPage} onClick={() => setPage(page + 1)}>Next</button>
          </span>
        </div>
        {error && <div className="err" style={{ padding: 16 }}>{error}</div>}
        {actionError && <div className="err" style={{ padding: 16 }}>{actionError}</div>}
        {loading ? <div className="empty">Loading…</div> : !data?.items.length ? (
          <div className="empty">No staged ERP rows yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Created</th><th>Entity type</th><th>External id</th><th>Status</th><th>Error</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td>{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="mono">{r.entityType}</td>
                    <td className="mono">{r.externalId ?? '—'}</td>
                    <td><span className={statusBadgeClass(r.status)}>{r.status}</span></td>
                    <td>{r.error ?? '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn ghost sm" onClick={() => toggleExpand(r.id)}>
                        {expandedId === r.id ? 'Hide' : 'View'}
                      </button>{' '}
                      {(r.status === 'received' || r.status === 'failed') && (
                        <button className="btn sm" disabled={busy === r.id} onClick={() => applyOrRetry(r.id)}>
                          {busy === r.id ? '…' : r.status === 'failed' ? 'Retry' : 'Apply'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedId === r.id && (
                    <tr>
                      <td colSpan={6} style={{ padding: 16 }}>
                        <div className="stack">
                          <div>
                            <div className="hint" style={{ marginBottom: 6 }}>Raw payload</div>
                            <pre className="payload">{JSON.stringify(r.rawPayload, null, 2)}</pre>
                          </div>
                          <div>
                            <div className="hint" style={{ marginBottom: 6 }}>Parsed payload</div>
                            <pre className="payload">{JSON.stringify(r.parsedPayload, null, 2)}</pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
