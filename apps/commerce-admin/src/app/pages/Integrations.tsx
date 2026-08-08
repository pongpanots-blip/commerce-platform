import { useState } from 'react';
import { api, Integration } from '../../lib/api';
import { useAsync, statusBadgeClass } from '../hooks';

export function Integrations() {
  const { data, loading, error, reload } = useAsync(() => api.get<Integration[]>('/integrations'));
  const [form, setForm] = useState({ name: '', type: 'example', slug: '', signingSecret: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const webhookUrl = (i: Integration) => `${api.base}/webhooks/${i.slug ?? i.id}`;

  async function copy(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post('/integrations', {
        name: form.name,
        type: form.type,
        ...(form.slug ? { slug: form.slug } : {}),
        ...(form.signingSecret ? { signingSecret: form.signingSecret } : {}),
      });
      setForm({ name: '', type: 'example', slug: '', signingSecret: '' });
      reload();
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
          <h1>Integrations</h1>
          <p>External systems connected to the platform.</p>
        </div>
        <button className="btn ghost" onClick={reload}>Refresh</button>
      </div>

      <div className="panel">
        <div className="panel-head">Connect an integration</div>
        <form className="stack" onSubmit={submit}>
          <div className="row">
            <label className="field">
              Name
              <input required value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Shopify Store" />
            </label>
            <label className="field">
              Type (connector)
              <input required value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                placeholder="example" />
            </label>
            <label className="field">
              Webhook slug
              <input value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="auto from type" />
            </label>
            <label className="field">
              Signing secret
              <input value={form.signingSecret}
                onChange={(e) => setForm({ ...form, signingSecret: e.target.value })}
                placeholder="for webhook HMAC" />
            </label>
          </div>
          {formError && <div className="err">{formError}</div>}
          <div><button className="btn" disabled={submitting}>{submitting ? 'Creating…' : 'Create integration'}</button></div>
        </form>
      </div>

      <div className="panel">
        <div className="panel-head">All integrations</div>
        {error && <div className="err" style={{ padding: 16 }}>{error}</div>}
        {loading ? <div className="empty">Loading…</div> : !data?.length ? (
          <div className="empty">No integrations yet.</div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Secret</th><th>Webhook URL</th></tr></thead>
            <tbody>
              {data.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td className="mono">{i.type}</td>
                  <td><span className={statusBadgeClass(i.status)}>{i.status}</span></td>
                  <td>{i.signingSecret ? <span className="badge muted">set</span> : <span className="hint">—</span>}</td>
                  <td>
                    <span className="mono">/webhooks/{i.slug ?? i.id}</span>{' '}
                    <button className="btn ghost sm" onClick={() => copy(webhookUrl(i), i.id)}>
                      {copied === i.id ? 'Copied' : 'Copy'}
                    </button>
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
