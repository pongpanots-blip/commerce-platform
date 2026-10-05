import {
  buildCustomerBaselines,
  customerState,
  delayRatio,
  isWinnable,
  medianReorderIntervalDays,
} from './reorder-baseline.helpers';
import { WinbackHealth } from './winback.enums';

const NOW = new Date('2026-09-16T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('medianReorderIntervalDays', () => {
  it('returns NULL, not 0, when fewer than two orders exist', () => {
    expect(medianReorderIntervalDays([])).toBeNull();
    expect(medianReorderIntervalDays([daysAgo(10)])).toBeNull();
  });

  it('averages the two middle gaps for an even number of intervals', () => {
    // gaps: 10, 20, 30, 40 -> (20 + 30) / 2
    const dates = [daysAgo(100), daysAgo(90), daysAgo(70), daysAgo(40), daysAgo(0)];
    expect(medianReorderIntervalDays(dates)).toBe(25);
  });

  it('takes the middle gap for an odd number of intervals', () => {
    // gaps: 10, 20, 30
    expect(medianReorderIntervalDays([daysAgo(60), daysAgo(50), daysAgo(30), daysAgo(0)])).toBe(20);
  });

  it('does not depend on input order', () => {
    const shuffled = [daysAgo(0), daysAgo(60), daysAgo(30), daysAgo(50)];
    expect(medianReorderIntervalDays(shuffled)).toBe(20);
  });

  it('returns 0 for several orders on the same day', () => {
    expect(medianReorderIntervalDays([daysAgo(5), daysAgo(5), daysAgo(5)])).toBe(0);
  });
});

describe('delayRatio', () => {
  it('is days-since-last-order over the customer own cycle', () => {
    expect(delayRatio(daysAgo(35), 14, NOW)).toBeCloseTo(2.5);
  });

  it('is NULL without a baseline', () => {
    expect(delayRatio(daysAgo(35), null, NOW)).toBeNull();
  });

  it('never divides by a zero-day baseline', () => {
    expect(delayRatio(daysAgo(35), 0, NOW)).toBeNull();
  });

  it('is NULL when the customer never ordered', () => {
    expect(delayRatio(null, 14, NOW)).toBeNull();
  });

  it('clamps a future last_order_at to zero instead of going negative', () => {
    expect(delayRatio(new Date(NOW.getTime() + 5 * 86_400_000), 14, NOW)).toBe(0);
  });
});

describe('customerState', () => {
  it('returns NULL for a healthy customer so ACTIVE_AGAIN is never overwritten', () => {
    expect(customerState(0.9, 12)).toBeNull();
    expect(customerState(1.49, 12)).toBeNull();
  });

  it('flags the at-risk band as WATCH', () => {
    expect(customerState(1.5, 40)).toBe(WinbackHealth.WATCH);
    expect(customerState(2.9, 40)).toBe(WinbackHealth.WATCH);
  });

  it('flags three cycles overdue as DORMANT, long before the old 180-day rule', () => {
    expect(customerState(3, 45)).toBe(WinbackHealth.DORMANT);
  });

  it('falls back to the fixed threshold only when there is no baseline', () => {
    expect(customerState(null, 179)).toBeNull();
    expect(customerState(null, 180)).toBe(WinbackHealth.DORMANT);
  });
});

