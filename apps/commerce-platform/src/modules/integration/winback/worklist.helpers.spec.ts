import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackHealth } from './winback.enums';
import { buildWorklist, WORKLIST_DAILY_CAP } from './worklist.helpers';

const account = (over: Partial<WinbackAccount> = {}): WinbackAccount =>
  ({
    id: 'acc-1',
    customer_code: 'A-100',
    display_name: 'ร้าน A',
    phone: '0812345678',
    assigned_sales_user_id: 'sale-1',
    health: WinbackHealth.DORMANT,
    last_order_at: new Date('2026-02-13T00:00:00Z'),
    inactive_days: 214,
    delay_ratio: 11.9,
    median_reorder_interval_days: 18,
    avg_monthly_revenue: 180_000,
    order_count_365d: 0,
    ...over,
  }) as WinbackAccount;

describe('buildWorklist', () => {
  it('reads Postgres numeric strings as numbers', () => {
    // The driver hands back numeric columns as strings; '11.9' > 3 is false.
    const [item] = buildWorklist([
      account({
        delay_ratio: '11.9' as unknown as number,
        avg_monthly_revenue: '180000.00' as unknown as number,
        median_reorder_interval_days: '18.00' as unknown as number,
      }),
    ]);
    expect(item.delay_ratio).toBe(11.9);
    expect(item.avg_monthly_revenue).toBe(180_000);
    expect(item.reasons).toContain('ยอดเดิม ฿180K/เดือน');
  });

  it('labels dormant as reactivate and at-risk as prevent', () => {
    const items = buildWorklist([
      account({ id: 'a', health: WinbackHealth.DORMANT }),
      account({ id: 'b', health: WinbackHealth.WATCH, delay_ratio: 2 }),
    ]);
    expect(items.map((i) => [i.id, i.signal_type])).toEqual(
      expect.arrayContaining([
        ['a', 'reactivate'],
        ['b', 'prevent'],
      ]),
    );
  });

  it('drops accounts the orders say are healthy', () => {
    expect(buildWorklist([account({ health: WinbackHealth.ACTIVE_AGAIN })])).toEqual([]);
  });

  it('sorts by priority, highest first', () => {
    const items = buildWorklist([
      account({ id: 'small', avg_monthly_revenue: 5_000, delay_ratio: 1.6 }),
      account({ id: 'big', avg_monthly_revenue: 180_000, delay_ratio: 11.9 }),
    ]);
    expect(items[0].id).toBe('big');
    expect(items[0].priority).toBeGreaterThan(items[1].priority);
  });

  it('caps the day so the ranking still means something', () => {
    const many = [...Array(50)].map((_, i) =>
      account({ id: `acc-${i}`, avg_monthly_revenue: i * 1000 }),
    );
    expect(buildWorklist(many)).toHaveLength(WORKLIST_DAILY_CAP);
  });

  it('gives every item an action the rep can take right now', () => {
    const [withPhone] = buildWorklist([account()]);
    const [noPhone] = buildWorklist([account({ phone: null })]);
    expect(withPhone.recommended_action).toBe('call');
    expect(noPhone.recommended_action).toBe('visit');
  });
});
