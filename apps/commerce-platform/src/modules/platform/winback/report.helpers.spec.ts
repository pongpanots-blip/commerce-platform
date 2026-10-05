import { avgDays, isWon, WON_STAGES, CONTACTED_STAGES } from './report.helpers';

describe('avgDays', () => {
  it('averages whole-day gaps, ignoring null ends', () => {
    const r = avgDays([
      { start: '2026-01-01T00:00:00Z', end: '2026-01-11T00:00:00Z' }, // 10
      { start: '2026-01-01T00:00:00Z', end: '2026-01-05T00:00:00Z' }, // 4
      { start: '2026-01-01T00:00:00Z', end: null }, // ignored
    ]);
    expect(r.sample).toBe(2);
    expect(r.avg).toBe(7);
  });
  it('returns null avg for empty sample', () => {
    expect(avgDays([{ start: '2026-01-01T00:00:00Z', end: null }])).toEqual({ avg: null, sample: 0 });
  });
});

describe('isWon', () => {
  it('is won when stage is signed/won or health is active_again', () => {
    expect(isWon('won', 'dormant')).toBe(true);
    expect(isWon('signed', 'dormant')).toBe(true);
    expect(isWon('contacted', 'active_again')).toBe(true);
    expect(isWon('contacted', 'dormant')).toBe(false);
  });
});

describe('stage sets', () => {
  it('classifies contacted-and-beyond for new pipeline', () => {
    expect(CONTACTED_STAGES.has('contacted')).toBe(true);
    expect(CONTACTED_STAGES.has('appointment')).toBe(true);
    expect(CONTACTED_STAGES.has('negotiate')).toBe(true);
    expect(CONTACTED_STAGES.has('prospect')).toBe(false);
    expect(WON_STAGES.has('won')).toBe(true);
    expect(WON_STAGES.has('signed')).toBe(true);
  });
});
