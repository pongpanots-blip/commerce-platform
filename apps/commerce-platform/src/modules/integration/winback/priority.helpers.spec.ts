import {
  PriorityInput,
  priorityReasons,
  priorityScore,
  recommendedAction,
  revenueReference,
  signalType,
} from './priority.helpers';
import { WinbackHealth } from './winback.enums';

const base: PriorityInput = {
  avg_monthly_revenue: 100_000,
  median_reorder_interval_days: 14,
  delay_ratio: 4,
  inactive_days: 56,
  order_count_365d: 20,
  phone: '0812345678',
  assigned_sales_user_id: 'sale-1',
  health: WinbackHealth.DORMANT,
};
const REF = 200_000;

describe('revenueReference', () => {
  it('ignores nulls and zeroes', () => {
    expect(revenueReference([null, 0, 50_000])).toBe(50_000);
  });

  it('is 0 when nothing is known, which zeroes business value instead of guessing', () => {
    expect(revenueReference([null, null])).toBe(0);
    expect(priorityScore(base, 0)).toBeLessThan(priorityScore(base, REF));
  });

  it('sits near the top of the pool, not at the extreme outlier', () => {
    const pool = [...Array(10)].map((_, i) => (i + 1) * 10_000); // 10K..100K
    expect(revenueReference(pool)).toBe(100_000);
  });
});

describe('priorityScore', () => {
  it('stays inside 0-100', () => {
    expect(priorityScore(base, REF)).toBeGreaterThanOrEqual(0);
    expect(priorityScore(base, REF)).toBeLessThanOrEqual(100);
    const max: PriorityInput = {
      ...base,
      avg_monthly_revenue: 10_000_000,
      delay_ratio: 99,
      median_reorder_interval_days: 1,
    };
    expect(priorityScore(max, REF)).toBe(100);
  });

  it('ranks the bigger customer higher, all else equal', () => {
    const small = { ...base, avg_monthly_revenue: 10_000 };
    expect(priorityScore(base, REF)).toBeGreaterThan(priorityScore(small, REF));
  });

  it('does not reward lifetime size — only revenue per month is an input', () => {
    // avg_monthly_revenue is the only money field; nothing else can inflate it.
    const noRevenue = { ...base, avg_monthly_revenue: null };
    expect(priorityScore(noRevenue, REF)).toBeLessThan(priorityScore(base, REF));
  });

  it('treats "due now" as zero urgency, not maximum', () => {
    const dueNow = { ...base, delay_ratio: 1, inactive_days: 14 };
    const wayLate = { ...base, delay_ratio: 6, inactive_days: 84 };
    expect(priorityScore(dueNow, REF)).toBeLessThan(priorityScore(wayLate, REF));
  });

  it('ranks a frequent buyer above a rare one at the same lateness', () => {
    const rare = { ...base, median_reorder_interval_days: 120 };
    expect(priorityScore(base, REF)).toBeGreaterThan(priorityScore(rare, REF));
  });

  it('drops an unreachable, unowned account below a reachable one', () => {
    const unreachable = { ...base, phone: null, assigned_sales_user_id: null };
    expect(priorityScore(unreachable, REF)).toBeLessThan(priorityScore(base, REF));
  });

  it('falls back to raw days when there is no baseline', () => {
    const noBaseline = {
      ...base,
      delay_ratio: null,
      median_reorder_interval_days: null,
      inactive_days: 365,
    };
    expect(priorityScore(noBaseline, REF)).toBeGreaterThan(0);
  });
});

describe('priorityReasons', () => {
  it('leads with why now, then value', () => {
    expect(priorityReasons(base)).toEqual([
      'ไม่ได้สั่ง 56 วัน',
      'ปกติสั่งทุก 14 วัน (ช้ากว่าปกติ 4.0 เท่า)',
      'ยอดเดิม ฿100K/เดือน',
    ]);
  });

  it('omits the cycle line when there is no baseline', () => {
    const reasons = priorityReasons({
      ...base,
      delay_ratio: null,
      median_reorder_interval_days: null,
    });
    expect(reasons.some((r) => r.includes('ปกติสั่งทุก'))).toBe(false);
  });

  it('says so when the rep has no phone number to call', () => {
    expect(priorityReasons({ ...base, phone: null })).toContain(
      'ไม่มีเบอร์ติดต่อ — ต้องเข้าไปหน้าร้าน',
    );
  });

  it('formats millions readably', () => {
    expect(priorityReasons({ ...base, avg_monthly_revenue: 1_800_000 })).toContain(
      'ยอดเดิม ฿1.8M/เดือน',
    );
  });
});

describe('recommendedAction / signalType', () => {
  it('calls when there is a phone, visits when there is not', () => {
    expect(recommendedAction(base)).toBe('call');
    expect(recommendedAction({ ...base, phone: null })).toBe('visit');
  });

  it('maps health to the signal the rep sees', () => {
    expect(signalType(WinbackHealth.WATCH)).toBe('prevent');
    expect(signalType(WinbackHealth.DORMANT)).toBe('reactivate');
    expect(signalType(WinbackHealth.ACTIVE_AGAIN)).toBeNull();
    expect(signalType(null)).toBeNull();
  });
});

describe('long-quiet customers', () => {
  const stale = { ...base, winnable: false, inactive_days: 1200 };

  it('ranks below an otherwise identical live relationship', () => {
    expect(priorityScore(stale, REF)).toBeLessThan(
      priorityScore({ ...base, winnable: true }, REF),
    );
  });

  it('is still scored and still shown — never zeroed out', () => {
    expect(priorityScore(stale, REF)).toBeGreaterThan(0);
  });

  it('says the odds are low instead of hiding the customer', () => {
    expect(priorityReasons(stale)).toContain('เงียบมาเกิน 2 ปี — โอกาสกลับมาต่ำ');
    expect(priorityReasons({ ...base, winnable: true })).not.toContain(
      'เงียบมาเกิน 2 ปี — โอกาสกลับมาต่ำ',
    );
  });

  it('falls back to inactive_days when winnable was not computed', () => {
    const noFlag = { ...base, inactive_days: 1200 };
    delete (noFlag as { winnable?: boolean }).winnable;
    expect(priorityReasons(noFlag)).toContain('เงียบมาเกิน 2 ปี — โอกาสกลับมาต่ำ');
  });
});
