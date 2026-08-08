import { useState } from 'react';
import { api, EVENT_TYPES, WebhookDelivery, WebhookSubscription } from '../../lib/api';
import { useAsync, statusBadgeClass } from '../hooks';

export function Subscriptions() {
  const subs = useAsync(() => api.get<WebhookSubscription[]>('/webhook-subscriptions'));
  const deliveries = useAsync(() => api.get<WebhookDelivery[]>('/webhook-subscriptions/deliveries'));
  const [form, setForm] = useState({ name: '', targetUrl: '', secret: '', description: '' });
  const [events, setEvents] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function toggle(evt: string) {
    setEvents((cur) => (cur.includes(evt) ? cur.filter((e) => e !== evt) : [...cur, evt]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!events.length) {
      setFormError('Choose at least one event to subscribe to.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post('/webhook-subscriptions', {
        name: form.name,
        targetUrl: form.targetUrl,
        eventTypes: events,
        ...(form.secret ? { secret: form.secret } : {}),
        ...(form.description ? { description: form.description } : {}),
      });
      setForm({ name: '', targetUrl: '', secret: '', description: '' });
      setEvents([]);
      subs.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Outgoing webhooks</h1>
          <p>Notify external systems when platform events happen — they subscribe, we deliver (signed).</p>
        </div>
        <button className="btn ghost" onClick={() => { subs.reload(); deliveries.reload(); }}>Refresh</button>
      </div>

      <div className="panel">
        <div className="panel-head">New subscription</div>
        <form className="stack" onSubmit={submit}>
          <div className="row">
            <label className="field">
              Name
              <input required value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Our e-commerce store" />
            </label>
            <label className="field">
              Target URL
              <input required value={form.targetUrl}
                onChange={(e) => setForm({ ...form, targetUrl: e.target.value })}
                placeholder="https://shop.example.com/hooks/platform" />
            </label>
            <label className="field">
              Signing secret
              <input value={form.secret}
                onChange={(e) => setForm({ ...form, secret: e.target.value })}
                placeholder="we HMAC-sign each delivery" />
            </label>
          </div>
          <div>
            <div className="hint" style={{ marginBottom: 6 }}>Events to send</div>
            <div className="checks">
              {EVENT_TYPES.map((evt) => (
                <label key={evt} className={`check${events.includes(evt) ? ' on' : ''}`}>
                  <input type="checkbox" checked={events.includes(evt)} onChange={() => toggle(evt)} />
                  {evt}
                </label>
              ))}
            </div>
          </div>
          {formError && <div className="err">{formError}</div>}
          <div><button className="btn" disabled={submitting}>{submitting ? 'Saving…' : 'Create subscription'}</button></div>
        </form>
      </div>

      <div className="panel">
        <div className="panel-head">Subscriptions</div>
        {subs.loading ? <div className="empty">Loading…</div> : !subs.data?.length ? (
          <div className="empty">No subscriptions yet.</div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Target URL</th><th>Events</th><th>Secret</th><th>Status</th></tr></thead>
            <tbody>
              {subs.data.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="mono">{s.targetUrl}</td>
                  <td>{s.eventTypes.map((e) => <span key={e} className="badge muted" style={{ marginRight: 4 }}>{e}</span>)}</td>
                  <td>{s.secret ? <span className="badge muted">set</span> : <span className="hint">—</span>}</td>
                  <td><span className={statusBadgeClass(s.active ? 'active' : 'disabled')}>{s.active ? 'active' : 'disabled'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          Delivery log
          <button className="btn ghost sm" onClick={deliveries.reload}>Reload</button>
        </div>
        {deliveries.loading ? <div className="empty">Loading…</div> : !deliveries.data?.length ? (
          <div className="empty">No deliveries yet — trigger an event (e.g. update a customer).</div>
        ) : (
          <table>
            <thead><tr><th>When</th><th>Event</th><th>Target</th><th>Status</th><th>HTTP</th><th>Tries</th></tr></thead>
            <tbody>
              {deliveries.data.map((d) => (
                <tr key={d.id}>
                  <td>{new Date(d.createdAt).toLocaleTimeString()}</td>
                  <td className="mono">{d.eventType}</td>
                  <td className="mono">{d.targetUrl}</td>
                  <td><span className={statusBadgeClass(d.status)}>{d.status}</span></td>
                  <td>{d.statusCode ?? '—'}</td>
                  <td>{d.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
