import type { StaffRole } from '../../../../shared-kernel/presentation/auth.decorators';

export type HomeSource = 'catalog' | 'sales' | 'orders' | 'traffic' | 'push';
export interface HomeMetric {
  key: string;
  value: number | null;
  unit: 'records' | 'THB' | 'percent' | 'ratio';
  availability: 'available' | 'partial' | 'unavailable';
  definition: string;
  source: string | null;
  sourceAsOf: null;
  reason: string | null;
}
export interface RoleHomeSummary {
  schemaVersion: 1;
  role: StaffRole;
  scope: 'assigned_companies' | 'existing_team_report' | 'existing_role_resources';
  capturedAt: string;
  period: { label: string; timezone: 'Asia/Bangkok' };
  metrics: HomeMetric[];
  failedSources: HomeSource[];
  operationalWrites: false;
}
const row = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const valid = (v: unknown, count: boolean) => typeof v === 'number' && Number.isFinite(v) && (!count || Number.isSafeInteger(v) && v >= 0) ? v : null;

/** Only existing role-authorized report projections. Read time never becomes source freshness. */
export function roleHomeSummary(role: StaffRole, period: string, sources: Partial<Record<HomeSource, unknown>>,
  failedSources: HomeSource[], capturedAt: string): RoleHomeSummary {
  const metrics: HomeMetric[] = [];
  const add = (key: string, value: unknown, unit: HomeMetric['unit'], definition: string, source: string | null, reason?: string) => {
    const n = valid(value, unit === 'records');
    metrics.push({ key, value: n, unit, definition, source, sourceAsOf: null,
      availability: n === null ? 'unavailable' : reason ? 'partial' : 'available',
      reason: n === null ? reason ?? 'Source result unavailable or invalid.' : reason ?? null });
  };
  if (['admin', 'merchandising', 'marketing'].includes(role)) {
    const c = row(sources.catalog);
    const copied = valid(c.missing_report_fields, true);
    const partial = copied !== null && copied > 0 ? 'Copied report fields are missing; issue coverage is partial.' : undefined;
    add('catalog_records', c.total, 'records', 'All records in the existing catalog summary; not completed work.', 'reports/products/summary');
    add('missing_images', c.no_image, 'records', 'Products without an image according to the selected catalog report.', 'reports/products/summary', partial);
    add('missing_category', c.no_category, 'records', 'Products lacking a category; not all missing attributes.', 'reports/products/summary', partial);
    const total = valid(c.total, true), missing = valid(c.no_price, true);
    add('priced_records', total !== null && missing !== null && missing <= total ? total - missing : null, 'records',
      'Positive internal selling prices; correctness is not verified.', 'reports/products/summary', partial);
    if (role !== 'marketing') add('stock_exceptions', c.out_of_stock, 'records',
      'Report includes missing/nonpositive quantity, excluding order-taking products; not live availability.', 'reports/products/summary', partial);
  }
  if (['admin', 'sale', 'sales_manager', 'business_analyst'].includes(role)) {
    const s = row(row(sources.sales).totals), o = row(sources.orders);
    add('sales_inc_vat', s.revenue_inc_vat, 'THB', 'Successful non-test paid orders in the report period, THB including VAT after discounts.', 'reports/sales');
    add('paid_orders', s.orders, 'records', 'Orders included in the period sales report; not all operational orders.', 'reports/sales');
    add('average_order_inc_vat', s.average_order_inc_vat, 'THB', 'Sales including VAT divided by counted paid orders; zero for an empty verified period.', 'reports/sales');
    add('awaiting_payment', o.awaiting_payment, 'records', 'All-time payment_pending orders in the existing authorized order scope.', 'reports/orders/summary');
    add('gross_profit', null, 'THB', 'Net sales excluding VAT minus authoritative effective COGS on the same basis.', null, 'Authoritative COGS and compatible net-sales data are unavailable.');
  }
  if (role === 'marketing') {
    const t = row(row(sources.traffic).totals), p = row(sources.push);
    add('sessions', t.sessions, 'records', 'Visits in the period; 30 minutes idle ends a session. Not attributed sales.', 'reports/traffic');
    add('campaign_records', p.campaigns, 'records', 'Campaign records in the latest-200 overview window; not all campaigns or an approval queue.', 'reports/push-campaigns/overview');
    const coverage = row(p.sendCounterCoverage), records = valid(p.campaigns, true), observed = valid(coverage.observed, true);
    const complete = records !== null && records <= 200 && observed !== null && coverage.scope === 'latest_200_campaigns' && valid(coverage.records, true) === records && observed === records;
    add('recorded_sent', complete ? p.totalSent : null, 'records', 'Recorded push pipeline sent count within the latest 200 campaigns; not a guarantee of final customer delivery.',
      'reports/push-campaigns/overview', complete ? undefined : 'Campaign send counters are missing or invalid. The total is unknown.');
    add('attributed_sales', null, 'THB', 'Sales with a supported attribution model and window.', null, 'Attribution data and its definition are unavailable.');
    add('roas', null, 'ratio', 'Attributed revenue divided by compatible advertising spend.', null, 'Spend and attributed sales are unavailable.');
  }
  if (role === 'cs') for (const key of ['delivery_workload', 'order_review_workload', 'credit_workload']) {
    add(key, null, 'records', 'Authorized service-workload aggregate; a returned page is not a total.', null, 'No authorized aggregate contract exists for this resource.');
  }
  if (role === 'graphic') for (const key of ['image_coverage', 'brand_asset_coverage']) {
    add(key, null, 'records', 'Asset coverage for the existing graphic scope.', null, 'The existing catalog relay does not provide an authorized coverage aggregate.');
  }
  return { schemaVersion: 1, role, scope: role === 'sale' ? 'assigned_companies' : ['sales_manager', 'business_analyst', 'admin'].includes(role) ? 'existing_team_report' : 'existing_role_resources',
    capturedAt, period: { label: period, timezone: 'Asia/Bangkok' }, metrics, failedSources, operationalWrites: false };
}
