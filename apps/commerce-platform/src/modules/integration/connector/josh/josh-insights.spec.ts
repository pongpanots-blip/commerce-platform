import { bangkokRange, JoshInsights } from './josh-insights';

// 2026-10-05 13:40 Bangkok = 06:40Z, a Monday
const NOW = Date.parse('2026-10-05T06:40:00Z');
const iso = (d: Date) => d.toISOString();

describe('bangkokRange', () => {
  it('this_month: 1st 00:00 Bangkok until now, compared with the same length before', () => {
    const { current, previous } = bangkokRange('this_month', NOW);
    expect(iso(current.from)).toBe('2026-09-30T17:00:00.000Z');
    expect(iso(current.to)).toBe('2026-10-05T06:40:00.000Z');
    expect(current.to.getTime() - current.from.getTime()).toBe(previous.to.getTime() - previous.from.getTime());
    expect(previous.to).toEqual(current.from);
    expect(current.label).toBe('2026-10-01 → 2026-10-05 (Asia/Bangkok)');
  });

  it('last_month, yesterday, this_week (Monday), custom inclusive', () => {
    const lm = bangkokRange('last_month', NOW).current;
    expect([iso(lm.from), iso(lm.to)]).toEqual(['2026-08-31T17:00:00.000Z', '2026-09-30T17:00:00.000Z']);
    expect(lm.label).toBe('2026-09-01 → 2026-09-30 (Asia/Bangkok)');
    const y = bangkokRange('yesterday', NOW).current;
    expect([iso(y.from), iso(y.to)]).toEqual(['2026-10-03T17:00:00.000Z', '2026-10-04T17:00:00.000Z']);
    expect(iso(bangkokRange('this_week', NOW).current.from)).toBe('2026-10-04T17:00:00.000Z');
    const c = bangkokRange('custom', NOW, '2026-01-01', '2026-01-31').current;
    expect([iso(c.from), iso(c.to)]).toEqual(['2025-12-31T17:00:00.000Z', '2026-01-31T17:00:00.000Z']);
  });

  it('just after midnight Bangkok is already the new day / month', () => {
    const t = Date.parse('2026-10-31T17:05:00Z'); // 2026-11-01 00:05 Bangkok
    expect(iso(bangkokRange('this_month', t).current.from)).toBe('2026-10-31T17:00:00.000Z');
    expect(iso(bangkokRange('today', t).current.from)).toBe('2026-10-31T17:00:00.000Z');
  });

  it('custom needs valid dates, in order, at most 366 days', () => {
    expect(() => bangkokRange('custom', NOW)).toThrow('YYYY-MM-DD');
    expect(() => bangkokRange('custom', NOW, '2026-02-01', '2026-01-01')).toThrow('after');
    expect(() => bangkokRange('custom', NOW, '2024-01-01', '2026-01-01')).toThrow('366');
  });
});

describe('order target group: customer code search', () => {
  it.each([
    ['%%', '%\\%\\%%'], ['_', '%\\_%'], ['a%b', '%a\\%b%'], ['a\\b', '%a\\\\b%'], ['acme', '%acme%'],
  ])('%s matches literally: bound as %s with ESCAPE \'\\\'', async (custCode, pattern) => {
    const query = jest.fn().mockResolvedValue([]);
    await new JoshInsights({ query } as never, {} as never).orderTargetgroup({ custCode });
    const [sql, params] = query.mock.calls[0];
    expect(params[1]).toBe(pattern);
    expect(sql).toContain(`cust_code ILIKE $2 ESCAPE '\\'`);
  });

  it('no code: no filter', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new JoshInsights({ query } as never, {} as never).orderTargetgroup({});
    expect(query.mock.calls[0][1][1]).toBeNull();
  });
});
