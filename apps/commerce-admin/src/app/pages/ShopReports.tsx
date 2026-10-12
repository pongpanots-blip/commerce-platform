import { SalesRepFilter } from '../components/SalesRepFilter';
// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { ReactNode, useState } from 'react';
import {
  Alert, BarList, Button, Chip, Empty, ErrorText, Field, Loading, Page, PageHeader, Panel, PanelHead, Select, StatGrid,
  StatTile, TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { HealthReport, PeriodParams, REPORT_PERIODS, ReportPeriod, reportsApi, session, salesAssignmentApi } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const PERIOD_LABEL: Record<ReportPeriod, string> = {
  get today(){return __uiText("วันนี้");}, get yesterday(){return __uiText("เมื่อวาน");}, get this_week(){return __uiText("สัปดาห์นี้");}, get last_7_days(){return __uiText("7 วันล่าสุด");},
  get this_month(){return __uiText("เดือนนี้");}, get last_month(){return __uiText("เดือนที่แล้ว");}, get last_30_days(){return __uiText("30 วันล่าสุด");}, get custom(){return __uiText("กำหนดเอง");},
};

/** Period picker + load; every report page is "pick a period, show what came back". */
function useReport<T>(load: (p: PeriodParams) => Promise<T>, deps: unknown[] = []) {
  const [p, setP] = useState<PeriodParams>({ period: 'this_month' });
  const ready = p.period !== 'custom' || (!!p.fromDate && !!p.toDate);
  const state = useAsync<T | null>(() => (ready ? load(p) : Promise.resolve(null)), [p.period, p.fromDate, p.toDate, ...deps]);
  const picker = (
    <div className="flex items-center gap-3">
      <Select value={p.period} onChange={(e) => setP({ period: e.target.value as ReportPeriod })}>
        {REPORT_PERIODS.map((k) => <option key={k} value={k}>{PERIOD_LABEL[k]}</option>)}
      </Select>
      {p.period === 'custom' && (
        <>
          <input type="date" value={p.fromDate ?? ''} onChange={(e) => setP({ ...p, fromDate: e.target.value })} aria-label={__uiText("ตั้งแต่")} className="px-2 py-1 border border-secondary-container rounded text-xs" />
          <input type="date" value={p.toDate ?? ''} onChange={(e) => setP({ ...p, toDate: e.target.value })} aria-label={__uiText("ถึง")} className="px-2 py-1 border border-secondary-container rounded text-xs" />
        </>
      )}
      <Button onClick={state.reload} icon="refresh">{__uiText("โหลดใหม่")}</Button>
    </div>
  );
  return { ...state, picker };
}

function Change({ pct }: { pct: number | null }) {
  __useUiLocale();
  if (pct === null) return <span className="text-xs text-on-surface-variant">{__uiText("ไม่มีข้อมูลช่วงก่อน")}</span>;
  return <Chip tone={pct >= 0 ? 'ok' : 'danger'}>{pct >= 0 ? '+' : ''}{pct}%</Chip>;
}

export function SalesReport() {
  __useUiLocale();
  const role = session.claims()?.role;
  const manager = role === 'sales_manager' || role === 'admin';
  const [salesUserId, setSalesUserId] = useState('');
  const reps = useAsync(() => manager ? salesAssignmentApi.reps() : Promise.resolve([]), [manager]);
  const { data, loading, error, picker } = useReport(async p => {
    const [sales, byRep] = await Promise.all([
      reportsApi.sales({ ...p, salesUserId: salesUserId || undefined }),
      manager ? reportsApi.salesByRep(p) : Promise.resolve(null),
    ]);
    return { ...sales, byRep };
  }, [salesUserId, manager]);
  const t = data?.totals;
  const series = data?.byDay ?? data?.byMonth ?? [];

  return (
    <Page>
      <PageHeader
        title={__uiText(role === 'sale' ? "ยอดขายของฉัน" : manager ? "ยอดขายทีมและผลงานรายเซลส์" : "ยอดขาย")}
        subtitle={__uiText(role === 'sale' ? "ยอดขายจากบริษัทที่ฉันดูแล" : "ยอดขายจากบริษัทที่ทีมดูแล")}
        actions={<>{picker}<SalesRepFilter value={salesUserId} onChange={setSalesUserId} /></>}
      />
      <div className="border-t border-secondary-container" />

      <ErrorText error={error} />
      {data?.byRep && <Panel><PanelHead title={__uiText('ผลงานรายเซลส์')} />
        <Table><THead><TH>{__uiText('พนักงานขาย')}</TH><TH kind="num">{__uiText('ออเดอร์')}</TH><TH kind="money">{__uiText('ยอดขาย')}</TH><TH kind="num">{__uiText('ลูกค้าที่ซื้อ')}</TH></THead>
        <TBody>{data.byRep.items.map(row => <TR key={row.sales_user_id ?? 'unassigned'}>
          <TD>{row.sales_user_id ? reps.data?.find(rep => rep.id === row.sales_user_id)?.name || row.sales_user_id : __uiText('ยังไม่มีผู้ดูแล')}</TD>
          <TD kind="num">{fmt.num(row.orders)}</TD><TD kind="money">{fmt.baht(row.revenue_inc_vat)}</TD><TD kind="num">{fmt.num(row.customers)}</TD>
        </TR>)}</TBody></Table>
      </Panel>}

      {loading && !data ? (
        <Loading />
      ) : data && t ? (
        <>
          <Alert tone="muted">
            {data.period} {__uiText(" · เทียบกับ ")}{data.vsPreviousPeriod.period}</Alert>

          <StatGrid cols={4}>
            <StatTile
              label={__uiText("ยอดขาย")}
              value={fmt.baht(t.revenue_inc_vat)}
              foot={<Change pct={data.vsPreviousPeriod.revenue_change_percent} />}
            />
            <StatTile
              label={__uiText("ออเดอร์")}
              value={fmt.num(t.orders)}
              foot={<Change pct={data.vsPreviousPeriod.orders_change_percent} />}
            />
            <StatTile
              label={__uiText("เฉลี่ยต่อออเดอร์")}
              value={fmt.baht(t.average_order_inc_vat)}
            />
            <StatTile
              label={__uiText("ลูกค้าที่ซื้อ")}
              value={fmt.num(t.buying_customers)}
              foot={<span className="text-xs text-on-surface-variant">{fmt.num(t.buying_companies)} {__uiText(" บริษัท · ใหม่ ")}{fmt.num(t.new_customers)}</span>}
            />
            <StatTile
              label={__uiText("ส่วนลดรวม")}
              value={fmt.baht(t.discounts_inc_vat)}
            />
            <StatTile
              label={__uiText("รอชำระ / ยกเลิก")}
              value={`${fmt.num(t.awaiting_payment)} / ${fmt.num(t.cancelled)}`}
            />
            {t.settled_without_payment > 0 && (
              <StatTile
                accent
                tone="warn"
                icon="warning"
                label={__uiText("ไม่นับเป็นยอดขาย")}
                value={fmt.baht(t.settled_without_payment_value)}
                foot={<span className="text-xs text-on-surface-variant">{fmt.num(t.settled_without_payment)} {__uiText(" ออเดอร์ · ดูได้ที่หน้าคำสั่งซื้อ")}</span>}
              />
            )}
            <StatTile
              label={__uiText("คืนเงิน")}
              value={fmt.baht(t.refunds.amount)}
              foot={<span className="text-xs text-on-surface-variant">{t.refunds.n == null ? __uiText("ยังไม่มีข้อมูลคืนเงินในระบบ") : __uiText("{0} รายการ", {"0": fmt.num(t.refunds.n)})}</span>}
            />
          </StatGrid>

          <Panel>
            <PanelHead title={data.byMonth ? __uiText("ยอดขายรายเดือน") : __uiText("ยอดขายรายวัน")} />
            {series.length ? (
              <BarList rows={series.map((s) => ({ label: s.bucket, value: s.revenue_inc_vat, text: `${fmt.baht(s.revenue_inc_vat)} · ${s.orders}` }))} />
            ) : (
              <Empty>{__uiText("ไม่มีข้อมูลในช่วงนี้")}</Empty>
            )}
          </Panel>

          <Panel>
            <PanelHead title={__uiText("สินค้าขายดี")} />
            {data.topProducts.length ? (
              <Table>
                <THead>
                    <TH>{__uiText("รหัสสินค้า")}</TH>
                    <TH>{__uiText("สินค้า")}</TH>
                    <TH kind="num">{__uiText("จำนวน")}</TH>
                    <TH kind="money">{__uiText("ยอดขาย")}</TH>
                  </THead>
                <TBody>
                  {data.topProducts.map((p) => (
                    <TR key={p.sku}>
                      <TD kind="code">{p.sku}</TD>
                      <TD>{p.name}</TD>
                      <TD kind="num">{fmt.num(p.qty)}</TD>
                      <TD kind="money">{fmt.baht(p.revenue_inc_vat)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <Empty>{__uiText("ไม่มีข้อมูลในช่วงนี้")}</Empty>
            )}
          </Panel>
        </>
      ) : error ? null : (
        <Empty>{__uiText("เลือกวันที่ให้ครบ")}</Empty>
      )}
    </Page>
  );
}

const FUNNEL_STEPS: [string, string][] = [
  ['view_item', 'ดูสินค้า'], ['add_to_cart', 'ใส่ตะกร้า'], ['begin_checkout', 'เริ่มชำระเงิน'], ['purchase', 'ซื้อ'],
];
const PLATFORM_LABEL: Record<string, string> = { web: 'เว็บไซต์', ios: 'แอป iOS', android: 'แอป Android' };

export function TrafficReport() {
  __useUiLocale();
  const { data, loading, error, picker } = useReport(reportsApi.traffic);
  const t = data?.totals;

  return (
    <Page>
      <PageHeader
        title={__uiText("การเข้าชมร้านค้า")}
        subtitle={__uiText("คนเข้าชม การค้นหา และขั้นตอนก่อนซื้อบนร้านค้าออนไลน์")}
        actions={picker}
      />
      <div className="border-t border-secondary-container" />

      <ErrorText error={error} />

      {loading && !data ? (
        <Loading />
      ) : data && t ? (
        <>
          <Alert tone="muted">
            {data.period} {__uiText(" · เทียบกับ ")}{data.vsPreviousPeriod.period} · {data.note}</Alert>

          <StatGrid cols={4}>
            <StatTile
              label={__uiText("ครั้งที่เข้าชม")}
              value={fmt.num(t.sessions)}
              foot={<Change pct={data.vsPreviousPeriod.sessions_change_percent} />}
            />
            <StatTile
              label={__uiText("ผู้เข้าชม")}
              value={fmt.num(t.visitors)}
            />
            <StatTile
              label={__uiText("ล็อกอินแล้ว")}
              value={fmt.num(t.logged_in_users)}
            />
            <StatTile
              label={__uiText("ดูสินค้า")}
              value={fmt.num(t.product_views)}
            />
            <StatTile
              label={__uiText("ค้นหา")}
              value={fmt.num(t.searches)}
            />
            <StatTile
              label={__uiText("ใส่ตะกร้า")}
              value={fmt.num(t.add_to_carts)}
            />
            <StatTile
              label={__uiText("ซื้อ")}
              value={fmt.num(t.purchases)}
            />
          </StatGrid>

          <Panel>
            <PanelHead title={__uiText("ขั้นตอนก่อนซื้อ (นับครั้งที่เข้าชม)")} />
            {FUNNEL_STEPS.filter(([k]) => k in data.funnelSessions).length ? (
              <BarList rows={FUNNEL_STEPS.filter(([k]) => k in data.funnelSessions).map(([k, label]) => ({ label: __uiText(label), value: data.funnelSessions[k], text: fmt.num(data.funnelSessions[k]) }))} />
            ) : (
              <Empty>{__uiText("ไม่มีข้อมูลในช่วงนี้")}</Empty>
            )}
          </Panel>

          <Panel>
            <PanelHead title={__uiText("ครั้งที่เข้าชมรายวัน")} />
            {data.sessionsByDay.length ? (
              <BarList rows={data.sessionsByDay.map((d) => ({ label: d.day, value: d.sessions, text: fmt.num(d.sessions) }))} />
            ) : (
              <Empty>{__uiText("ไม่มีข้อมูลในช่วงนี้")}</Empty>
            )}
          </Panel>

          <Panel>
            <PanelHead title={__uiText("แยกตามช่องทาง")} />
            {data.byPlatform.length ? (
              <BarList rows={data.byPlatform.map((p) => ({ label: p.platform ? (PLATFORM_LABEL[p.platform] ? __uiText(PLATFORM_LABEL[p.platform]) : p.platform) : '—', value: p.sessions, text: `${fmt.num(p.sessions)} · ${__uiText('{0} คน', { 0: fmt.num(p.visitors) })}` }))} />
            ) : (
              <Empty>{__uiText("ไม่มีข้อมูลในช่วงนี้")}</Empty>
            )}
          </Panel>

          <Panel>
            <PanelHead title={__uiText("คำค้นยอดนิยม")} />
            {data.topSearches.length ? (
              <Table>
                <THead>
                    <TH>{__uiText("คำค้น")}</TH>
                    <TH kind="num">{__uiText("ครั้ง")}</TH>
                    <TH kind="num">{__uiText("ไม่เจอสินค้า")}</TH>
                  </THead>
                <TBody>
                  {data.topSearches.map((s) => (
                    <TR key={s.query}>
                      <TD>{s.query}</TD>
                      <TD kind="num">{fmt.num(s.searches)}</TD>
                      <TD kind="num">{s.no_results ? <Chip tone="warn">{fmt.num(s.no_results)}</Chip> : 0}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <Empty>{__uiText("ไม่มีข้อมูลในช่วงนี้")}</Empty>
            )}
          </Panel>
        </>
      ) : error ? null : (
        <Empty>{__uiText("เลือกวันที่ให้ครบ")}</Empty>
      )}
    </Page>
  );
}

const COMMERCE_LABEL: Record<string, string> = {
  get deliveries_succeeded(){return __uiText("ส่งข้อมูลถึงร้านค้าสำเร็จ");}, get deliveries_dead_lettered(){return __uiText("ส่งข้อมูลถึงร้านค้าไม่สำเร็จ (เลิกลองส่งแล้ว)");},
  get erp_intake_total(){return __uiText("ข้อมูลที่ระบบขาย (ERP) ส่งเข้ามาทั้งหมด");}, get erp_intake_failed(){return __uiText("ข้อมูลจากระบบขาย (ERP) ที่รับเข้าไม่สำเร็จ");},
};
const JOSH_LABEL: Record<string, string> = {
  get payments_failed(){return __uiText("ชำระเงินไม่สำเร็จ");}, get jagota_order_sync_failed(){return __uiText("ส่งออเดอร์ไป Jagota ไม่สำเร็จ");},
  get marketing_runs_failed(){return __uiText("ข้อความอัตโนมัติที่ส่งไม่สำเร็จ");}, get push_campaigns_failed(){return __uiText("การแจ้งเตือนถึงลูกค้าที่ส่งไม่สำเร็จ");},
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
  __useUiLocale();
  const { data, loading, error, picker } = useReport<HealthReport>(reportsApi.health);

  return (
    <Page>
      <PageHeader
        title={__uiText("สุขภาพระบบ")}
        subtitle={__uiText("ตอนนี้มีปัญหาอะไรที่กระทบการขาย และช่วงนี้มีอะไรทำงานไม่สำเร็จบ้าง")}
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
              title={__uiText("ตอนนี้")}
              badge={
                <Chip tone={data.now.ok ? 'ok' : 'danger'}>
                  {data.now.ok ? __uiText("ปกติ") : __uiText("{0} ปัญหา", {"0": data.now.problems.length})}
                </Chip>
              }
            />
            {data.now.ok ? (
              <Empty>{__uiText("ส่งข้อมูลถึงร้านค้าทันเวลา ไม่มีงานค้าง")}</Empty>
            ) : (
              <ul className="list-disc list-inside px-4 py-3 space-y-1 text-xs">
                {data.now.problems.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            )}
          </Panel>

          <Alert tone="muted">
            {data.period}</Alert>

          <Panel>
            <PanelHead title={__uiText("การรับส่งข้อมูลระหว่างระบบ")} />
            <Counts counts={data.commerce} labels={COMMERCE_LABEL} />
          </Panel>

          <Panel>
            <PanelHead title={__uiText("ร้านค้าออนไลน์")} />
            {data.josh.counts ? (
              <>
                <Counts counts={data.josh.counts} labels={JOSH_LABEL} />
                {!!data.josh.jagotaOrderSyncErrors?.length && (
                  <Table>
                    <THead>
                        <TH>{__uiText("สาเหตุที่ส่งออเดอร์ไป Jagota ไม่สำเร็จ")}</TH>
                        <TH kind="num">{__uiText("ครั้ง")}</TH>
                        <TH>{__uiText("ล่าสุด")}</TH>
                      </THead>
                    <TBody>
                      {data.josh.jagotaOrderSyncErrors.map((e) => (
                        <TR key={String(e.error)}>
                          <TD kind="code">{e.error}</TD>
                          <TD kind="num">{fmt.num(e.n)}</TD>
                          <TD kind="time">{e.last_at ? new Date(String(e.last_at)).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')) : ''}</TD>
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
      ) : error ? null : (
        <Empty>{__uiText("เลือกวันที่ให้ครบ")}</Empty>
      )}
    </Page>
  );
}
