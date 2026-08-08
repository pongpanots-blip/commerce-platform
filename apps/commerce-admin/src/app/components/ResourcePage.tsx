import { useState } from 'react';
import { api, Paginated } from '../../lib/api';
import { useAsync } from '../hooks';

export interface Column<T> {
  label: string;
  render: (row: T) => React.ReactNode;
}

export interface Field {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
}

interface Props<T> {
  title: string;
  subtitle: string;
  endpoint: string; // e.g. "/customers"
  columns: Column<T>[];
  fields: Field[];
  createLabel: string;
}

export function ResourcePage<T extends { id: string }>(props: Props<T>) {
  const { title, subtitle, endpoint, columns, fields, createLabel } = props;
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { data, loading, error, reload } = useAsync(
    () => api.get<Paginated<T>>(`${endpoint}?page=${page}&pageSize=${pageSize}`),
    [page, endpoint],
  );

  const [form, setForm] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const payload: Record<string, string> = {};
      for (const f of fields) {
        if (form[f.name]) payload[f.name] = form[f.name];
      }
      await api.post(endpoint, payload);
      setForm({});
      if (page !== 1) setPage(1);
      else reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const total = data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <button className="btn ghost" onClick={reload}>Refresh</button>
      </div>

      <div className="panel">
        <div className="panel-head">{createLabel}</div>
        <form className="stack" onSubmit={submit}>
          <div className="row">
            {fields.map((f) => (
              <label className="field" key={f.name}>
                {f.label}
                {f.options ? (
                  <select value={form[f.name] ?? ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}>
                    <option value="">—</option>
                    {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input required={f.required} placeholder={f.placeholder}
                    value={form[f.name] ?? ''}
                    onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />
                )}
              </label>
            ))}
          </div>
          {formError && <div className="err">{formError}</div>}
          <div><button className="btn" disabled={submitting}>{submitting ? 'Saving…' : createLabel}</button></div>
        </form>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span>{total} total</span>
          <span>
            <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>{' '}
            <span className="hint">{page} / {maxPage}</span>{' '}
            <button className="btn ghost sm" disabled={page >= maxPage} onClick={() => setPage(page + 1)}>Next</button>
          </span>
        </div>
        {error && <div className="err" style={{ padding: 16 }}>{error}</div>}
        {loading ? <div className="empty">Loading…</div> : !data?.items.length ? (
          <div className="empty">Nothing here yet.</div>
        ) : (
          <table>
            <thead><tr>{columns.map((c) => <th key={c.label}>{c.label}</th>)}</tr></thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>{columns.map((c) => <td key={c.label}>{c.render(row)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
