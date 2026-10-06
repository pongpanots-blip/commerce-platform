import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, Empty, ErrorText, Loading, Page, PageHeader, Panel, PanelHead, Pager, SearchInput, Select,
  Table, TBody, TD, TH, THead, TR, fmt,
} from '@cp/ui';
import { scrapingApi } from '../../lib/api';
import { useAsync } from '../hooks';

/** Products collected from competitor sites (moved from josh). */
export function ScrapedCatalog() {
  const sources = useAsync(() => scrapingApi.sources(), []);
  const navigate = useNavigate();
  // "ดูรายการ" on a scraping-sources card links here with ?sourceId= (same as josh).
  const [sourceId, setSourceId] = useState(() => new URLSearchParams(window.location.search).get('sourceId') || '');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const items = useAsync(() => scrapingApi.items(sourceId, search, page), [sourceId, search, page]);

  function submit(e: FormEvent) { e.preventDefault(); setPage(1); setSearch(query.trim()); }
  const maxPage = items.data ? Math.max(1, Math.ceil(items.data.total / items.data.pageSize)) : 1;

  return (
    <Page>
      <PageHeader
        title="คลังข้อมูลเว็บคู่แข่ง"
        subtitle="สินค้าและราคาที่เก็บจากเว็บสาธารณะ · จับคู่กับ SKU ของเราที่หน้าเทียบราคาคู่แข่ง"
        actions={<Button icon="refresh" onClick={items.reload}>Refresh</Button>}
      />

      <Panel>
        <PanelHead title="ค้นหา" />
        <form onSubmit={submit}>
        <div className="space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Select value={sourceId} onChange={(e) => { setSourceId(e.target.value); setPage(1); }}>
              <option value="">เว็บ — ทั้งหมด</option>
              {(sources.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ชื่อสินค้าหรือ SKU"
              onKeyDown={(e) => { if (e.key === 'Enter' && !items.loading) submit(e as unknown as FormEvent); }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" icon="search">ค้นหา</Button>
            <span className="text-xs text-on-surface-variant">{fmt.num(items.data?.total ?? 0)} รายการ</span>
          </div>
        </div>
        </form>
      </Panel>

      <Panel>
        <ErrorText error={items.error} />
        {items.loading ? (
          <Loading />
        ) : !items.data?.items.length ? (
          <Empty>ยังไม่มีข้อมูล</Empty>
        ) : (
          <>
            <Table>
              <THead>
                <TH>สินค้า</TH>
                <TH>เว็บ</TH>
                <TH right>ราคา (รวม VAT)</TH>
                <TH>น้ำหนัก</TH>
                <TH>พบเมื่อ</TH>
                <TH right />
              </THead>
              <TBody>
                {items.data.items.map((item) => (
                  <TR key={item.id}>
                    <TD>
                      <a href={item.url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                        {item.name}
                      </a>
                      {item.sku && <div className="text-[10px] font-mono text-on-surface-variant">{item.sku}</div>}
                      {!item.configCurrent && <div className="text-[10px] text-on-surface-variant">ตั้งค่าเว็บเปลี่ยนหลังเก็บ — ควรเก็บใหม่</div>}
                    </TD>
                    <TD kind="muted">{item.source?.name ?? '—'}</TD>
                    <TD kind="money">
                      {item.currency === 'THB' ? fmt.baht(item.priceIncVat) : `${item.priceIncVat ?? '—'} ${item.currency}`}
                    </TD>
                    <TD kind="text">{item.weightKg == null ? 'ไม่ชัดเจน' : `${item.weightKg} กก.`}</TD>
                    <TD kind="time">{fmt.when(item.observedAt)}</TD>
                    <TD kind="actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/marketing/competitor-prices?catalogItem=${item.id}`)}
                      >
                        จับคู่ SKU
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pager
              page={page}
              pageSize={items.data.pageSize}
              total={items.data.total}
              onPage={setPage}
            />
          </>
        )}
      </Panel>
    </Page>
  );
}
