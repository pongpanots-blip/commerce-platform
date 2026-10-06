import { useState } from 'react';
import { Button, Chip, Empty, ErrorText, FilterChip, Loading, Page, PageHeader, Panel, Pager, TBody, TD, TH, THead, TR, Table, fmt } from '@cp/ui';
import { livechatApi } from '../../lib/api';
import { useAsync } from '../hooks';

const PAGE_SIZE = 100;

/**
 * Shop live chat that commerce relays between josh and CS-CRM (josh LIVECHAT_VIA_COMMERCE + CS-CRM
 * pointing its outbound webhook here). Agents keep answering in CS-CRM; this is the record.
 */
export function Livechat() {
  const [visitor, setVisitor] = useState('');
  const [page, setPage] = useState(1);
  const list = useAsync(() => livechatApi.list(visitor, page), [visitor, page]);
  const pick = (v: string) => { setVisitor(v); setPage(1); };

  return (
    <Page>
      <PageHeader
        title="Live chat"
        subtitle="ข้อความแชตหน้าร้านที่วิ่งผ่าน commerce (ลูกค้า → CS-CRM และคำตอบ → ลูกค้า) · CS ยังตอบใน CS-CRM"
        actions={<Button icon="refresh" onClick={list.reload}>Refresh</Button>}
      />
      {visitor && (
        <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
          ตัวกรอง: <FilterChip onRemove={() => pick('')}>ผู้เยี่ยมชม <span className="font-mono">{visitor}</span></FilterChip>
        </div>
      )}
      <ErrorText error={list.error} />
      <Panel className="overflow-hidden">
        {list.loading && !list.data ? (
          <Loading />
        ) : list.data?.items.length ? (
          <>
            <Table maxHeight="calc(100vh - 280px)">
              <THead>
                <TH>เวลา</TH>
                <TH>ทาง</TH>
                <TH>ผู้เยี่ยมชม</TH>
                <TH>ข้อความ</TH>
                <TH>ผล</TH>
              </THead>
              <TBody>
                {list.data.items.map((r) => (
                  <TR key={r.id}>
                    <TD kind="time">{fmt.when(r.createdAt)}</TD>
                    <TD>
                      <Chip tone={r.direction === 'to_cs_crm' ? 'info' : 'primary'}>{r.direction === 'to_cs_crm' ? 'ลูกค้า → CS' : 'CS → ลูกค้า'}</Chip>
                    </TD>
                    <TD>
                      {r.visitorId ? (
                        <button type="button" className="font-mono text-[11px] text-primary hover:underline" onClick={() => pick(r.visitorId!)} title="ดูเฉพาะผู้เยี่ยมชมนี้">
                          {r.visitorId.slice(0, 12)}
                        </button>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD className="max-w-[520px] whitespace-pre-wrap break-words">{r.text ?? '—'}</TD>
                    <TD><Chip tone={r.status < 300 ? 'ok' : 'danger'}>{r.status}</Chip></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />
          </>
        ) : (
          <Empty icon="forum">ยังไม่มีข้อความผ่าน commerce</Empty>
        )}
      </Panel>
    </Page>
  );
}
