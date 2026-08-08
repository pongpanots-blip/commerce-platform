import { api, AdminStats } from '../../lib/api';
import { useAsync } from '../hooks';

const CARDS: { key: keyof AdminStats; label: string; attn?: boolean }[] = [
  { key: 'integrations', label: 'Integrations' },
  { key: 'webhooksPending', label: 'Webhooks pending', attn: true },
  { key: 'webhooksFailed', label: 'Webhooks failed', attn: true },
  { key: 'outboxBacklog', label: 'Outbox backlog', attn: true },
  { key: 'syncJobsRecent', label: 'Sync jobs' },
  { key: 'customers', label: 'Customers' },
  { key: 'products', label: 'Products' },
  { key: 'inventoryLevels', label: 'Inventory levels' },
];

export function Dashboard() {
  const { data, loading, error, reload } = useAsync(() => api.get<AdminStats>('/admin/stats'));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>Commerce Platform health at a glance.</p>
        </div>
        <button className="btn ghost" onClick={reload}>Refresh</button>
      </div>
      {error && <div className="err">{error}</div>}
      {loading && !data ? (
        <div className="empty">Loading…</div>
      ) : (
        <div className="stat-grid">
          {CARDS.map((c) => {
            const value = data ? data[c.key] : 0;
            const attn = c.attn && value > 0;
            return (
              <div className="stat" key={c.key}>
                <div className="label">{c.label}</div>
                <div className={`value${attn ? ' attn' : ''}`}>{value}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
