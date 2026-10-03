import { Fragment, useState } from 'react';
import { webhookApi, WebhookSubscription, EVENT_TYPES } from '../../lib/api';
import { useAsync, statusBadgeClass } from '../hooks';

export function WebhookPlatforms() {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: subscriptions, loading, error, reload } = useAsync(() => webhookApi.subscriptions(), []);

  function toggleEvent(eventType: string) {
    setSelectedEvents((cur) =>
      cur.includes(eventType) ? cur.filter((e) => e !== eventType) : [...cur, eventType],
    );
  }

  async function createSubscription() {
    if (!name.trim() || !targetUrl.trim() || selectedEvents.length === 0) return;
    setBusy('create');
    setActionError('');
    try {
      await webhookApi.createSubscription({
        name,
        targetUrl,
        eventTypes: selectedEvents,
        description: description || undefined,
      });
      setName('');
      setTargetUrl('');
      setSelectedEvents([]);
      setDescription('');
      setShowForm(false);
      setMessage('Subscription created');
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function toggleSubscription(id: string, active: boolean) {
    setBusy(`toggle-${id}`);
    setActionError('');
    try {
      await webhookApi.updateSubscription(id, { active: !active });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteSubscription(id: string) {
    if (!confirm('Delete this subscription?')) return;
    setBusy(`delete-${id}`);
    setActionError('');
    try {
      await webhookApi.deleteSubscription(id);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Webhook Platforms</h1>
          <p>Manage webhook subscriptions and platform integrations.</p>
        </div>
        <button className="btn ghost" onClick={reload}>
          Refresh
        </button>
      </div>

      {message && <div style={{ padding: 16, background: '#e6f4ea', color: '#157347', borderRadius: 6, marginBottom: 16 }}>{message}</div>}
      {error && <div style={{ padding: 16, background: '#fbe4e6', color: '#c2333f', borderRadius: 6, marginBottom: 16 }}>{error}</div>}
      {actionError && <div style={{ padding: 16, background: '#fbe4e6', color: '#c2333f', borderRadius: 6, marginBottom: 16 }}>{actionError}</div>}

      {!showForm ? (
        <button className="btn" style={{ marginBottom: 16 }} onClick={() => setShowForm(true)}>
          + New Subscription
        </button>
      ) : (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head">Add New Webhook Subscription</div>
          <form className="stack">
            <label className="field">
              Name
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Production Webhook" />
            </label>
            <label className="field">
              Target URL
              <input
                type="url"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://your-server.com/webhooks"
              />
            </label>
            <label className="field">
              Description
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
              />
            </label>
            <div>
              <label className="hint" style={{ display: 'block', marginBottom: 8 }}>
                Event Types (select at least one)
              </label>
              <div className="checks">
                {EVENT_TYPES.map((et) => (
                  <label key={et} className={`check ${selectedEvents.includes(et) ? 'on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selectedEvents.includes(et)}
                      onChange={() => toggleEvent(et)}
                    />
                    {et}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn"
                onClick={createSubscription}
                disabled={!name.trim() || !targetUrl.trim() || selectedEvents.length === 0 || busy === 'create'}
              >
                {busy === 'create' ? '...' : 'Create'}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowForm(false)}
                disabled={busy === 'create'}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">Active Subscriptions</div>
        {loading ? (
          <div className="empty">Loading…</div>
        ) : !subscriptions?.length ? (
          <div className="empty">No webhook subscriptions configured.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Target URL</th>
                <th>Events</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((sub: WebhookSubscription) => (
                <Fragment key={sub.id}>
                  <tr>
                    <td>{sub.name}</td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {sub.targetUrl}
                    </td>
                    <td style={{ fontSize: 12 }}>{sub.eventTypes.length} events</td>
                    <td>
                      <span className={statusBadgeClass(sub.active ? 'active' : 'inactive')}>
                        {sub.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn ghost sm" onClick={() => setExpandedId((cur) => (cur === sub.id ? null : sub.id))}>
                        {expandedId === sub.id ? 'Hide' : 'View'}
                      </button>{' '}
                      <button
                        className="btn ghost sm"
                        disabled={busy === `toggle-${sub.id}`}
                        onClick={() => toggleSubscription(sub.id, sub.active)}
                      >
                        {busy === `toggle-${sub.id}` ? '…' : sub.active ? 'Disable' : 'Enable'}
                      </button>{' '}
                      <button
                        className="btn ghost sm"
                        disabled={busy === `delete-${sub.id}`}
                        onClick={() => deleteSubscription(sub.id)}
                      >
                        {busy === `delete-${sub.id}` ? '…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                  {expandedId === sub.id && (
                    <tr>
                      <td colSpan={5} style={{ padding: 16 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div>
                            <div className="hint">Description</div>
                            <p style={{ margin: '4px 0' }}>{sub.description || '(none)'}</p>
                          </div>
                          <div>
                            <div className="hint">Event Types</div>
                            <p style={{ margin: '4px 0', fontFamily: 'monospace', fontSize: 12 }}>
                              {sub.eventTypes.join(', ')}
                            </p>
                          </div>
                          <div>
                            <div className="hint">Created</div>
                            <p style={{ margin: '4px 0', fontFamily: 'monospace', fontSize: 12 }}>
                              {new Date(sub.createdAt).toLocaleString()}
                            </p>
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
