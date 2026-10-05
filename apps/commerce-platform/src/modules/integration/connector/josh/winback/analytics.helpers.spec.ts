import {
  activitySequenceIndex,
  assignAccountSequences,
  assignDailySequences,
  countByKey,
  stageConversion,
  avgVisitMinutes,
  gpsVisitRate,
  weekBuckets,
  PIPELINE_CONVERSION_STAGES,
  revenueRisk,
} from './analytics.helpers';

describe('activitySequenceIndex', () => {
  it('returns 1-based index for known id', () => {
    expect(activitySequenceIndex(['a', 'b', 'c'], 'b')).toBe(2);
  });

  it('returns 0 when id is missing', () => {
    expect(activitySequenceIndex(['a', 'b'], 'z')).toBe(0);
  });
});

describe('assignAccountSequences', () => {
  it('numbers done activities per account by time', () => {
    const m = assignAccountSequences([
      { id: 'a1', account_id: 'acc1', activity_at: '2026-07-01T10:00:00Z' },
      { id: 'a2', account_id: 'acc1', activity_at: '2026-07-02T10:00:00Z' },
      { id: 'b1', account_id: 'acc2', activity_at: '2026-07-01T11:00:00Z' },
    ]);
    expect(m.get('a1')).toBe(1);
    expect(m.get('a2')).toBe(2);
    expect(m.get('b1')).toBe(1);
  });

  it('breaks ties by id when activity_at is equal', () => {
    const m = assignAccountSequences([
      { id: 'b', account_id: 'acc1', activity_at: '2026-07-01T10:00:00Z' },
      { id: 'a', account_id: 'acc1', activity_at: '2026-07-01T10:00:00Z' },
    ]);
    expect(m.get('a')).toBe(1);
    expect(m.get('b')).toBe(2);
  });
});

describe('assignDailySequences', () => {
  it('numbers per sales_user_id per calendar day', () => {
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const m = assignDailySequences(
      [
        { id: '1', sales_user_id: 'u1', activity_at: '2026-07-01T08:00:00Z' },
        { id: '2', sales_user_id: 'u1', activity_at: '2026-07-01T12:00:00Z' },
        { id: '3', sales_user_id: 'u1', activity_at: '2026-07-02T09:00:00Z' },
      ],
      dayKey,
    );
    expect(m.get('1')).toBe(1);
    expect(m.get('2')).toBe(2);
    expect(m.get('3')).toBe(1);
  });

  it('isolates sequences per rep on the same day', () => {
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const m = assignDailySequences(
      [
        { id: '1', sales_user_id: 'u1', activity_at: '2026-07-01T08:00:00Z' },
        { id: '2', sales_user_id: 'u2', activity_at: '2026-07-01T09:00:00Z' },
      ],
      dayKey,
    );
    expect(m.get('1')).toBe(1);
    expect(m.get('2')).toBe(1);
  });
});

describe('stageConversion', () => {
  it('computes consecutive rates', () => {
    const rows = stageConversion(
      { prospect: 100, contacted: 40, appointment: 20, negotiate: 10, signed: 5 },
      PIPELINE_CONVERSION_STAGES,
    );
    expect(rows[0]).toMatchObject({ from: 'prospect', to: 'contacted', rate: 40 });
  });

  it('returns zero rate when fromCount is zero', () => {
    const rows = stageConversion({ prospect: 0, contacted: 5 }, ['prospect', 'contacted']);
    expect(rows[0].rate).toBe(0);
  });
});

describe('countByKey', () => {
  it('counts non-null keys', () => {
    expect(
      countByKey([
        { key: 'call' },
        { key: 'call' },
        { key: 'visit' },
        { key: null },
      ]),
    ).toEqual({ call: 2, visit: 1 });
  });
});

describe('visit quality', () => {
  it('averages checkout-checkin minutes', () => {
    const r = avgVisitMinutes([
      { checkin_at: '2026-07-01T10:00:00Z', checkout_at: '2026-07-01T10:30:00Z' },
      { checkin_at: '2026-07-01T11:00:00Z', checkout_at: null },
    ]);
    expect(r.sample).toBe(1);
    expect(r.avg).toBe(30);
  });
  it('gps rate', () => {
    expect(gpsVisitRate([{ lat: 1, lng: 2 }, { lat: null, lng: null }])).toEqual({
      withGps: 1,
      total: 2,
      rate: 50,
    });
  });
});

describe('weekBuckets', () => {
  it('splits a range into ISO week buckets clamped to from/to', () => {
    const from = new Date('2026-07-01T00:00:00.000Z');
    const to = new Date('2026-07-14T23:59:59.999Z');
    const buckets = weekBuckets(from, to);
    expect(buckets.length).toBeGreaterThanOrEqual(2);
    expect(buckets[0].start.getTime()).toBeGreaterThanOrEqual(from.getTime());
    expect(buckets[buckets.length - 1].end.getTime()).toBeLessThanOrEqual(to.getTime());
    expect(buckets[0].key).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('returns empty array when to is before from', () => {
    expect(weekBuckets(new Date('2026-07-10'), new Date('2026-07-01'))).toEqual([]);
  });

  it('uses ISO-8601 week-year at calendar year boundaries', () => {
    const weekKey = (iso: string) =>
      weekBuckets(new Date(iso), new Date(iso))[0].key;

    // 2020 has 53 ISO weeks; Dec 31 and Jan 1 share 2020-W53.
    expect(weekKey('2020-12-31T12:00:00.000Z')).toBe('2020-W53');
    expect(weekKey('2021-01-01T12:00:00.000Z')).toBe('2020-W53');
    expect(weekKey('2021-01-04T12:00:00.000Z')).toBe('2021-W01');

    // Late December can belong to the next ISO week-year.
    expect(weekKey('2014-12-31T12:00:00.000Z')).toBe('2015-W01');
  });
});

describe('PIPELINE_CONVERSION_STAGES', () => {
  it('matches expected pipeline order', () => {
    expect(PIPELINE_CONVERSION_STAGES).toEqual([
      'prospect',
      'contacted',
      'appointment',
      'negotiate',
      'signed',
    ]);
  });
});

describe('revenueRisk', () => {
  const at = (health: string, monthly: number | string | null) => ({
    health,
    avg_monthly_revenue: monthly,
  });

  it('separates the warning from the estimate instead of summing them', () => {
    const out = revenueRisk([at('watch', 100_000), at('dormant', 200_000)]);
    expect(out.revenue_at_risk).toBe(100_000);
    expect(out.dormant_monthly_revenue).toBe(200_000);
    expect(out.recoverable_revenue).toBe(110_000); // 200K x 0.55
  });

  it('publishes the probability it used, so the estimate is traceable', () => {
    expect(revenueRisk([], 0.4).recovery_probability).toBe(0.4);
    expect(revenueRisk([at('dormant', 100_000)], 0.4).recoverable_revenue).toBe(40_000);
  });

  it('reads Postgres numeric strings', () => {
    expect(revenueRisk([at('watch', '180000.00')]).revenue_at_risk).toBe(180_000);
  });

  it('ignores accounts with no revenue figure rather than counting them as zero risk', () => {
    const out = revenueRisk([at('watch', null), at('watch', 0), at('watch', 50_000)]);
    expect(out.revenue_at_risk).toBe(50_000);
  });

  it('leaves healthy and won-back customers out entirely', () => {
    const out = revenueRisk([at('active_again', 500_000), at('reactivating', 500_000)]);
    expect(out.revenue_at_risk).toBe(0);
    expect(out.recoverable_revenue).toBe(0);
  });
});
