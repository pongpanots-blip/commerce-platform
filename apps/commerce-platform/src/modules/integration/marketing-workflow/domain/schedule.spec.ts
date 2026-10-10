// Copied from josh origin/main 00030d02b apps/backend/src/app/marketing-workflow/marketing-schedule.spec.ts — keep in sync by hand (phase 3 retires josh's copy).
import { isWithinMarketingSchedule, localDow, localHour } from './schedule';

describe('isWithinMarketingSchedule', () => {
  it('returns true when schedule is null', () => {
    expect(isWithinMarketingSchedule(null, new Date())).toBe(true);
  });

  it('rejects outside activeFrom/activeTo', () => {
    const now = new Date('2026-07-23T05:00:00.000Z');
    expect(
      isWithinMarketingSchedule(
        {
          timezone: 'Asia/Bangkok',
          activeFrom: '2026-08-01T00:00:00.000Z',
          activeTo: null,
        },
        now,
      ),
    ).toBe(false);
  });

  it('allows Bangkok weekday morning window', () => {
    // 2026-07-23 is Thursday; 10:00 ICT = 03:00 UTC
    const now = new Date('2026-07-23T03:00:00.000Z');
    expect(
      isWithinMarketingSchedule(
        {
          timezone: 'Asia/Bangkok',
          daysOfWeek: [4],
          startTime: '09:00',
          endTime: '12:00',
        },
        now,
      ),
    ).toBe(true);
  });

  it('rejects when local day-of-week is not in daysOfWeek', () => {
    // 2026-07-24 is Friday; 10:00 ICT = 03:00 UTC on Friday
    const now = new Date('2026-07-24T03:00:00.000Z');
    expect(
      isWithinMarketingSchedule(
        {
          timezone: 'Asia/Bangkok',
          daysOfWeek: [4],
          startTime: '09:00',
          endTime: '12:00',
        },
        now,
      ),
    ).toBe(false);
  });

  it('rejects when local time is before startTime', () => {
    // 08:00 ICT = 01:00 UTC
    const now = new Date('2026-07-23T01:00:00.000Z');
    expect(
      isWithinMarketingSchedule(
        {
          timezone: 'Asia/Bangkok',
          startTime: '09:00',
          endTime: '12:00',
        },
        now,
      ),
    ).toBe(false);
  });

  it('treats endTime as exclusive', () => {
    // exactly 12:00 ICT = 05:00 UTC
    const now = new Date('2026-07-23T05:00:00.000Z');
    expect(
      isWithinMarketingSchedule(
        {
          timezone: 'Asia/Bangkok',
          startTime: '09:00',
          endTime: '12:00',
        },
        now,
      ),
    ).toBe(false);
  });

  it('allows activeFrom/activeTo range when now is inside it', () => {
    const now = new Date('2026-07-23T05:00:00.000Z');
    expect(
      isWithinMarketingSchedule(
        {
          timezone: 'Asia/Bangkok',
          activeFrom: '2026-07-01T00:00:00.000Z',
          activeTo: '2026-08-01T00:00:00.000Z',
        },
        now,
      ),
    ).toBe(true);
  });

  it('rejects at/after activeTo (exclusive)', () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    expect(
      isWithinMarketingSchedule(
        {
          timezone: 'Asia/Bangkok',
          activeFrom: null,
          activeTo: '2026-08-01T00:00:00.000Z',
        },
        now,
      ),
    ).toBe(false);
  });

  it('allows a schedule with only timezone set and no other constraints', () => {
    const now = new Date('2026-07-23T03:00:00.000Z');
    expect(
      isWithinMarketingSchedule(
        {
          timezone: 'Asia/Bangkok',
        },
        now,
      ),
    ).toBe(true);
  });

  it('falls back to Asia/Bangkok when timezone is missing (empty string)', () => {
    // 2026-07-23 is Thursday; 10:00 ICT (default tz) = 03:00 UTC
    const now = new Date('2026-07-23T03:00:00.000Z');
    expect(
      isWithinMarketingSchedule(
        {
          timezone: '',
          daysOfWeek: [4],
          startTime: '09:00',
          endTime: '12:00',
        },
        now,
      ),
    ).toBe(true);
  });
});

describe('localHour', () => {
  it('returns the local hour in the given timezone', () => {
    // 2026-07-23T03:30:00Z is 10:30 ICT (Asia/Bangkok, UTC+7)
    const now = new Date('2026-07-23T03:30:00.000Z');
    expect(localHour('Asia/Bangkok', now)).toBe(10);
  });

  it('falls back to Asia/Bangkok when timezone is null/undefined/empty', () => {
    const now = new Date('2026-07-23T03:30:00.000Z');
    expect(localHour(null, now)).toBe(10);
    expect(localHour(undefined, now)).toBe(10);
    expect(localHour('', now)).toBe(10);
  });
});

describe('localDow', () => {
  it('returns the local day-of-week (0 = Sunday) in the given timezone', () => {
    // 2026-07-23 is Thursday in Asia/Bangkok
    const now = new Date('2026-07-23T03:00:00.000Z');
    expect(localDow('Asia/Bangkok', now)).toBe(4);
  });

  it('falls back to Asia/Bangkok when timezone is missing', () => {
    const now = new Date('2026-07-23T03:00:00.000Z');
    expect(localDow(null, now)).toBe(4);
  });
});
