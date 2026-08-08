import { FormEvent, useState } from 'react';
import { keys, CreateKeyResponse } from '../../lib/api';
import { useAsync } from '../hooks';

export function ApiKeys() {
  const { data, loading, error, reload } = useAsync(() => keys.list());
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateKeyResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await keys.create(name);
      setName('');
      setCreated(res); // shown once — never fetchable again after this render
      setCopied(false);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(id: string) {
    setBusyId(id);
    try {
      await keys.revoke(id);
      reload();
    } finally {
      setBusyId(null);
    }
  }

  async function copyKey() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.fullKey);
      setCopied(true);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>API keys</h1>
          <p>Keys authenticate your app against the storefront API (X-Api-Key header).</p>
        </div>
        <button className="btn ghost" onClick={reload}>Refresh</button>
      </div>

      <div className="panel">
        <div className="panel-head">Create a key</div>
        <form className="stack" onSubmit={submit}>
          <div className="row">
            <label className="field">
              Name
              <input required value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Production key" />
            </label>
          </div>
          {formError && <div className="err">{formError}</div>}
          <div><button className="btn" disabled={submitting}>{submitting ? 'Creating…' : 'Create key'}</button></div>
        </form>
      </div>

      <div className="panel">
        <div className="panel-head">All keys</div>
        {error && <div className="err" style={{ padding: 16 }}>{error}</div>}
        {loading ? <div className="empty">Loading…</div> : !data?.length ? (
          <div className="empty">No API keys yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Key prefix</th><th>Scope</th><th>Active</th>
                <th>Last used</th><th>Created</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td className="mono">{k.keyPrefix}…</td>
                  <td>{k.scope}</td>
                  <td>{k.active
                    ? <span className="badge ok">active</span>
                    : <span className="badge muted">revoked</span>}</td>
                  <td>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : <span className="hint">never</span>}</td>
                  <td>{new Date(k.createdAt).toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>
                    {k.active && (
                      <button className="btn ghost sm" disabled={busyId === k.id} onClick={() => revoke(k.id)}>
                        {busyId === k.id ? '…' : 'Revoke'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {created && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-head">
              Key created
              <button className="btn ghost sm" onClick={() => setCreated(null)}>Close</button>
            </div>
            <div className="modal-body">
              <p className="hint">Name: {created.name}</p>
              <div className="key-box">
                <code>{created.fullKey}</code>
                <button className="btn sm" onClick={copyKey}>{copied ? 'Copied' : 'Copy'}</button>
              </div>
              <div className="warn-box">
                คีย์นี้จะแสดงครั้งเดียว โปรดคัดลอกเก็บทันที
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
