import { Fragment, useState } from 'react';
import {
  Button, Empty, ErrorText, ExpandRow, ExpandToggle, Hint, Loading, Page, PageHeader, Panel, Segmented, StatGrid, StatTile, StatusChip, Table, TBody, TD, TH, THead, TR, fmt,
} from '@cp/ui';
import { priceShadowApi } from '../../lib/api';
import { useAsync } from '../hooks';

const DIFF: Record<string, string> = { price: 'ราคา', source: 'แหล่งราคา', mechanic: 'โปรโมชัน' };

/**
 * Step 3 trial: commerce re-prices every new josh order line with josh's own price code (copied)
 * and compares with what josh charged. Nothing is written to josh.
 */
export function PriceShadow() {
  const [days, setDays] = useState(7);
  const [filter, setFilter] = useState('mismatched');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const summary = useAsync(() => priceShadowApi.summary(days), [days]);
  const list = useAsync(() => priceShadowApi.list(filter, page), [filter, page]);
  const s = summary.data;
  const refresh = () => { summary.reload(); list.reload(); };

  async function act(label: string, fn: () => Promise<unknown>, done: (r: never) => string) {
    setBusy(label); setMsg('');
    try { setMsg(done((await fn()) as never)); refresh(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  return (
    <Page>
      <PageHeader
        title="ราคา · commerce คิดคู่กับ josh (ทดลอง)"
        subtitle="ทุกบรรทัดใน order ใหม่ของ josh · commerce คิดราคาใหม่ด้วยโค้ดราคาของ josh (สำเนา) ตามบริษัท สาขา จำนวน และเวลาที่สั่ง แล้วเทียบกับที่ josh เก็บจริง · ไม่แก้อะไรใน josh"
        actions={
          <>
            <Button variant="primary" disabled={!!busy} onClick={() => act('run', priceShadowApi.run, (r: { checked: number }) => `ตรวจเพิ่ม ${r.checked} บรรทัด`)}>{busy === 'run' ? 'กำลังตรวจ…' : 'ตรวจตอนนี้'}</Button>
            <Button icon="refresh" onClick={refresh}>Refresh</Button>
          </>
        }
      />

      {msg && <Hint>{msg}</Hint>}
      <ErrorText error={summary.error || list.error} />

      {s && (
        <>
          <StatGrid cols={4}>
            <StatTile
              label={`ตรง (${days} วัน)`}
              value={s.matchRate == null ? '—' : `${s.matchRate}%`}
              foot={`${s.matched} / ${s.checked} บรรทัด`}
              tone="ok"
            />
            <StatTile
              label="ไม่ตรง"
              value={fmt.num(s.mismatched)}
              foot={`ในนี้ ${s.changed_after} บรรทัดราคาถูกแก้หลังสั่ง`}
              tone={s.mismatched ? 'warn' : 'ok'}
            />
            <StatTile
              label="commerce คิดไม่ได้"
              value={fmt.num(s.could_not_price)}
              tone={s.could_not_price ? 'danger' : 'ok'}
            />
            <StatTile
              label="ช่วงที่ตรวจ"
              value={
                <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface border border-secondary-container rounded-lg text-xs">
                  {[1, 7, 30].map((d) => <option key={d} value={d}>{d} วัน</option>)}
                </select>
              }
              foot={`${fmt.date(s.first_at)} – ${fmt.date(s.last_at)}`}
            />
          </StatGrid>

          {!!s?.mismatchBySource.length && (
            <Hint>ไม่ตรงบ่อย: {s.mismatchBySource.map((m) => `josh ${m.josh_source ?? '—'} → commerce ${m.commerce_source ?? '—'} (${m.n})`).join(' · ')}</Hint>
          )}
        </>
      )}

      <div className="space-y-3">
        <Segmented
          options={[
            { value: 'mismatched', label: 'ไม่ตรง / คิดไม่ได้' },
            { value: 'matched', label: 'ตรง' },
            { value: 'all', label: 'ทั้งหมด' },
          ]}
          value={filter}
          onChange={(v) => { setFilter(v); setPage(1); }}
        />

        <Panel className="overflow-hidden">
          {list.loading && !list.data ? (
            <Loading />
          ) : !list.data?.items.length ? (
            <Empty>{filter === 'mismatched' ? 'ไม่มีบรรทัดที่ไม่ตรง' : 'ยังไม่มีรายการ'}</Empty>
          ) : (
            <Table>
              <THead>
                <TH>Order</TH>
                <TH>SKU</TH>
                <TH>จำนวน</TH>
                <TH>สั่งเมื่อ</TH>
                <TH right>josh</TH>
                <TH right>commerce</TH>
                <TH>ผล</TH>
                <TH></TH>
              </THead>
              <TBody>
                {list.data.items.map((r) => (
                  <Fragment key={r.id}>
                    <TR>
                      <TD kind="mono">{r.orderNumber}</TD>
                      <TD kind="mono">{r.sku}</TD>
                      <TD>{r.quantity}</TD>
                      <TD kind="time">{fmt.when(r.orderedAt)}</TD>
                      <TD kind="money">{fmt.baht(r.joshUnitPrice)} <span className="text-[10px] text-on-surface-variant">{r.joshSource ?? '—'}</span></TD>
                      <TD kind="money">{fmt.baht(r.commerceUnitPrice)} <span className="text-[10px] text-on-surface-variant">{r.commerceSource ?? '—'}</span></TD>
                      <TD>
                        <StatusChip status={r.matched ? 'ok' : r.diffs.map((d) => DIFF[d] ?? d).join(', ') || 'error'} />
                        {r.note && <div className="text-[10px] text-on-surface-variant">{r.note}</div>}
                      </TD>
                      <TD kind="actions">
                        <button type="button" className="text-xs text-primary hover:underline font-medium" disabled={!!busy} onClick={() => act(r.id, () => priceShadowApi.recheck(r.joshOrderItemId), (x: { matched: boolean }) => `ตรวจซ้ำ: ${x.matched ? 'ตรง' : 'ยังไม่ตรง'}`)}>ตรวจซ้ำ</button>
                      </TD>
                    </TR>
                  </Fragment>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>

        {list.data && list.data.total > 50 && (
          <div className="flex items-center gap-3 justify-center py-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</Button>
            <Hint>หน้า {page} / {Math.ceil(list.data.total / 50)}</Hint>
            <Button size="sm" variant="secondary" disabled={page >= Math.ceil(list.data.total / 50)} onClick={() => setPage(page + 1)}>ถัดไป</Button>
          </div>
        )}
      </div>

    </Page>
  );
}
