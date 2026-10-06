import {
  classifyCustomerSegment,
  defaultDashboardRange,
  monthStartUtc,
  pctShare,
  roundBaht,
} from './dashboard.helpers';

describe('roundBaht / pctShare', () => {
  it('rounds money to 2 decimals', () => {
    expect(roundBaht(10.456)).toBe(10.46);
  });
  it('computes share percent', () => {
    expect(pctShare(250, 1000)).toBe(25);
    expect(pctShare(1, 3)).toBe(33.3);
    expect(pctShare(10, 0)).toBe(0);
  });
});

describe('monthStartUtc / defaultDashboardRange', () => {
  it('anchors to UTC month start', () => {
    const ref = new Date('2026-07-20T15:00:00.000Z');
    expect(monthStartUtc(ref).toISOString()).toBe('2026-07-01T00:00:00.000Z');
    const range = defaultDashboardRange(ref);
    expect(range.from).toBe('2026-07-01T00:00:00.000Z');
    expect(range.to).toBe(ref.toISOString());
  });
});

describe('classifyCustomerSegment', () => {
  const monthStart = new Date('2026-07-01T00:00:00.000Z');

  it('prioritizes new (created this month)', () => {
    expect(
      classifyCustomerSegment({
        inactiveDays: 90,
        createDate: '2026-07-10T00:00:00.000Z',
        orderCount: 5,
        stage: 'ordering_again',
        health: 'active_again',
        monthStart,
      }),
    ).toBe('new');
  });

  it('classifies repeat before inactive', () => {
    expect(
      classifyCustomerSegment({
        inactiveDays: 90,
        createDate: '2026-01-01T00:00:00.000Z',
        orderCount: 2,
        stage: 'inactive_pool',
        health: 'dormant',
        monthStart,
      }),
    ).toBe('repeat');
  });

  it('classifies inactive at 60+ days', () => {
    expect(
      classifyCustomerSegment({
        inactiveDays: 60,
        createDate: '2025-01-01T00:00:00.000Z',
        orderCount: 0,
        stage: 'inactive_pool',
        health: 'dormant',
        monthStart,
      }),
    ).toBe('inactive');
  });

  it('classifies re-engage for 30–59 days', () => {
    expect(
      classifyCustomerSegment({
        inactiveDays: 45,
        createDate: '2025-01-01T00:00:00.000Z',
        orderCount: 1,
        stage: 'contacted',
        health: 'watch',
        monthStart,
      }),
    ).toBe('reengage');
  });
});
