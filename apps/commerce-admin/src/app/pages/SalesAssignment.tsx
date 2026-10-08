import { useState } from 'react';
import { Alert, Button, ErrorText, Field, Input, Loading, Page, PageHeader, Panel, Select, uiText, useUiLocale } from '@cp/ui';
import { joshCustomerApi, JoshRow, salesAssignmentApi } from '../../lib/api';
import { useAsync } from '../hooks';

/** Masked company search and an id/name roster; no full-PII staff or customer page. */
export function SalesAssignment() {
  useUiLocale();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const companies = useAsync(() => joshCustomerApi.list({ search: query, limit: 100 }), [query]);
  const reps = useAsync(salesAssignmentApi.reps, []);
  const [company, setCompany] = useState<JoshRow | null>(null);
  const [repId, setRepId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const repName = (id: string | null) => id ? reps.data?.find(rep => rep.id === id)?.name || id : uiText('ยังไม่มีผู้ดูแล');

  async function save() {
    if (!company) return;
    setBusy(true); setError(null); setMessage('');
    try {
      await salesAssignmentApi.assign(company.id, repId || null);
      setCompany({ ...company, assigned_sales_user_id: repId || null });
      setMessage(uiText('กำหนดพนักงานขายสำเร็จ'));
      companies.reload();
    } catch (err) {
      // The API's 409 explains when assignments are still owned by Josh.
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  }

  return <Page><PageHeader title={uiText('มอบหมายพนักงานขาย')} />
    <ErrorText error={error || companies.error || reps.error} />
    {message && <Alert tone="ok">{message}</Alert>}
    <Panel className="p-4 space-y-4">
      <form className="flex gap-3" onSubmit={e => { e.preventDefault(); setQuery(search.trim()); setCompany(null); setRepId(''); setMessage(''); }}>
        <Input aria-label={uiText('ค้นหาบริษัท')} value={search} onChange={e => setSearch(e.target.value)} />
        <Button type="submit">{uiText('ค้นหา')}</Button>
      </form>
      {companies.loading ? <Loading /> : <Field label={uiText('บริษัท')}><Select disabled={busy} value={company?.id ?? ''} onChange={e => {
        const row = companies.data?.items.find(item => item.id === e.target.value) ?? null;
        setCompany(row); setRepId(row?.assigned_sales_user_id ?? ''); setMessage('');
      }}><option value="">{uiText('เลือกบริษัท')}</option>
        {(companies.data?.items ?? []).map(row => <option key={row.id} value={row.id}>{row.name} · {row.erp_customer_code ?? ''}</option>)}
      </Select></Field>}
      {company && <>
        <p>{uiText('ผู้ดูแลปัจจุบัน')}: {repName(company.assigned_sales_user_id)}</p>
        <Field label={uiText('พนักงานขาย')}><Select value={repId} disabled={busy || reps.loading} onChange={e => setRepId(e.target.value)}>
          <option value="">{uiText('ล้างผู้ดูแล')}</option>
          {(reps.data ?? []).map(rep => <option key={rep.id} value={rep.id}>{rep.name || rep.id}</option>)}
        </Select></Field>
        <Button disabled={busy || reps.loading || repId === (company.assigned_sales_user_id ?? '')} onClick={save}>{uiText('บันทึก')}</Button>
      </>}
    </Panel>
  </Page>;
}
