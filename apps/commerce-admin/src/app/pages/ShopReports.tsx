import { ReactNode, useState } from 'react';
import { HealthReport, PeriodParams, REPORT_PERIODS, ReportPeriod, reportsApi } from '../../lib/api';
import { useAsync } from '../hooks';

const PERIOD_LABEL: Record<ReportPeriod, string> = {
  today: 'วันนี้', yesterday: 'เมื่อวาน', this_week: 'สัปดาห์นี้', last_7_days: '7 วันล่าสุด',
  this_month: 'เดือนนี้', last_month: 'เดือนที่แล้ว', last_30_days: '30 วันล่าสุด', custom: 'กำหนดเอง',
};
const baht = (n: number) => '฿' + Math.round(Number(n)).toLocaleString('th-TH');
const num = (n: number) => Number(n).toLocaleString('th-TH');

/** Period picker + load; every report page is "pick a period, show what came back". */
function useReport<T>(load: (p: PeriodParams) => Promise<T>) {
  const [p, setP] = useState<PeriodParams>({ period: 'this_month' });
  const ready = p.period !== 'custom' || (!!p.fromDate && !!p.toDate);
  const state = useAsync<T | null>(() => (ready ? load(p) : Promise.resolve(null)), [p.period, p.fromDate, p.toDate]);
  const picker = (
    <div className="row" style={{ alignItems: 'center' }}>
      <select value={p.period} onChange={(e) => setP({ period: e.target.value as ReportPeriod })}>
        {REPORT_PERIODS.map((k) => <option key={k} value={k}>{PERIOD_LABEL[k]}</option>)}
      </select>
      {p.period === 'custom' && (
        <>
          <input type="date" value={p.fromDate ?? ''} onChange={(e) => setP({ ...p, fromDate: e.target.value })} aria-label="ตั้งแต่" />
          <input type="date" value={p.toDate ?? ''} onChange={(e) => setP({ ...p, toDate: e.target.value })} aria-label="ถึง" />
        </>
      )}
      <button className="btn ghost" onClick={state.reload}>Refresh</button>
    </div>
  );
  return { ...state, picker };
}

function Head({ title, sub, picker }: { title: string; sub: string; picker: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1><p>{sub}</p></div>
      {picker}
    </div>
  );
}

