import { expiredPartitions, monthStart, partitionName } from './event-partitions';

describe('event partitions', () => {
  it('names months in UTC and steps across years', () => {
    expect(partitionName(monthStart(new Date('2026-12-31T20:00:00Z'), 1))).toBe('marketing_events_2027_01');
  });

  it('drops a month only when all of it is older than 90 days', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    expect(expiredPartitions(['marketing_events_2026_06', 'marketing_events_2026_07', 'marketing_events_2026_10', 'marketing_events_default', 'other'], now))
      .toEqual(['marketing_events_2026_06']);
  });
});
