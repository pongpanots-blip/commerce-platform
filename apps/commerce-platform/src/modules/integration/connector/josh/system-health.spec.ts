import { ServiceUnavailableException } from '@nestjs/common';
import { JOSH_ONLY, joshOnly, SystemHealthReport } from './system-health';

const range = { label: 'x', from: new Date('2026-10-01'), to: new Date('2026-10-02') };

function make(replica: boolean) {
  const db = { query: jest.fn(async (sql: string) => {
    if (sql.includes('webhook_deliveries')) return [{ deliveries_dead_lettered: 0 }];
    if (sql.includes('GROUP BY 1')) return [{ error: 'timeout', n: 2, last_at: '2026-10-01T05:00:00Z' }];
    if (sql.includes("sync_status = 'failed'")) return [{ n: 2 }];
    return [{ copied_up_to: '2026-10-01T06:00:00Z' }];
  }) };
  const insights = { available: replica, failures: jest.fn(async () => ({ counts: { payments_failed: 1 } })) };
  const report = new SystemHealthReport(db as never, { check: async () => [] } as never, insights as never, { configured: false } as never);
  return { report, db, insights };
}

describe('SystemHealthReport — josh part', () => {
  it('with the replica: josh-insights failures, as before', async () => {
    const { report, insights } = make(true);
    expect((await report.report(range)).josh).toEqual({ counts: { payments_failed: 1 } });
    expect(insights.failures).toHaveBeenCalled();
  });

  it('without the replica: ERP sends from commerce\'s copy, with how fresh the copy is (S5-9)', async () => {
    const { report, db, insights } = make(false);
    const josh = (await report.report(range)).josh as Record<string, unknown>;
    expect(insights.failures).not.toHaveBeenCalled();
    expect(josh).toMatchObject({ counts: { jagota_order_sync_failed: 2 }, copiedUpTo: '2026-10-01T06:00:00.000Z' });
    expect(josh.jagotaOrderSyncErrors).toEqual([{ error: 'timeout', n: 2, last_at: '2026-10-01T05:00:00Z' }]);
    expect(String(josh.notAvailable)).toContain('josh-admin');
    for (const [sql] of db.query.mock.calls.filter(([sql]) => sql.includes('jagota'))) expect(sql).toContain('jagota_order_sync_history');
  });
});

describe('joshOnly (S5-14)', () => {
  it('a josh-only page says why (josh-admin / not copied / cutover tool) instead of the bare replica error', () => {
    const e = joshOnly('backoffice');
    expect(e).toBeInstanceOf(ServiceUnavailableException);
    expect(e.message).toContain('josh-admin');
    expect(e.message).toContain('JOSH_DATABASE_URL');
    for (const why of Object.values(JOSH_ONLY)) expect(why).not.toMatch(/read replica is not connected/);
  });
});
