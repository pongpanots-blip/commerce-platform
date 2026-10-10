// Anonymous GETs only: guards reject before controllers can read business rows.
const routes = [
  '/api/product-masters/__availability_probe__/extras',
  '/api/product-prices/workspace/pending',
  '/api/competitor-prices/workspace/sources',
  '/api/reports/commerce-previews/orders/__availability_probe__/review',
  '/api/reports/sales-work/subjects',
  '/api/reports/marketing-readiness/subjects',
  '/api/reports/payment-transactions/__availability_probe__',
  '/api/reports/home',
  '/api/reports/financial-analysis',
  '/api/reports/financial-goals/drafts',
  '/api/reports/pack-price-planning/drafts',
  '/api/reports/promotion-planning/drafts',
];
class AvailabilityError extends Error {
  constructor(route, status) {
    super('API availability status mismatch: ' + route + ' ' + status);
    this.route = route; this.status = status;
  }
}
async function verifyAvailability(request = fetch) {
  const results = [];
  for (const [route, expected] of [
    ['/api', 200], ...routes.map(route => [route, 401]),
    ['/api/__unregistered_availability_probe__', 404],
  ]) {
    const response = await request('http://127.0.0.1:3100' + route, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    await response.body?.cancel();
    results.push({ route, status: response.status });
    if (response.status !== expected) throw new AvailabilityError(route, response.status);
  }
  return results;
}
module.exports = { routes, verifyAvailability, AvailabilityError };
if (require.main === module || process.argv[1] === '-') verifyAvailability().then(results => {
  console.log('anonymous API availability verified:', JSON.stringify(results));
}).catch(error => {
  console.error('anonymous API availability failed; no authenticated business request was sent');
  if (error instanceof AvailabilityError) console.error('availability status:', JSON.stringify({ route:error.route,status:error.status }));
  process.exitCode = 1;
});
