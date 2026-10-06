import { WinbackLifecycle } from './winback.enums';
import {
  lifecycleAtCapture,
  lifecycleFromJoshLink,
  promoteIfRegistered,
  promoteManually,
  isTmpLifecycle,
} from './lifecycle.helpers';

describe('lifecycleFromJoshLink', () => {
  it('always returns TMP (deprecated)', () => {
    expect(lifecycleFromJoshLink('u1')).toBe(WinbackLifecycle.TMP);
    expect(lifecycleFromJoshLink(null)).toBe(WinbackLifecycle.TMP);
    expect(lifecycleFromJoshLink(undefined)).toBe(WinbackLifecycle.TMP);
  });
});

describe('promoteIfRegistered', () => {
  it('does not promote on josh_user_id alone', () => {
    const acc = {
      lifecycle: WinbackLifecycle.TMP,
      josh_user_id: 'u1',
      josh_company_id: null,
      promoted_to_lead_at: null as Date | null,
    };
    expect(promoteIfRegistered(acc as never)).toBe(false);
    expect(acc.lifecycle).toBe(WinbackLifecycle.TMP);
  });

  it('promotes when josh_user_id and lastAppLoginAt set', () => {
    const acc = {
      lifecycle: WinbackLifecycle.TMP,
      josh_user_id: 'u1',
      josh_company_id: null,
      promoted_to_lead_at: null as Date | null,
    };
    expect(promoteIfRegistered(acc as never, { lastAppLoginAt: new Date() })).toBe(true);
    expect(acc.lifecycle).toBe(WinbackLifecycle.LEAD);
  });

  it('does not promote on josh_company_id alone', () => {
    const acc = {
      lifecycle: WinbackLifecycle.TMP,
      josh_user_id: null,
      josh_company_id: 'c1',
      promoted_to_lead_at: null as Date | null,
    };
    expect(promoteIfRegistered(acc as never, { lastAppLoginAt: new Date() })).toBe(false);
  });

  it('no-ops when already lead or no josh link', () => {
    expect(
      promoteIfRegistered({
        lifecycle: WinbackLifecycle.LEAD,
        josh_user_id: 'u1',
        josh_company_id: null,
        promoted_to_lead_at: null,
      } as never),
    ).toBe(false);
    expect(
      promoteIfRegistered({
        lifecycle: WinbackLifecycle.TMP,
        josh_user_id: null,
        josh_company_id: null,
        promoted_to_lead_at: null,
      } as never),
    ).toBe(false);
  });
});

describe('lifecycleAtCapture', () => {
  it('always TMP', () => {
    expect(lifecycleAtCapture()).toBe(WinbackLifecycle.TMP);
  });
});

describe('promoteManually', () => {
  it('sets lead + timestamp', () => {
    const acc = {
      lifecycle: WinbackLifecycle.TMP,
      promoted_to_lead_at: null as Date | null,
    };
    promoteManually(acc as never);
    expect(acc.lifecycle).toBe(WinbackLifecycle.LEAD);
    expect(acc.promoted_to_lead_at).toBeInstanceOf(Date);
  });
});

describe('isTmpLifecycle', () => {
  it('treats non-lead as tmp', () => {
    expect(isTmpLifecycle('tmp')).toBe(true);
    expect(isTmpLifecycle(null)).toBe(true);
    expect(isTmpLifecycle('lead')).toBe(false);
  });
});
