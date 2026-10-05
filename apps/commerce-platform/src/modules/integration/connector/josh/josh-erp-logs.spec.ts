import { BadRequestException } from '@nestjs/common';
import { erpLogQuery, erpLogWindow } from './josh-erp-logs';

describe('josh ERP log query', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');

  it('defaults to the last 24h and caps a query at 7 days, like josh', () => {
    const w = erpLogWindow(undefined, undefined, now);
    expect(w.to.getTime() - w.from.getTime()).toBe(24 * 3600_000);
    expect(() => erpLogWindow('2026-09-01T00:00:00Z', '2026-09-09T00:00:00Z')).toThrow(BadRequestException);
    expect(() => erpLogWindow('2026-09-09T00:00:00Z', '2026-09-01T00:00:00Z')).toThrow(BadRequestException);
    expect(() => erpLogWindow('nope')).toThrow(BadRequestException);
  });

  it('only matches ERP rows and escapes the search text', () => {
    const q = erpLogQuery({ status: 'fail', endpoint: 'products/qty', q: 'A.1*(' }, now);
    expect(q.endpoint).toBe('products/qty'); // the exact-match filter replaces the $exists guard — still only ERP rows
    expect(q.method).toEqual({ $exists: true });
    expect(q.isSuccess).toBe(false);
    expect(q.$or[0].summary.source).toBe('A\\.1\\*\\(');
    expect(erpLogQuery({}, now).endpoint).toEqual({ $exists: true, $type: 'string' });
  });
});