function Change({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="hint">ไม่มีข้อมูลช่วงก่อน</span>;
  return <span className={`badge ${pct >= 0 ? 'ok' : 'danger'}`}>{pct >= 0 ? '+' : ''}{pct}%</span>;
}

function Stat({ label, value, extra }: { label: string; value: ReactNode; extra?: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {extra && <div style={{ marginTop: 4 }}>{extra}</div>}
    </div>
  );
}

/** Horizontal bars — enough for "which day / step was biggest" without a chart library. */
function Bars({ rows }: { rows: { label: string; value: number; text: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="empty">ไม่มีข้อมูลในช่วงนี้</div>;
  return (
    <table>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="mono" style={{ width: 110 }}>{r.label}</td>
            <td><div style={{ background: 'var(--accent)', opacity: 0.75, height: 10, borderRadius: 3, width: `${(r.value / max) * 100}%` }} /></td>
            <td style={{ width: 120, textAlign: 'right' }}>{r.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Status({ loading, error, empty }: { loading: boolean; error: string | null; empty: boolean }) {
  if (error) return <div className="err">{error}</div>;
  if (loading && empty) return <div className="empty">Loading…</div>;
  if (empty) return <div className="empty">เลือกวันที่ให้ครบ</div>;
  return null;
}

export function SalesReport() {
  const { data, loading, error, picker } = useReport(reportsApi.sales);
  const t = data?.totals;
  const series = data?.byDay ?? data?.byMonth ?? [];
  return (
    <div>
      <Head title="ยอดขาย" sub="ออเดอร์ที่จ่ายแล้ว (paid/preparing/shipped/delivered) · บาทรวม VAT หลังส่วนลด · อ่านจาก replica ของ josh" picker={picker} />
      <Status loading={loading} error={error} empty={!data} />
      {data && t && (
        <>
          <p className="hint">{data.period} · เทียบกับ {data.vsPreviousPeriod.period}</p>
          <div className="stat-grid">
            <Stat label="ยอดขาย" value={baht(t.revenue_inc_vat)} extra={<Change pct={data.vsPreviousPeriod.revenue_change_percent} />} />
            <Stat label="ออเดอร์" value={num(t.orders)} extra={<Change pct={data.vsPreviousPeriod.orders_change_percent} />} />
            <Stat label="เฉลี่ยต่อออเดอร์" value={baht(t.average_order_inc_vat)} />
            <Stat label="ลูกค้าที่ซื้อ" value={num(t.buying_customers)} extra={<span className="hint">{num(t.buying_companies)} บริษัท · ใหม่ {num(t.new_customers)}</span>} />
            <Stat label="ส่วนลดรวม" value={baht(t.discounts_inc_vat)} />
            <Stat label="รอชำระ / ยกเลิก" value={`${num(t.awaiting_payment)} / ${num(t.cancelled)}`} />
            {t.settled_without_payment > 0 && <Stat label="ไม่นับเป็นยอดขาย (สถานะจ่าย/ส่งแล้ว แต่ไม่มีการจ่ายสำเร็จ)" value={baht(t.settled_without_payment_value)} extra={<span className="hint">{num(t.settled_without_payment)} ออเดอร์ · ดูที่ Orders (josh)</span>} />}
            <Stat label="คืนเงิน" value={baht(t.refunds.amount)} extra={<span className="hint">{num(t.refunds.n)} รายการ</span>} />
          </div>
          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head">ยอดขาย{data.byMonth ? 'รายเดือน' : 'รายวัน'}</div>
            <Bars rows={series.map((s) => ({ label: s.bucket, value: s.revenue_inc_vat, text: `${baht(s.revenue_inc_vat)} · ${s.orders}` }))} />
          </div>
          <div className="panel">
            <div className="panel-head">สินค้าขายดี</div>
            {data.topProducts.length ? (
              <table>
                <thead><tr><th>SKU</th><th>สินค้า</th><th>จำนวน</th><th>ยอดขาย</th></tr></thead>
                <tbody>
                  {data.topProducts.map((p) => (
                    <tr key={p.sku}><td className="mono">{p.sku}</td><td>{p.name}</td><td>{num(p.qty)}</td><td>{baht(p.revenue_inc_vat)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty">ไม่มีข้อมูลในช่วงนี้</div>}
          </div>
        </>
      )}
    </div>
  );
}

const FUNNEL_STEPS: [string, string][] = [
  ['view_item', 'ดูสินค้า'], ['add_to_cart', 'ใส่ตะกร้า'], ['begin_checkout', 'เริ่ม checkout'], ['purchase', 'ซื้อ'],
];

export function TrafficReport() {
  const { data, loading, error, picker } = useReport(reportsApi.traffic);
  const t = data?.totals;
  return (
    <div>
      <Head title="Traffic" sub="ผู้เข้าชม การค้นหา และ funnel ของหน้าร้าน josh · อ่านจาก replica ของ josh" picker={picker} />
      <Status loading={loading} error={error} empty={!data} />
      {data && t && (
        <>
          <p className="hint">{data.period} · เทียบกับ {data.vsPreviousPeriod.period} · {data.note}</p>
          <div className="stat-grid">
            <Stat label="Sessions" value={num(t.sessions)} extra={<Change pct={data.vsPreviousPeriod.sessions_change_percent} />} />
            <Stat label="Visitors" value={num(t.visitors)} />
            <Stat label="Login แล้ว" value={num(t.logged_in_users)} />
            <Stat label="ดูสินค้า" value={num(t.product_views)} />
            <Stat label="ค้นหา" value={num(t.searches)} />
            <Stat label="ใส่ตะกร้า" value={num(t.add_to_carts)} />
            <Stat label="ซื้อ" value={num(t.purchases)} />
          </div>
          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head">Funnel (sessions)</div>
            <Bars rows={FUNNEL_STEPS.filter(([k]) => k in data.funnelSessions).map(([k, label]) => ({ label, value: data.funnelSessions[k], text: num(data.funnelSessions[k]) }))} />
          </div>
          <div className="panel">
            <div className="panel-head">Sessions รายวัน</div>
            <Bars rows={data.sessionsByDay.map((d) => ({ label: d.day, value: d.sessions, text: num(d.sessions) }))} />
          </div>
          <div className="panel">
            <div className="panel-head">แยกตาม platform</div>
            <Bars rows={data.byPlatform.map((p) => ({ label: p.platform ?? '-', value: p.sessions, text: `${num(p.sessions)} · ${num(p.visitors)} คน` }))} />
          </div>
          <div className="panel">
            <div className="panel-head">คำค้นยอดนิยม</div>
            {data.topSearches.length ? (
              <table>
                <thead><tr><th>คำค้น</th><th>ครั้ง</th><th>ไม่เจอสินค้า</th></tr></thead>
                <tbody>
                  {data.topSearches.map((s) => (
                    <tr key={s.query}>
                      <td>{s.query}</td><td>{num(s.searches)}</td>
                      <td>{s.no_results ? <span className="badge warn">{num(s.no_results)}</span> : 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty">ไม่มีข้อมูลในช่วงนี้</div>}
          </div>
        </>
      )}
    </div>
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
    <div className="stat-grid" style={{ padding: 16 }}>
      {Object.entries(counts).map(([k, v]) => (
        <div className="stat" key={k}>
          <div className="label">{labels[k] ?? k}</div>
          <div className={`value${bad(k) && v > 0 ? ' attn' : ''}`}>{num(v)}</div>
        </div>
      ))}
    </div>
  );
}

export function HealthReportPage() {
  const { data, loading, error, picker } = useReport<HealthReport>(reportsApi.health);
  return (
    <div>
      <Head title="Error และสุขภาพระบบ" sub="ตอนนี้มีอะไรพังไหม และช่วงนี้ fail อะไรไปบ้าง ทั้งฝั่ง commerce และ josh" picker={picker} />
      <Status loading={loading} error={error} empty={!data} />
      {data && (
        <>
          <div className="panel">
            <div className="panel-head">
              ตอนนี้
              <span className={`badge ${data.now.ok ? 'ok' : 'danger'}`}>{data.now.ok ? 'ปกติ' : `${data.now.problems.length} ปัญหา`}</span>
            </div>
            {data.now.ok ? <div className="empty">การส่งข้อมูลไป platform ทันเวลา ไม่มีคิวค้าง</div> : (
              <ul style={{ margin: 0, padding: '12px 32px' }}>{data.now.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            )}
          </div>
          <p className="hint">{data.period}</p>
          <div className="panel">
            <div className="panel-head">Commerce</div>
            <Counts counts={data.commerce} labels={COMMERCE_LABEL} />
          </div>
          <div className="panel">
            <div className="panel-head">josh</div>
            {data.josh.counts ? (
              <>
                <Counts counts={data.josh.counts} labels={JOSH_LABEL} />
                {!!data.josh.jagotaOrderSyncErrors?.length && (
                  <table>
                    <thead><tr><th>Jagota sync error</th><th>ครั้ง</th><th>ล่าสุด</th></tr></thead>
                    <tbody>
                      {data.josh.jagotaOrderSyncErrors.map((e) => (
                        <tr key={String(e.error)}><td className="mono">{e.error}</td><td>{e.n}</td><td>{e.last_at ? new Date(String(e.last_at)).toLocaleString('th-TH') : ''}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="hint" style={{ padding: '8px 16px' }}>{data.josh.notAvailable}</div>
              </>
            ) : <div className="empty">{data.josh.reason}</div>}
          </div>
        </>
      )}
    </div>
  );
}
