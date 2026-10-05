import { deriveTmpProgress, deriveTmpProgressFromAccount } from './tmp-progress.helpers';
import { WinbackLifecycle } from './winback.enums';

describe('deriveTmpProgress', () => {
  it('starts at created with no contacts', () => {
    const p = deriveTmpProgress({
      contactCount: 0,
      hasAppointment: false,
      appLoaded: false,
    });
    expect(p.stage).toBe('created');
    expect(p.label).toBe('สร้าง TMP');
    expect(p.step_index).toBe(0);
  });

  it('advances through contact funnel', () => {
    expect(
      deriveTmpProgress({
        contactCount: 1,
        hasAppointment: false,
        appLoaded: false,
      }).stage,
    ).toBe('contact_1');
    const follow = deriveTmpProgress({
      contactCount: 3,
      hasAppointment: false,
      appLoaded: false,
    });
    expect(follow.stage).toBe('follow_up');
    expect(follow.label).toBe('ติดตามครั้งที่ 3');
  });

  it('reaches appointment then app_loaded', () => {
    expect(
      deriveTmpProgress({
        contactCount: 2,
        hasAppointment: true,
        appLoaded: false,
      }).stage,
    ).toBe('appointment');
    const done = deriveTmpProgress({
      contactCount: 2,
      hasAppointment: true,
      appLoaded: true,
    });
    expect(done.stage).toBe('app_loaded');
    expect(done.steps.every((s) => s.done)).toBe(true);
  });

  it('treats lead lifecycle as app loaded', () => {
    expect(
      deriveTmpProgress({
        lifecycle: WinbackLifecycle.LEAD,
        contactCount: 0,
        hasAppointment: false,
        appLoaded: false,
      }).stage,
    ).toBe('app_loaded');
  });
});

describe('deriveTmpProgressFromAccount', () => {
  it('uses activity_count and stage cheaply', () => {
    const p = deriveTmpProgressFromAccount({
      lifecycle: 'tmp',
      activity_count: 2,
      stage: 'appointment',
    });
    expect(p.stage).toBe('appointment');
  });

  it('does not treat josh ids alone as app_loaded', () => {
    const p = deriveTmpProgressFromAccount({
      lifecycle: 'tmp',
      josh_user_id: 'u1',
      josh_company_id: 'c1',
      activity_count: 0,
    });
    expect(p.stage).not.toBe('app_loaded');
  });

  it('treats last_app_login_at as app loaded', () => {
    const p = deriveTmpProgressFromAccount({
      lifecycle: 'tmp',
      josh_user_id: 'u1',
      last_app_login_at: new Date(),
      activity_count: 0,
    });
    expect(p.stage).toBe('app_loaded');
  });
});
