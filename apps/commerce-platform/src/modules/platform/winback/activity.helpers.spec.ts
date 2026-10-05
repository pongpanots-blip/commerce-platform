import { nextStageAfterActivity, isVisit } from './activity.helpers';

describe('nextStageAfterActivity', () => {
  it('uses the explicitly requested stage', () => {
    expect(nextStageAfterActivity('prospect', 'interested')).toBe('interested');
  });
  it('auto-advances prospect and inactive_pool to contacted', () => {
    expect(nextStageAfterActivity('prospect', null)).toBe('contacted');
    expect(nextStageAfterActivity('inactive_pool', undefined)).toBe('contacted');
  });
  it('leaves other stages unchanged when none requested', () => {
    expect(nextStageAfterActivity('interested', null)).toBe('interested');
    expect(nextStageAfterActivity('won', null)).toBe('won');
  });
});

describe('isVisit', () => {
  it('is true for visit and store_visit', () => {
    expect(isVisit('visit')).toBe(true);
    expect(isVisit('store_visit')).toBe(true);
    expect(isVisit('call')).toBe(false);
    expect(isVisit('gift')).toBe(false);
  });
});
