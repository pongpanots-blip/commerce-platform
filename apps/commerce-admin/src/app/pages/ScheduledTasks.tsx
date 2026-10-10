import { useState } from 'react';
import { scheduledTasksApi, ScheduledTaskRow } from '../../lib/api';
import { useAsync } from '../hooks';
import { Page, PageHeader, Panel, Table, THead, TH, TBody, TR, TD, ErrorText, Empty, Loading, Button, Chip, Tone, fmt } from '@cp/ui';
import { uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';

/** Task name (backend decorator) → what it does, in staff words. Unknown names show the raw name. */
const LABELS: Record<string, string> = {
  'competitor-prices-refresh': 'อัปเดตราคาคู่แข่ง',
  'erp-fallback-replay': 'นำข้อมูลระบบหลัก (ERP) ที่รับไว้ตอนระบบล่มมาลงใหม่',
  'jagota-shadow': 'ทดลองสร้างออเดอร์ส่งระบบหลักเทียบกับของจริง',
  'jagota-sync-import': 'คัดลอกประวัติการส่งออเดอร์เข้าระบบหลัก',
  'josh-bestsellers': 'คำนวณสินค้าขายดีให้หน้าร้าน',
  'josh-catalog-sync': 'คัดลอกแค็ตตาล็อกสินค้าจากร้านค้า',
  'josh-customer-metrics': 'คำนวณยอดสั่งซื้อของลูกค้า',
  'josh-order-copy': 'คัดลอกออเดอร์จากร้านค้า',
  'marketing-research': 'รันโจทย์ research ที่ถึงคิว',
  'marketing-workflow-sweep': 'เดินขั้นตอนข้อความอัตโนมัติ',
  'mcp-oauth-purge': 'ลบสิทธิ์ผู้ช่วย AI ที่หมดอายุ',
  'outbox-relay': 'ส่งเหตุการณ์ที่รอส่ง',
  'price-shadow': 'เทียบราคาที่คำนวณใหม่',
  'reservation-expiry': 'คืนสต็อกที่จองไว้แต่หมดเวลา',
  'scraping-tick': 'เก็บข้อมูลเว็บคู่แข่งที่ถึงเวลา',
  'staff-prices-import': 'นำเข้าราคาเฉพาะลูกค้าและราคาสัญญาจากร้านค้า',
  'webhook-delivery-monitor': 'ตรวจสุขภาพการส่งเหตุการณ์ขาออก',
  'winback-aging-leads': 'เตือนเซลส์เรื่องลูกค้าที่ค้างนาน',
  'winback-appointments-due': 'เตือนเซลส์ก่อนถึงนัดหมาย',
  'winback-daily-digest': 'สรุปงานติดตามลูกค้าประจำวัน',
  'winback-mirror': 'ซิงก์ข้อมูลงานติดตามลูกค้ากับร้านค้า',
};

/** Problems first, then running, then on, then off (alphabetical inside each). */
const rank = (t: ScheduledTaskRow) => (!t.enabled ? 3 : t.last?.problem ? 0 : t.running > 0 ? 1 : 2);

function statusOf(t: ScheduledTaskRow): [Tone, string] {
  if (!t.enabled) return ['muted', 'ปิดใช้งาน'];
  if (t.running > 0) return ['info', 'กำลังรัน'];
  if (!t.last) return ['muted', 'ยังไม่ได้รัน'];
  return t.last.problem ? ['danger', 'มีปัญหา'] : ['ok', 'ปกติ'];
}

/** Jobs the platform runs on its own: is each on, did the last run work, when is the next one — and run a cron now. */
export function ScheduledTasks() {
  __useUiLocale();
  const { data, loading, error, reload } = useAsync(() => scheduledTasksApi.list(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function runNow(t: ScheduledTaskRow) {
    const label = __uiText(LABELS[t.name] ?? t.name);
    if (!window.confirm(__uiText('สั่งรัน "{0}" ตอนนี้เลยไหม', { 0: label }))) return;
    setBusy(t.name);
    setActionError(null);
    try {
      await scheduledTasksApi.run(t.name);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page>
      <PageHeader
        title={__uiText('งานอัตโนมัติตามเวลา')}
        subtitle={data ? __uiText('ข้อมูลการรันนับตั้งแต่ระบบเริ่มทำงานเมื่อ {0}', { 0: fmt.when(data.since) }) : undefined}
        actions={<Button icon="refresh" onClick={reload}>{__uiText('รีเฟรช')}</Button>}
      />
      <Panel>
        <ErrorText error={error} />
        <ErrorText error={actionError} />
        {loading && !data ? <Loading /> : !data?.tasks.length ? <Empty>{__uiText('ไม่มีงานอัตโนมัติ')}</Empty> : (
          <Table>
            <THead>
              <TH>{__uiText('งาน')}</TH><TH>{__uiText('รอบเวลา')}</TH><TH>{__uiText('สถานะ')}</TH><TH>{__uiText('รันล่าสุด')}</TH>
              <TH>{__uiText('สำเร็จล่าสุด')}</TH><TH>{__uiText('รันถัดไป')}</TH><TH>{__uiText('ปัญหาล่าสุด')}</TH><TH></TH>
            </THead>
            <TBody>
              {[...data.tasks].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map((t) => {
                const [tone, status] = statusOf(t);
                return (
                  <TR key={t.name}>
                    <TD>
                      <div>{LABELS[t.name] ? __uiText(LABELS[t.name]) : t.name}</div>
                      <div className="font-mono text-[11px] text-on-surface-variant">{t.name}</div>
                    </TD>
                    <TD kind="mono" className="whitespace-nowrap">{t.kind === 'interval' ? __uiText('ทุก {0} วินาที', { 0: (t.intervalMs ?? 0) / 1000 }) : t.expression}</TD>
                    <TD><Chip tone={tone}>{__uiText(status)}</Chip></TD>
                    <TD kind="time">
                      {t.last ? fmt.when(t.last.startedAt) : '—'}
                      {t.last?.manual && <span className="ml-1 text-on-surface-variant">{__uiText('(สั่งเอง)')}</span>}
                    </TD>
                    <TD kind="time">{t.lastSuccessAt ? fmt.when(t.lastSuccessAt) : '—'}</TD>
                    <TD kind="time">{t.nextRunAt ? fmt.when(t.nextRunAt) : '—'}</TD>
                    <TD className="text-xs text-on-surface-variant max-w-xs">
                      {t.lastProblem ? <span title={t.lastProblem.message}>{fmt.when(t.lastProblem.at)} · <span className="line-clamp-2 break-words">{t.lastProblem.message}</span></span> : '—'}
                    </TD>
                    <TD kind="actions">
                      {t.kind === 'cron' && (
                        <Button
                          disabled={!t.enabled || t.running > 0 || busy === t.name}
                          title={!t.enabled ? __uiText('ปิดด้วยการตั้งค่า รันเองไม่ได้') : undefined}
                          onClick={() => runNow(t)}
                        >{busy === t.name ? '…' : __uiText('รันเลย')}</Button>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Panel>
    </Page>
  );
}
