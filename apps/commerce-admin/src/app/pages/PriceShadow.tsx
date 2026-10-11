// ui-metadata-migration: static labels and UI notices only
import { Fragment, useState } from 'react';
import {
  Button, Chip, Empty, ErrorText, ExpandRow, ExpandToggle, Hint, Loading, Page, PageHeader, Panel, Segmented, Select, StatGrid, StatTile, Table, TBody, TD, TH, THead, TR, fmt,
} from '@cp/ui';
import { priceShadowApi } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const DIFF: Record<string, string> = { price: 'ราคา', source: 'แหล่งราคา', mechanic: 'โปรโมชัน' };

/**
 * Step 3 trial: commerce re-prices every new josh order line with josh's own price code (copied)
 * and compares with what josh charged. Nothing is written to josh.
 */
export function PriceShadow() {
  __useUiLocale();
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
        title={__uiText("เทียบราคาที่คำนวณใหม่")}
        subtitle={__uiText("เทียบราคาที่ระบบใหม่คำนวณกับราคาที่ร้านค้าใช้อยู่")}
        actions={
          <>
            <Button variant="primary" disabled={!!busy} onClick={() => act('run', priceShadowApi.run, (r: { checked: number }) => __uiText('ตรวจเพิ่ม {0} บรรทัด', { 0: r.checked }))}>{busy === 'run' ? __uiText("กำลังตรวจ…") : __uiText("ตรวจตอนนี้")}</Button>
            <Button icon="refresh" onClick={refresh}>{__uiText("Refresh")}</Button>
          </>
        }
      />

      <Hint>{__uiText("ระบบใหม่คำนวณราคาของทุกบรรทัดในออเดอร์ใหม่ตามบริษัท สาขา จำนวน และเวลาที่สั่ง แล้วเทียบกับราคาที่ร้านค้าเก็บจริง หน้านี้เทียบอย่างเดียว ไม่แก้ราคาในร้านค้า")}</Hint>
      {msg && <Hint>{(typeof msg === 'string' ? __uiText(msg) : msg)}</Hint>}
      <ErrorText error={summary.error || list.error} />

      {s && (
        <>
          <StatGrid cols={4}>
            <StatTile
              label={__uiText("ตรง ({0} วัน)", {"0": days})}
              value={s.matchRate == null ? '—' : `${s.matchRate}%`}
              foot={__uiText("{0} / {1} บรรทัด",{'0':s.matched,'1':s.checked})}
              tone="ok"
            />
            <StatTile
              label={__uiText("ไม่ตรง")}
              value={fmt.num(s.mismatched)}
              foot={__uiText("ในนี้ {0} บรรทัดราคาถูกแก้หลังสั่ง",{'0':s.changed_after})}
              tone={s.mismatched ? 'warn' : 'ok'}
            />
            <StatTile
              label={__uiText("ระบบใหม่คำนวณไม่ได้")}
              value={fmt.num(s.could_not_price)}
              tone={s.could_not_price ? 'danger' : 'ok'}
            />
            <StatTile
              label={__uiText("ช่วงที่ตรวจ")}
              value={
                <Select aria-label={__uiText("ช่วงที่ตรวจ")} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {[1, 7, 30].map((d) => <option key={d} value={d}>{d} {__uiText(" วัน")}</option>)}
                </Select>
              }
              foot={__uiText("{0} – {1}",{'0':fmt.date(s.first_at),'1':fmt.date(s.last_at)})}
            />
          </StatGrid>

          {!!s?.mismatchBySource.length && (
            <Hint>{__uiText("ไม่ตรงบ่อย: ")}{s.mismatchBySource.map((m) => __uiText('ร้านค้าใช้ {0} แต่ระบบใหม่ใช้ {1} ({2} บรรทัด)', { 0: m.josh_source ?? '—', 1: m.commerce_source ?? '—', 2: fmt.num(m.n) })).join(' · ')}</Hint>
          )}
        </>
      )}

      <div className="space-y-3">
        <Segmented
          options={[
            { value: 'mismatched', label: __uiText("ไม่ตรง / คิดไม่ได้") },
            { value: 'matched', label: __uiText("ตรง") },
            { value: 'all', label: __uiText("ทั้งหมด") },
          ]}
          value={filter}
          onChange={(v) => { setFilter(v); setPage(1); }}
        />

        <Panel className="overflow-hidden">
          {list.loading && !list.data ? (
            <Loading />
          ) : !list.data?.items.length ? (
            <Empty>{filter === 'mismatched' ? __uiText("ไม่มีบรรทัดที่ไม่ตรง") : __uiText("ยังไม่มีรายการ")}</Empty>
          ) : (
            <Table>
              <THead>
                <TH>{__uiText("เลขออเดอร์")}</TH>
                <TH>{__uiText("รหัสสินค้า")}</TH>
                <TH right>{__uiText("จำนวน")}</TH>
                <TH>{__uiText("สั่งเมื่อ")}</TH>
                <TH right>{__uiText("ราคาร้านค้า")}</TH>
                <TH right>{__uiText("ราคาที่คำนวณใหม่")}</TH>
                <TH>{__uiText("ผล")}</TH>
                <TH></TH>
              </THead>
              <TBody>
                {list.data.items.map((r) => (
                  <Fragment key={r.id}>
                    <TR>
                      <TD kind="mono">{r.orderNumber}</TD>
                      <TD kind="mono">{r.sku}</TD>
                      <TD kind="num">{fmt.num(r.quantity)}</TD>
                      <TD kind="time">{fmt.when(r.orderedAt)}</TD>
                      <TD kind="money">{fmt.baht(r.joshUnitPrice)} <span className="font-mono text-[10px] text-on-surface-variant">{r.joshSource ?? '—'}</span></TD>
                      <TD kind="money">{fmt.baht(r.commerceUnitPrice)} <span className="font-mono text-[10px] text-on-surface-variant">{r.commerceSource ?? '—'}</span></TD>
                      <TD>
                        {r.matched ? <Chip tone="ok" dot>{__uiText('ตรง')}</Chip>
                          : r.diffs.length ? <Chip tone="warn" dot>{__uiText('ไม่ตรง: {0}', { 0: r.diffs.map((d) => (DIFF[d] ? __uiText(DIFF[d]) : d)).join(', ') })}</Chip>
                          : <Chip tone="danger" dot>{__uiText('คำนวณไม่ได้')}</Chip>}
                        {r.note && <div className="text-[10px] text-on-surface-variant">{r.note}</div>}
                      </TD>
                      <TD kind="actions">
                        <Button size="sm" disabled={!!busy} onClick={() => act(r.id, () => priceShadowApi.recheck(r.joshOrderItemId), (x: { matched: boolean }) => __uiText(x.matched ? 'ตรวจซ้ำแล้ว: ตรง' : 'ตรวจซ้ำแล้ว: ยังไม่ตรง'))}>{__uiText("ตรวจซ้ำ")}</Button>
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
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{__uiText("ก่อนหน้า")}</Button>
            <Hint>{__uiText("หน้า ")}{page} / {Math.ceil(list.data.total / 50)}</Hint>
            <Button size="sm" variant="secondary" disabled={page >= Math.ceil(list.data.total / 50)} onClick={() => setPage(page + 1)}>{__uiText("ถัดไป")}</Button>
          </div>
        )}
      </div>

    </Page>
  );
}
