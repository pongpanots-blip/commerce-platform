import { JoshMatchSignal, judgeJoshMatch } from './josh-match.helpers';

const sig = (
  key: JoshMatchSignal['key'],
  user_ids: string[] = [],
  company_ids: string[] = [],
): JoshMatchSignal => ({ key, value: 'x', user_ids, company_ids });

const UNLINKED = { josh_user_id: null, josh_company_id: null };

describe('judgeJoshMatch', () => {
  it('no_match when nothing is found and nothing is linked', () => {
    expect(judgeJoshMatch(UNLINKED, [sig('email'), sig('register_number')]).status).toBe('no_match');
  });

  it('name_only when only the company name matched', () => {
    const v = judgeJoshMatch(UNLINKED, [sig('email'), sig('company_name', [], ['c1'])]);
    expect(v.status).toBe('name_only');
    expect(v.candidate).toBeNull();
  });

  it('found_not_linked when the strong signals agree on one company', () => {
    const v = judgeJoshMatch(UNLINKED, [
      sig('register_number', ['u1'], ['c1']),
      sig('email', ['u2'], ['c1']),
    ]);
    expect(v.status).toBe('found_not_linked');
    // two users of the same company: the company is certain, the user is not
    expect(v.candidate).toEqual({ josh_company_id: 'c1', josh_user_id: null });
  });

  it('found_not_linked names the user when only one user matched', () => {
    const v = judgeJoshMatch(UNLINKED, [sig('email', ['u1'], ['c1'])]);
    expect(v.candidate).toEqual({ josh_company_id: 'c1', josh_user_id: 'u1' });
  });

  it('ambiguous when the strong signals point at different customers', () => {
    expect(
      judgeJoshMatch(UNLINKED, [sig('register_number', ['u1'], ['c1']), sig('email', ['u9'], ['c9'])]).status,
    ).toBe('ambiguous');
    expect(judgeJoshMatch(UNLINKED, [sig('email', ['u1', 'u2'])]).status).toBe('ambiguous');
  });

  it('matched when the link agrees with every strong signal (by user or by company)', () => {
    const v = judgeJoshMatch({ josh_user_id: 'u1', josh_company_id: 'c1' }, [
      sig('customer_code', ['u1'], ['c1']),
      sig('email', ['u2'], ['c1']),
      sig('company_name', [], ['c7']), // names never cause a conflict
    ]);
    expect(v.status).toBe('matched');
    expect(v.conflicts).toEqual([]);
  });

  it('mismatch when a strong signal points elsewhere, naming the signal', () => {
    const v = judgeJoshMatch({ josh_user_id: 'u1', josh_company_id: 'c1' }, [
      sig('customer_code', ['u1'], ['c1']),
      sig('register_number', ['u5'], ['c5']),
    ]);
    expect(v.status).toBe('mismatch');
    expect(v.conflicts).toEqual(['register_number']);
  });

  it('linked_unverified when linked but nothing on the account confirms it', () => {
    expect(judgeJoshMatch({ josh_user_id: 'u1', josh_company_id: null }, [sig('email')]).status).toBe(
      'linked_unverified',
    );
  });
});
