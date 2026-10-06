import { ReactNode, useState } from 'react';
import {
  BarList, Button, Chip, Empty, ErrorText, Field, Loading, Page, PageHeader, Panel, PanelHead, Select, StatGrid,
  StatTile, TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { HealthReport, PeriodParams, REPORT_PERIODS, ReportPeriod, reportsApi } from '../../lib/api';
import { useAsync } from '../hooks';

const PERIOD_LABEL: Record<ReportPeriod, string> = {
  today: 'วันนี้', yesterday: 'เมื่อวาน', this_week: 'สัปดาห์นี้', last_7_days: '7 วันล่าสุด',
  this_month: 'เดือนนี้', last_month: 'เดือนที่แล้ว', last_30_days: '30 วันล่าสุด', custom: 'กำหนดเอง',
};

/** Period picker + load; every report page is "pick a period, show what came back". */
function useReport<T>(load: (p: PeriodParams) => Promise<T>) {
  const [p, setP] = useState<PeriodParams>({ period: 'this_month' });
  const ready = p.period !== 'custom' || (!!p.fromDate && !!p.toDate);
  const state = useAsync<T | null>(() => (ready ? load(p) : Promise.resolve(null)), [p.period, p.fromDate, p.toDate]);
  const picker = (
    <div className="flex items-center gap-3">
      <Select value={p.period} onChange={(e) => setP({ period: e.target.value as ReportPeriod })}>
        {REPORT_PERIODS.map((k) => <option key={k} value={k}>{PERIOD_LABEL[k]}</option>)}
      </Select>
      {p.period === 'custom' && (
        <>
          <input type="date" value={p.fromDate ?? ''} onChange={(e) => setP({ ...p, fromDate: e.target.value })} aria-label="ตั้งแต่" className="px-2 py-1 border border-secondary-container rounded text-xs" />
          <input type="date" value={p.toDate ?? ''} onChange={(e) => setP({ ...p, toDate: e.target.value })} aria-label="ถึง" className="px-2 py-1 border border-secondary-container rounded text-xs" />
        </>
      )}
      <Button variant="ghost" onClick={state.reload}>Refresh</Button>
    </div>
  );
  return { ...state, picker };
}

function Change({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-on-surface-variant">ไม่มีข้อมูลช่วงก่อน</span>;
  return <Chip tone={pct >= 0 ? 'ok' : 'danger'}>{pct >= 0 ? '+' : ''}{pct}%</Chip>;
}

export function SalesReport() {
  const { data, loading, error, picker } = useReport(reportsApi.sales);
  const t = data?.totals;
  const series = data?.byDay ?? data?.byMonth ?? [];

  return (
    <Page>
      <PageHeader
        title="ยอดขาย"
        subtitle="ออเดอร์ที่จ่ายแล้ว (paid/preparing/shipped/delivered) · บาทรวม VAT หลังส่วนลด · อ่านจาก replica ของ josh"
        actions={picker}
      />
      <div className="border-t border-secondary-container" />

      <ErrorText error={error} />

      {loading && !data ? (
        <Loading />
      ) : data && t ? (
        <>
          <div className="px-4 py-2 text-xs text-on-surface-variant">
            {data.period} · เทียบกับ {data.vsPreviousPeriod.period}
          </div>

          <StatGrid cols={4}>
            <StatTile
              label="ยอดขาย"
              value={fmt.baht(t.revenue_inc_vat)}
              foot={<Change pct={data.vsPreviousPeriod.revenue_change_percent} />}
            />
            <StatTile
              label="ออเดอร์"
              value={fmt.num(t.orders)}
              foot={<Change pct={data.vsPreviousPeriod.orders_change_percent} />}
            />
            <StatTile
              label="เฉลี่ยต่อออเดอร์"
              value={fmt.baht(t.average_order_inc_vat)}
            />
            <StatTile
              label="ลูกค้าที่ซื้อ"
              value={fmt.num(t.buying_customers)}
              foot={<span className="text-xs text-on-surface-variant">{fmt.num(t.buying_companies)} บริษัท · ใหม่ {fmt.num(t.new_customers)}</span>}
            />
            <StatTile
              label="ส่วนลดรวม"
              value={fmt.baht(t.discounts_inc_vat)}
            />
            <StatTile
              label="รอชำระ / ยกเลิก"
              value={`${fmt.num(t.awaiting_payment)} / ${fmt.num(t.cancelled)}`}
            />
            {t.settled_without_payment > 0 && (
              <StatTile
                accent
                tone="warn"
                icon="warning"
                label="ไม่นับเป็นยอดขาย"
                value={fmt.baht(t.settled_without_payment_value)}
                foot={<span className="text-xs text-on-surface-variant">{fmt.num(t.settled_without_payment)} ออเดอร์ · ดูที่ Orders (josh)</span>}
              />
            )}
            <StatTile
              label="คืนเงิน"
              value={fmt.baht(t.refunds.amount)}
              foot={<span className="text-xs text-on-surface-variant">{fmt.num(t.refunds.n)} รายการ</span>}
            />
          </StatGrid>

          <Panel>
            <PanelHead title={`ยอดขาย${data.byMonth ? 'รายเดือน' : 'รายวัน'}`} />
            {series.length ? (
              <BarList rows={series.map((s) => ({ label: s.bucket, value: s.revenue_inc_vat, text: `${fmt.baht(s.revenue_inc_vat)} · ${s.orders}` }))} />
            ) : (
              <Empty>ไม่มีข้อมูลในช่วงนี้</Empty>
            )}
          </Panel>

          <Panel>
            <PanelHead title="สินค้าขายดี" />
            {data.topProducts.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH>SKU</TH>
                    <TH>สินค้า</TH>
                    <TH>จำนวน</TH>
                    <TH>ยอดขาย</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.topProducts.map((p) => (
                    <TR key={p.sku}>
                      <TD kind="code">{p.sku}</TD>
                      <TD>{p.name}</TD>
                      <TD>{fmt.num(p.qty)}</TD>
                      <TD kind="money">{fmt.baht(p.revenue_inc_vat)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <Empty>ไม่มีข้อมูลในช่วงนี้</Empty>
            )}
          </Panel>
        </>
      ) : (
        <Empty>เลือกวันที่ให้ครบ</Empty>
      )}
    </Page>
  );
}

const FUNNEL_STEPS: [string, string][] = [
  ['view_item', 'ดูสินค้า'], ['add_to_cart', 'ใส่ตะกร้า'], ['begin_checkout', 'เริ่ม checkout'], ['purchase', 'ซื้อ'],
];

export function TrafficReport() {
  const { data, loading, error, picker } = useReport(reportsApi.traffic);
  const t = data?.totals;

  return (
    <Page>
      <PageHeader
        title="Traffic"
        subtitle="ผู้เข้าชม การค้นหา และ funnel ของหน้าร้าน josh · อ่านจาก replica ของ josh"
        actions={picker}
      />
      <div className="border-t border-secondary-container" />

      <ErrorText error={error} />

      {loading && !data ? (
        <Loading />
      ) : data && t ? (
        <>
          <div className="px-4 py-2 text-xs text-on-surface-variant">
            {data.period} · เทียบกับ {data.vsPreviousPeriod.period} · {data.note}
          </div>

          <StatGrid cols={4}>
            <StatTile
              label="Sessions"
              value={fmt.num(t.sessions)}
              foot={<Change pct={data.vsPreviousPeriod.sessions_change_percent} />}
            />
            <StatTile
              label="Visitors"
              value={fmt.num(t.visitors)}
            />
            <StatTile
              label="Login แล้ว"
              value={fmt.num(t.logged_in_users)}
            />
            <StatTile
              label="ดูสินค้า"
              value={fmt.num(t.product_views)}
            />
            <StatTile
              label="ค้นหา"
              value={fmt.num(t.searches)}
            />
            <StatTile
              label="ใส่ตะกร้า"
              value={fmt.num(t.add_to_carts)}
            />
            <StatTile
              label="ซื้อ"
              value={fmt.num(t.purchases)}
            />
          </StatGrid>

          <Panel>
            <PanelHead title="Funnel (sessions)" />
            {FUNNEL_STEPS.filter(([k]) => k in data.funnelSessions).length ? (
              <BarList rows={FUNNEL_STEPS.filter(([k]) => k in data.funnelSessions).map(([k, label]) => ({ label, value: data.funnelSessions[k], text: fmt.num(data.funnelSessions[k]) }))} />
            ) : (
              <Empty>ไม่มีข้อมูลในช่วงนี้</Empty>
            )}
          </Panel>

          <Panel>
            <PanelHead title="Sessions รายวัน" />
            {data.sessionsByDay.length ? (
              <BarList rows={data.sessionsByDay.map((d) => ({ label: d.day, value: d.sessions, text: fmt.num(d.sessions) }))} />
            ) : (
              <Empty>ไม่มีข้อมูลในช่วงนี้</Empty>
            )}
          </Panel>

          <Panel>
            <PanelHead title="แยกตาม platform" />
            {data.byPlatform.length ? (
              <BarList rows={data.byPlatform.map((p) => ({ label: p.platform ?? '-', value: p.sessions, text: `${fmt.num(p.sessions)} · ${fmt.num(p.visitors)} คน` }))} />
            ) : (
              <Empty>ไม่มีข้อมูลในช่วงนี้</Empty>
            )}
          </Panel>

          <Panel>
            <PanelHead title="คำค้นยอดนิยม" />
            {data.topSearches.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH>คำค้น</TH>
                    <TH>ครั้ง</TH>
                    <TH>ไม่เจอสินค้า</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.topSearches.map((s) => (
                    <TR key={s.query}>
                      <TD>{s.query}</TD>
                      <TD>{fmt.num(s.searches)}</TD>
                      <TD>{s.no_results ? <Chip tone="warn">{fmt.num(s.no_results)}</Chip> : 0}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <Empty>ไม่มีข้อมูลในช่วงนี้</Empty>
            )}
          </Panel>
        </>
      ) : (
        <Empty>เลือกวันที่ให้ครบ</Empty>
      )}
    </Page>
  );
}

const COMMERCE_LABEL: Record<string, string> = {
  deliveries_succeeded: 'ส่งข้อมูลถึง platform สำเร็จ', deliveries_dead_lettered: 'ส่งไม่สำเร็จ (dead letter)',
  erp_intake_total: 'ERP ส่งเข้ามาทั้งหมด', erp_intake_failed: 'ERP ส่งเข้ามาแล้ว fail',
};
const JOSH_LABEL: Record<string, string> = {
  payments_failed: 'ชำระเงินไม่สำเร็จ', jagota_order_sync_failed: 'ส่งออเดอร์ไป Jagota ไม่สำเร็จ',
  marketing_runs_failed: 'Marketing workflow fail', push_campaigns_failed: 'Push campaign fail',
};
const bad = (k: string) => !/total|succeeded/.test(k);

function Counts({ counts, labels }: { counts: Record<string, number>; labels: Record<string, string> }) {
  return (
    <StatGrid cols={4}>
      {Object.entries(counts).map(([k, v]) => (
        <StatTile
          key={k}
          accent={bad(k) && v > 0}
          tone={bad(k) && v > 0 ? 'danger' : 'ok'}
          icon={bad(k) && v > 0 ? 'error' : 'check_circle'}
          label={labels[k] ?? k}
          value={fmt.num(v)}
        />
      ))}
    </StatGrid>
  );
}

export function HealthReportPage() {
  const { data, loading, error, picker } = useReport<HealthReport>(reportsApi.health);

  return (
    <Page>
      <PageHeader
        title="Error และสุขภาพระบบ"
        subtitle="ตอนนี้มีอะไรพังไหม และช่วงนี้ fail อะไรไปบ้าง ทั้งฝั่ง commerce และ josh"
        actions={picker}
      />
      <div className="border-t border-secondary-container" />

      <ErrorText error={error} />

      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <Panel>
            <PanelHead
              title="ตอนนี้"
              badge={
                <Chip tone={data.now.ok ? 'ok' : 'danger'}>
                  {data.now.ok ? 'ปกติ' : `${data.now.problems.length} ปัญหา`}
                </Chip>
              }
            />
            {data.now.ok ? (
              <Empty>การส่งข้อมูลไป platform ทันเวลา ไม่มีคิวค้าง</Empty>
            ) : (
              <ul className="list-disc list-inside px-4 py-3 space-y-1 text-xs">
                {data.now.problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
          </Panel>

          <div className="px-4 py-2 text-xs text-on-surface-variant">
            {data.period}
          </div>

          <Panel>
            <PanelHead title="Commerce" />
            <Counts counts={data.commerce} labels={COMMERCE_LABEL} />
          </Panel>

          <Panel>
            <PanelHead title="josh" />
            {data.josh.counts ? (
              <>
                <Counts counts={data.josh.counts} labels={JOSH_LABEL} />
                {!!data.josh.jagotaOrderSyncErrors?.length && (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Jagota sync error</TH>
                        <TH>ครั้ง</TH>
                        <TH>ล่าสุด</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {data.josh.jagotaOrderSyncErrors.map((e) => (
                        <TR key={String(e.error)}>
                          <TD kind="code">{e.error}</TD>
                          <TD>{e.n}</TD>
                          <TD>{e.last_at ? new Date(String(e.last_at)).toLocaleString('th-TH') : ''}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
                <div className="px-4 py-3 text-xs text-on-surface-variant border-t border-secondary-container">
                  {data.josh.notAvailable}
                </div>
              </>
            ) : (
              <Empty>{data.josh.reason}</Empty>
            )}
          </Panel>
        </>
      ) : (
        <Empty>เลือกวันที่ให้ครบ</Empty>
      )}
    </Page>
  );
}
