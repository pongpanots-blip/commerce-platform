// ui-copy-migration: only literal UI copy and notification templates
import { useState } from 'react';
import { Button, Empty, ErrorText, Loading, Panel, PanelHead, StatusChip, Table, TBody, TD, TH, THead, TR, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import { flowsApi } from '../../../lib/api';
import { useAsync } from '../../hooks';
import { itemOf } from './palette-items';

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
const when = (v: string | null) => (v ? new Date(v).toLocaleString() : '—');

/** Results tab: totals, per-branch A/B, holdout vs treated, enrollments with their logs. Test runs excluded server-side. */
export function FlowResults({ id }: { id: string }) {
  __useUiLocale();
  const stats = useAsync(() => flowsApi.analytics(id), [id]);
  const [page, setPage] = useState(1);
  const list = useAsync(() => flowsApi.enrollments(id, page), [id, page]);
  const [open, setOpen] = useState<string | null>(null);
  const logs = useAsync(() => (open ? flowsApi.logs(id, open) : Promise.resolve(null)), [id, open]);
  if (stats.loading && !stats.data) return <Loading />;
  if (stats.error || !stats.data) return <ErrorText error={stats.error} onRetry={stats.reload} />;
  const s = stats.data;
  const COUNT_LABEL: Record<string, string> = { enrolled: __uiText('เข้า workflow'), running: __uiText('กำลังรอ'), completed: __uiText('ครบ flow'),
    skipped: __uiText('ข้าม'), failed: __uiText('ล้มเหลว'), converted: __uiText('สั่งซื้อ (converted)'), holdout: __uiText('Holdout') };
  return (
    <div className="mt-3 space-y-4">
      <Panel>
        <PanelHead title={__uiText('ภาพรวม')} actions={<Button size="sm" variant="ghost" icon="refresh" onClick={() => { stats.reload(); list.reload(); }}>{__uiText('รีเฟรช')}</Button>} />
        <div className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
          {Object.entries(s.counts).map(([k, v]) => <div key={k}><div className="text-on-surface-variant">{COUNT_LABEL[k] ?? k}</div><div className="text-xl font-semibold">{v}</div></div>)}
        </div>
        <p className="px-4 pb-4 text-sm">{__uiText('Conversion: ได้รับข้อความ {0} · Holdout {1}', { 0: pct(s.treated.converted, s.treated.enrolled), 1: pct(s.holdout.converted, s.holdout.enrolled) })}</p>
      </Panel>
      {s.splits.map((sp) => (
        <Panel key={sp.stepId}>
          <PanelHead title={__uiText('A/B Split')} />
          <Table>
            <THead><TH>{__uiText('กิ่ง')}</TH><TH kind="num">{__uiText('เข้า')}</TH><TH kind="num">{__uiText('ซื้อ')}</TH><TH kind="num">%</TH></THead>
            <TBody>{sp.branches.map((b) => <TR key={b.branchId}><TD>{b.label}</TD><TD kind="num">{b.entered}</TD><TD kind="num">{b.converted}</TD><TD kind="num">{pct(b.converted, b.entered)}</TD></TR>)}</TBody>
          </Table>
        </Panel>
      ))}
      <Panel>
        <PanelHead title={__uiText('ผลการส่ง')} />
        {s.actions.length ? (
          <Table>
            <THead><TH>{__uiText('ประเภท')}</TH><TH>{__uiText('สถานะ')}</TH><TH kind="num">{__uiText('จำนวน')}</TH></THead>
            <TBody>{s.actions.map((a) => <TR key={`${a.kind}:${a.status}`}><TD>{itemOf(a.kind)?.label ?? a.kind}</TD><TD><StatusChip status={a.status} /></TD><TD kind="num">{a.count}</TD></TR>)}</TBody>
          </Table>
        ) : <Empty>{__uiText('ยังไม่มีการส่ง')}</Empty>}
      </Panel>
      <Panel>
        <PanelHead title={__uiText('ลูกค้าที่เข้า workflow')} />
        {list.data?.rows.length ? (
          <Table>
            <THead><TH>{__uiText('ลูกค้า')}</TH><TH>{__uiText('สถานะ')}</TH><TH kind="time">{__uiText('เริ่ม')}</TH><TH>{__uiText('เหตุผล')}</TH><TH kind="actions" /></THead>
            <TBody>{list.data.rows.map((r) => (
              <TR key={r.id}>
                <TD kind="mono">{r.userId ? r.userId.slice(0, 8) : `guest ${(r.deviceId ?? '').slice(0, 8)}`}{r.isTest ? __uiText(' (ทดสอบ)') : ''}{r.isHoldout ? __uiText(' (กลุ่มที่ไม่ส่ง เพื่อเทียบผล)') : ''}</TD>
                <TD><StatusChip status={r.status} /></TD><TD kind="time">{when(r.startedAt)}</TD><TD>{r.endReason ?? ''}</TD>
                <TD kind="actions"><Button size="sm" variant="ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>{__uiText('ดูบันทึก')}</Button></TD>
              </TR>
            ))}</TBody>
          </Table>
        ) : <Empty>{__uiText('ยังไม่มีลูกค้าเข้า workflow')}</Empty>}
        {open && logs.data && <pre className="m-4 max-h-60 overflow-auto rounded bg-surface-container p-2 text-xs">{JSON.stringify(logs.data, null, 2)}</pre>}
        {list.data && list.data.total > 50 && (
          <div className="flex gap-2 p-4">
            <Button size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>{__uiText('ก่อนหน้า')}</Button>
            <Button size="sm" disabled={page * 50 >= list.data.total} onClick={() => setPage(page + 1)}>{__uiText('ถัดไป')}</Button>
          </div>
        )}
      </Panel>
    </div>
  );
}
