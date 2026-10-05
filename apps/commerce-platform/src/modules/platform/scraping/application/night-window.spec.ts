import { inNightWindow } from './scraping.service';

it('uses Bangkok hours for the night window, including windows that wrap past midnight', () => {
  const night = { maxBrowserSessions: 2, nightStartHour: 0, nightEndHour: 6 };
  expect(inNightWindow(new Date('2026-10-03T17:00:00Z'), night)).toBe(true);  // 00:00 Bangkok
  expect(inNightWindow(new Date('2026-10-03T22:59:00Z'), night)).toBe(true);  // 05:59
  expect(inNightWindow(new Date('2026-10-03T23:00:00Z'), night)).toBe(false); // 06:00
  expect(inNightWindow(new Date('2026-10-03T09:00:00Z'), night)).toBe(false); // 16:00
  const wrap = { ...night, nightStartHour: 22, nightEndHour: 6 };
  expect(inNightWindow(new Date('2026-10-03T15:30:00Z'), wrap)).toBe(true);   // 22:30
  expect(inNightWindow(new Date('2026-10-03T12:00:00Z'), wrap)).toBe(false);  // 19:00
});
