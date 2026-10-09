import { roleHomeSummary } from './role-home-summary';

const at = '2026-10-09T14:00:00Z';
const metric = (result: ReturnType<typeof roleHomeSummary>, key: string) => result.metrics.find(m => m.key === key)!;
describe('role home evidence', () => {
  it('preserves verified zero, excludes malformed counts and never renews source freshness', () => {
    const result = roleHomeSummary('merchandising', 'October', { catalog: { total: 0, no_price: 0, no_image: '0', no_category: -1, out_of_stock: NaN } }, [], at);
    expect(metric(result, 'priced_records')).toMatchObject({ value: 0, availability: 'available', sourceAsOf: null });
    for (const key of ['missing_images', 'missing_category', 'stock_exceptions']) expect(metric(result, key).value).toBeNull();
    expect(result).toMatchObject({ capturedAt: at, operationalWrites: false });
  });
  it('does not infer coverage when missing exceeds total or report fields are incomplete', () => {
    const result = roleHomeSummary('merchandising', 'October', { catalog: { total: 2, no_price: 3, no_image: 1, missing_report_fields: 1 } }, [], at);
    expect(metric(result, 'priced_records').value).toBeNull();
    expect(metric(result, 'missing_images')).toMatchObject({ value: 1, availability: 'partial' });
  });
  it('keeps personal scope and does not equate sales with profit or all-time operational workload', () => {
    const result = roleHomeSummary('sale', 'October', { sales: { totals: { orders: 2, revenue_inc_vat: 100, average_order_inc_vat: 50 } }, orders: { awaiting_payment: 3 } }, [], at);
    expect(result.scope).toBe('assigned_companies'); expect(metric(result, 'gross_profit').value).toBeNull();
    expect(metric(result, 'awaiting_payment').definition).toContain('All-time');
    expect(result.metrics.some(m => m.key === 'catalog_records')).toBe(false);
  });
  it('counts recorded marketing activity without claiming attribution, ROAS or delivery', () => {
    const result = roleHomeSummary('marketing', 'October', { push: { campaigns: 2, totalSent: 7 }, traffic: { totals: { sessions: 0 } } }, ['catalog'], at);
    expect(metric(result, 'sessions').value).toBe(0); expect(metric(result, 'recorded_sent').definition).toContain('not a guarantee');
    expect(metric(result, 'roas').value).toBeNull(); expect(metric(result, 'attributed_sales').value).toBeNull();
    expect(result.failedSources).toEqual(['catalog']);
  });
  it.each(['cs', 'graphic'] as const)('%s receives honest unavailable coverage without unrelated data', role => {
    const result = roleHomeSummary(role, 'October', { sales: { totals: { orders: 100 } }, catalog: { total: 100 } }, [], at);
    expect(result.metrics.every(m => m.value === null && m.availability === 'unavailable')).toBe(true);
  });
  it('does not treat missing campaign counters as zero and labels the bounded overview scope', () => {
    const summary = (push: unknown) => roleHomeSummary('marketing', 'October', { push }, [], at);
    expect(metric(summary({ campaigns: 1, totalSent: 0, sendCounterCoverage: { scope: 'latest_200_campaigns', records: 1, observed: 0 } }), 'recorded_sent').value).toBeNull();
    expect(metric(summary({ campaigns: 0, totalSent: 0, sendCounterCoverage: { scope: 'latest_200_campaigns', records: 0, observed: 0 } }), 'recorded_sent').value).toBe(0);
    expect(metric(summary({ campaigns: 2, totalSent: 5, sendCounterCoverage: { scope: 'latest_200_campaigns', records: 2, observed: 2 } }), 'recorded_sent').value).toBe(5);
    expect(metric(summary({ campaigns: 200, totalSent: 5, sendCounterCoverage: { scope: 'latest_200_campaigns', records: 200, observed: 200 } }), 'campaign_records').definition).toContain('latest-200');
    expect(metric(summary({ campaigns: '1', totalSent: 0, sendCounterCoverage: { scope: 'latest_200_campaigns', records: '1', observed: '1' } }), 'recorded_sent').value).toBeNull();
  });
});
