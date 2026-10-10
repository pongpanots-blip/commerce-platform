import { describe, expect, it } from 'vitest';
import { disabledReason, kindOf, PALETTE } from './palette-items';
import { newStep } from './workflow-graph';

const limits = { maxWaitSteps: 3, maxConditionSteps: 5, maxAudienceSteps: 1, maxWaitMinutes: 43200, maxHeaders: 20, maxBodyBytes: 16384, minSplitBranches: 2, maxSplitBranches: 4 };
const item = (id: string) => PALETTE.flatMap((c) => c.items).find((i) => i.id === id)!;

describe('palette', () => {
  it('lists only phase-1 items', () => {
    expect(PALETTE.flatMap((c) => c.items).map((i) => i.id)).toEqual([
      'scheduled', 'order_milestone', 'first_login', 'app_login', 'push', 'email', 'in_app', 'webhook', 'wait', 'condition', 'split', 'audience', 'grant_coupon']);
  });
  it('greys out items at their limit', () => {
    expect(disabledReason(item('audience'), [newStep('audience')], 'first_login', limits)).not.toBeNull();
    expect(disabledReason(item('wait'), [newStep('wait'), newStep('wait'), newStep('wait')], 'first_login', limits)).not.toBeNull();
    expect(disabledReason(item('wait'), [], 'first_login', limits)).toBeNull();
    expect(disabledReason(item('first_login'), [], 'first_login', limits)).not.toBeNull(); // already the trigger
  });
  it('knows the kind of a saved step', () => {
    expect(kindOf(newStep('email'))).toBe('email');
    expect(kindOf(newStep('grant_coupon'))).toBe('grant_coupon');
    expect(kindOf(newStep('split'))).toBe('split');
  });
});
