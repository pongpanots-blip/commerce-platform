import { useState } from 'react';
import { Button, Empty, ErrorText, Field, FormPanel, Input, Loading, Page, PageHeader, Panel, PanelHead, Pager, Select, Span, TBody, TD, TH, THead, TR, Table } from '@cp/ui';
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
  endpoint: string;
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

  async function handleSubmit() {
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

  return (
    <Page>
      <PageHeader
        crumbs={[title]}
        title={title}
        subtitle={subtitle}
        actions={<Button icon="refresh" variant="secondary" onClick={reload}>Refresh</Button>}
      />

      <FormPanel
        title={createLabel}
        icon="add_circle"
        cols={2}
        error={formError}
        submitLabel={createLabel}
        busy={submitting}
        onSubmit={handleSubmit}
      >
        {fields.map((f) => (
          <Field key={f.name} label={f.label}>
            {f.options ? (
              <Select value={form[f.name] ?? ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}>
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            ) : (
              <Input
                required={f.required}
                placeholder={f.placeholder}
                value={form[f.name] ?? ''}
                onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
              />
            )}
          </Field>
        ))}
      </FormPanel>

      <Panel>
        <PanelHead title={`${total.toLocaleString()} total`} />
        <ErrorText error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.items.length ? (
          <Empty>Nothing here yet.</Empty>
        ) : (
          <>
            <Table>
              <THead>
                {columns.map((c) => (
                  <TH key={c.label}>{c.label}</TH>
                ))}
              </THead>
              <TBody>
                {data.items.map((row) => (
                  <TR key={row.id}>
                    {columns.map((c) => (
                      <TD key={c.label}>{c.render(row)}</TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
          </>
        )}
      </Panel>
    </Page>
  );
}
