import { Link } from 'react-router-dom';
import { api, AdminStats } from '../../lib/api';
import { useAsync } from '../hooks';

type Card = { key: keyof AdminStats; label: string; to: string; tone?: 'warn' | 'danger' };

/** Backlogs an operator has to act on — highlighted when non-zero. */
const ATTENTION: Card[] = [
  { key: 'webhooksPending', label: 'Webhooks pending', to: '/webhooks', tone: 'warn' },
  { key: 'webhooksFailed', label: 'Webhooks failed', to: '/erp/webhook-dead-letter', tone: 'danger' },
  { key: 'outboxBacklog', label: 'Outbox backlog', to: '/subscriptions', tone: 'warn' },
];

const DATA: Card[] = [
  { key: 'integrations', label: 'Integrations', to: '/integrations' },
  { key: 'syncJobsRecent', label: 'Sync jobs', to: '/sync-jobs' },
  { key: 'customers', label: 'Customers', to: '/customers' },
  { key: 'products', label: 'Products', to: '/products' },
  { key: 'inventoryLevels', label: 'Inventory levels', to: '/inventory' },
];

function StatCard({ card, value }: { card: Card; value: number }) {
  const tone = card.tone && value > 0 ? card.tone : '';
  return (
    <Link className={`stat link ${tone}`} to={card.to}>
      <div className="label">{card.label}</div>
      <div className="value">{value.toLocaleString()}</div>
      <div className="more">View →</div>
    </Link>
  );
}

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
        <>
          <h2 className="section-title">Needs attention</h2>
          <div className="stat-grid wide">
            {ATTENTION.map((c) => <StatCard key={c.key} card={c} value={data?.[c.key] ?? 0} />)}
          </div>
          <h2 className="section-title">Data</h2>
          <div className="stat-grid">
            {DATA.map((c) => <StatCard key={c.key} card={c} value={data?.[c.key] ?? 0} />)}
          </div>
        </>
      )}
    </div>
  );
}
