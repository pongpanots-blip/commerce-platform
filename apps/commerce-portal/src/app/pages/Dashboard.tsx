import { Link } from 'react-router-dom';
import { keys, webhooks, ApiKeyRow, WebhookRow } from '../../lib/api';
import { useAsync } from '../hooks';

export function Dashboard() {
  const keysState = useAsync(() => keys.list());
  const webhooksState = useAsync(() => webhooks.list());

  const activeKeys = (rows: ApiKeyRow[] | null) => rows?.filter((k) => k.active) ?? [];
  const latestKey = (rows: ApiKeyRow[] | null) => rows?.[0] ?? null;
  const activeWebhooks = (rows: WebhookRow[] | null) => rows?.filter((w) => w.active) ?? [];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Your API keys and webhook subscriptions at a glance.</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="panel">
          <div className="panel-head">
            My API keys
            <Link className="btn ghost sm" to="/keys">Manage</Link>
          </div>
          <div style={{ padding: 16 }}>
            {keysState.error && <div className="err">{keysState.error}</div>}
            {keysState.loading && !keysState.data ? (
              <div className="empty">Loading…</div>
            ) : (
              <>
                <div className="stat" style={{ border: 'none', padding: 0 }}>
                  <div className="label">Total keys</div>
                  <div className="value">{keysState.data?.length ?? 0}</div>
                </div>
                <p className="hint" style={{ marginTop: 10 }}>
                  {activeKeys(keysState.data).length} active
                  {latestKey(keysState.data)
                    ? ` · latest: ${latestKey(keysState.data)?.keyPrefix}…`
                    : ''}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            My webhooks
            <Link className="btn ghost sm" to="/webhooks">Manage</Link>
          </div>
          <div style={{ padding: 16 }}>
            {webhooksState.error && <div className="err">{webhooksState.error}</div>}
            {webhooksState.loading && !webhooksState.data ? (
              <div className="empty">Loading…</div>
            ) : (
              <>
                <div className="stat" style={{ border: 'none', padding: 0 }}>
                  <div className="label">Total webhooks</div>
                  <div className="value">{webhooksState.data?.length ?? 0}</div>
                </div>
                <p className="hint" style={{ marginTop: 10 }}>
                  {activeWebhooks(webhooksState.data).length} active
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
