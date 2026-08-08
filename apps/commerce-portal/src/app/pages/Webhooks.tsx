import { FormEvent, useState } from 'react';
import { webhooks, events, TestWebhookResult } from '../../lib/api';
import { useAsync } from '../hooks';

export function Webhooks() {
  const { data, loading, error, reload } = useAsync(() => webhooks.list());
  const eventsState = useAsync(() => events.list());
  const catalog = eventsState.data?.items ?? [];

  const [form, setForm] = useState({ name: '', targetUrl: '', secret: '' });
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestWebhookResult>>({});

  function toggleEvent(type: string) {
    setSelectedEvents((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selectedEvents.length) {
      setFormError('เลือกอย่างน้อย 1 event');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await webhooks.create({
        name: form.name,
        targetUrl: form.targetUrl,
        eventTypes: selectedEvents,
        ...(form.secret ? { secret: form.secret } : {}),
      });
      setForm({ name: '', targetUrl: '', secret: '' });
      setSelectedEvents([]);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(id: string, active: boolean) {
    setBusyId(id);
    try {
      await webhooks.update(id, { active: !active });
      reload();
    } finally {
      setBusyId(null);
    }
  }

  async function test(id: string) {
    setBusyId(id);
    try {
      const result = await webhooks.test(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Webhooks</h1>
          <p>Subscribe an endpoint to receive platform events as they happen.</p>
        </div>
        <button className="btn ghost" onClick={reload}>Refresh</button>
      </div>

      <div className="panel">
        <div className="panel-head">Create a webhook</div>
        <form className="stack" onSubmit={submit}>
          <div className="row">
            <label className="field">
              Name
              <input required value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Order sync" />
            </label>
            <label className="field">
              Target URL
              <input required type="url" value={form.targetUrl}
                onChange={(e) => setForm({ ...form, targetUrl: e.target.value })}
                placeholder="https://example.com/webhooks/josh" />
            </label>
            <label className="field">
              Secret (optional)
              <input value={form.secret}
                onChange={(e) => setForm({ ...form, secret: e.target.value })}
                placeholder="for HMAC signature" />
            </label>
          </div>
          <div>
            <div className="hint" style={{ marginBottom: 6 }}>Events</div>
            <div className="checks">
              {catalog.map((ev) => (
                <label key={ev.type}
                  className={`check${selectedEvents.includes(ev.type) ? ' on' : ''}`}
                  title={ev.description}>
                  <input type="checkbox" checked={selectedEvents.includes(ev.type)}
                    onChange={() => toggleEvent(ev.type)} />
                  {ev.type}
                </label>
              ))}
            </div>
            {catalog.length > 0 && (
              <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
                {catalog.filter((ev) => selectedEvents.includes(ev.type)).map((ev) => (
                  <li key={ev.type} className="hint">{ev.type} — {ev.description}</li>
                ))}
              </ul>
            )}
          </div>
          {formError && <div className="err">{formError}</div>}
          <div><button className="btn" disabled={submitting}>{submitting ? 'Creating…' : 'Create webhook'}</button></div>
        </form>
      </div>

      <div className="panel">
        <div className="panel-head">All webhooks</div>
        {error && <div className="err" style={{ padding: 16 }}>{error}</div>}
        {loading ? <div className="empty">Loading…</div> : !data?.length ? (
          <div className="empty">No webhooks yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Target URL</th><th>Events</th><th>Active</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((w) => (
                <tr key={w.id}>
                  <td>{w.name}</td>
                  <td className="mono">{w.targetUrl}</td>
                  <td>{w.eventTypes.join(', ')}</td>
                  <td>
                    <label className="hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={w.active} disabled={busyId === w.id}
                        onChange={() => toggleActive(w.id, w.active)} />
                      {w.active ? 'active' : 'inactive'}
                    </label>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" disabled={busyId === w.id} onClick={() => test(w.id)}>
                      {busyId === w.id ? '…' : 'Test'}
                    </button>
                    {testResults[w.id] && (
                      <div className="hint" style={{ marginTop: 4 }}>
                        {testResults[w.id].ok
                          ? <span className="badge ok">ok · {testResults[w.id].status}</span>
                          : <span className="badge danger">
                              failed{testResults[w.id].status ? ` · ${testResults[w.id].status}` : ''}
                              {testResults[w.id].error ? ` · ${testResults[w.id].error}` : ''}
                            </span>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
