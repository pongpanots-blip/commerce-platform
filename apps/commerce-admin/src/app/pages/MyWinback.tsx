import { useState } from 'react';
import { Button, Empty, ErrorText, Input, Loading, Page, PageHeader, Pager, Panel, Select, Table, TBody, TD, TH, THead, TR, uiText, useUiLocale } from '@cp/ui';
import { api, session } from '../../lib/api';
import { useAsync } from '../hooks';

type Opportunity = { id: string; name: string; district: string | null; meta: { stage: string | null; ownerSalesUserId: string | null; ownerName: string | null } };
type Lead = { id: string; displayName: string; stage: string; assignedSalesUserId: string | null };

/** Commerce staff reads only: own + unassigned from the same visibility rule as the sales app. */
export function MyWinback() {
  useUiLocale();
  const team = ['admin', 'sales_manager', 'business_analyst'].includes(session.claims()?.role ?? '');
  const prefix = team ? '/reports/winback' : '/reports/winback/my';
  const [tab, setTab] = useState('opportunities');
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const limit = 20;
  const result = useAsync(async () => {
    const query = new URLSearchParams({ page: String(page), limit: String(limit), search });
    if (tab === 'opportunities') {
      const res = await api.get<{ data: { items: Opportunity[]; pagination: { total: number } } }>(`${prefix}/opportunities?${query}`);
      return { items: res.data.items.map(row => ({ id: row.id, name: row.name, stage: row.meta.stage, owner: row.meta.ownerSalesUserId, ownerName: row.meta.ownerName })), total: res.data.pagination.total };
    }
    const res = await api.get<{ data: Lead[]; meta: { total: number } }>(`${prefix}/pool?${query}`);
    return { items: res.data.map(row => ({ id: row.id, name: row.displayName, stage: row.stage, owner: row.assignedSalesUserId, ownerName: null })), total: res.meta.total };
  }, [tab, page, search, team]);
  return <Page><PageHeader title={uiText(team ? 'โอกาสของทีม' : 'โอกาสและลีดของฉัน')} subtitle={uiText(team ? 'โอกาสและลีดของทีมขาย' : 'เฉพาะของฉันและที่ยังไม่มีผู้ดูแล')} />
    <ErrorText error={result.error} />
    <Panel className="p-4">
      <form className="flex gap-3" onSubmit={e => { e.preventDefault(); setSearch(draft.trim()); setPage(1); }}>
        <Select value={tab} onChange={e => { setTab(e.target.value); setPage(1); }}>
          <option value="opportunities">{uiText('โอกาส')}</option><option value="pool">{uiText('ลีด')}</option>
        </Select>
        <Input aria-label={uiText('ค้นหา')} value={draft} onChange={e => setDraft(e.target.value)} />
        <Button type="submit">{uiText('ค้นหา')}</Button>
      </form>
      {result.loading ? <Loading /> : !result.data?.items.length ? <Empty>{uiText('ไม่มีข้อมูล')}</Empty> : <>
        <Table><THead><TH>{uiText('ชื่อ')}</TH><TH>{uiText('สถานะ')}</TH><TH>{uiText('ผู้ดูแล')}</TH></THead>
          <TBody>{result.data.items.map(row => <TR key={row.id}><TD>{row.name}</TD><TD>{row.stage ?? '—'}</TD><TD>{row.owner ? team ? row.ownerName || row.owner : uiText('ของฉัน') : uiText('ยังไม่มีผู้ดูแล')}</TD></TR>)}</TBody>
        </Table><Pager page={page} pageSize={limit} total={result.data.total} onPage={setPage} />
      </>}
    </Panel>
  </Page>;
}