describe('buildCustomerBaselines', () => {
  const lastOrders = [
    { customer_code: 'a-100', last_order_at: daysAgo(60), lifetime_spend: '900000' },
  ];

  it('normalizes customer codes the same way the SQL side does', () => {
    const out = buildCustomerBaselines(
      [{ customer_code: ' a-100 ', create_date: daysAgo(60), total_price: 100 }],
      [{ customer_code: ' a-100 ', last_order_at: daysAgo(60), lifetime_spend: 100 }],
      NOW,
    );
    expect([...out.keys()]).toEqual(['A-100']);
  });

  it('keeps a customer whose last order predates the baseline window', () => {
    // No rows in the window at all — exactly the customer winback exists for.
    const out = buildCustomerBaselines(
      [],
      [{ customer_code: 'A-100', last_order_at: daysAgo(400), lifetime_spend: 900000 }],
      NOW,
    );
    const a = out.get('A-100')!;
    expect(a.inactive_days).toBe(400);
    expect(a.median_reorder_interval_days).toBeNull();
    expect(a.order_count_365d).toBe(0);
    expect(a.health).toBe(WinbackHealth.DORMANT);
  });

  it('marks a fast-cycling customer at risk well before 180 days', () => {
    const rows = [200, 186, 172, 158, 144, 60].map((d) => ({
      customer_code: 'A-100',
      create_date: daysAgo(d),
      total_price: 10000,
    }));
    const a = buildCustomerBaselines(rows, lastOrders, NOW).get('A-100')!;
    expect(a.median_reorder_interval_days).toBe(14);
    expect(a.delay_ratio).toBeCloseTo(60 / 14);
    expect(a.health).toBe(WinbackHealth.DORMANT); // 4.3 cycles overdue at day 60
  });

  it('widens to the extended window when the primary one is too thin', () => {
    const rows = [700, 500, 60].map((d) => ({
      customer_code: 'A-100',
      create_date: daysAgo(d),
      total_price: 10000,
    }));
    const a = buildCustomerBaselines(rows, lastOrders, NOW).get('A-100')!;
    // Only one order inside 365d, so the baseline uses all three.
    expect(a.order_count_365d).toBe(1);
    expect(a.median_reorder_interval_days).toBe(320); // gaps 200, 440
  });

  it('reports revenue per month of actual ordering, not lifetime spend', () => {
    // ฿600K earned across a 6-month span -> ฿100K/month, while lifetime is ฿900K.
    const rows = [
      { customer_code: 'A-100', create_date: daysAgo(240), total_price: 300000 },
      { customer_code: 'A-100', create_date: daysAgo(60), total_price: 300000 },
    ];
    const a = buildCustomerBaselines(rows, lastOrders, NOW).get('A-100')!;
    expect(a.avg_monthly_revenue).toBeCloseTo(600000 / 6, 0);
    expect(a.lifetime_spend_hint).toBe(900000);
  });

  it('leaves avg_monthly_revenue NULL when the span is unknown', () => {
    const rows = [{ customer_code: 'A-100', create_date: daysAgo(60), total_price: 300000 }];
    expect(buildCustomerBaselines(rows, lastOrders, NOW).get('A-100')!.avg_monthly_revenue)
      .toBeNull();
  });

  it('returns NULL health for a customer still ordering on cycle', () => {
    const rows = [42, 28, 14, 3].map((d) => ({
      customer_code: 'A-100',
      create_date: daysAgo(d),
      total_price: 10000,
    }));
    const a = buildCustomerBaselines(
      rows,
      [{ customer_code: 'A-100', last_order_at: daysAgo(3), lifetime_spend: 900000 }],
      NOW,
    ).get('A-100')!;
    expect(a.health).toBeNull();
  });
});

describe('winback eligibility', () => {
  it('keeps a customer who bought inside the window', () => {
    expect(isWinnable(daysAgo(729), NOW)).toBe(true);
  });

  it('drops one whose relationship is simply over', () => {
    expect(isWinnable(daysAgo(731), NOW)).toBe(false);
  });

  it('drops a customer who never bought', () => {
    expect(isWinnable(null, NOW)).toBe(false);
  });

  it('scores long-gone customers too, flagging them instead of hiding them', () => {
    const out = buildCustomerBaselines(
      [],
      [
        { customer_code: 'RECENT', last_order_at: daysAgo(300), lifetime_spend: 1000 },
        { customer_code: 'GONE', last_order_at: daysAgo(1200), lifetime_spend: 900000 },
      ],
      NOW,
    );
    expect([...out.keys()].sort()).toEqual(['GONE', 'RECENT']);
    expect(out.get('GONE')!.winnable).toBe(false);
    expect(out.get('RECENT')!.winnable).toBe(true);
    expect(out.get('GONE')!.health).toBe(WinbackHealth.DORMANT);
  });

  it('can still be narrowed by a caller that asks for it', () => {
    const out = buildCustomerBaselines(
      [],
      [{ customer_code: 'GONE', last_order_at: daysAgo(1200), lifetime_spend: 900000 }],
      NOW,
      { eligibleLookbackDays: 730 },
    );
    expect(out.size).toBe(0);
  });
});

describe('province', () => {
  it('carries the territory from the latest invoice', () => {
    const out = buildCustomerBaselines(
      [],
      [
        {
          customer_code: 'A-100',
          last_order_at: daysAgo(60),
          lifetime_spend: 1000,
          province: 'ชลบุรี',
        },
      ],
      NOW,
    );
    expect(out.get('A-100')!.province).toBe('ชลบุรี');
  });

  it('treats blank as unknown, so a filter never matches an empty string', () => {
    const out = buildCustomerBaselines(
      [],
      [
        { customer_code: 'A', last_order_at: daysAgo(60), lifetime_spend: 1, province: '  ' },
        { customer_code: 'B', last_order_at: daysAgo(60), lifetime_spend: 1 },
      ],
      NOW,
    );
    expect(out.get('A')!.province).toBeNull();
    expect(out.get('B')!.province).toBeNull();
  });
});
