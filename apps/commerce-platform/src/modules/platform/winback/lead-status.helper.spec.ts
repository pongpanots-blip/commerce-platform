import { deriveLeadStatus } from './lead-status.helper';

describe('deriveLeadStatus', () => {
  it('maps terminal + progress stages', () => {
    expect(deriveLeadStatus('rejected')).toBe('rejected');
    expect(deriveLeadStatus('lost')).toBe('rejected');
    expect(deriveLeadStatus('signed')).toBe('completed');
    expect(deriveLeadStatus('won')).toBe('completed');
    expect(deriveLeadStatus('prospect')).toBe('pending');
    expect(deriveLeadStatus('inactive_pool')).toBe('pending');
    expect(deriveLeadStatus('contacted')).toBe('in_progress');
    expect(deriveLeadStatus('appointment')).toBe('in_progress');
    expect(deriveLeadStatus('negotiate')).toBe('in_progress');
  });
});
