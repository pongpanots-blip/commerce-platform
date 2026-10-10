import { attributeEvent, linkAt, type DeviceLink } from './attribution';

const t = (h: number) => new Date(Date.UTC(2026, 9, 10, h));
const links: DeviceLink[] = [{ userId: 'A', linkedAt: t(10), isStaff: false }, { userId: 'B', linkedAt: t(14), isStaff: false }];

describe('attribution (guest → A → B)', () => {
  it('gives guest events to the first login, then follows the link in force', () => {
    expect(linkAt(links, t(8))?.userId).toBe('A');
    expect(linkAt(links, t(10))?.userId).toBe('A');
    expect(linkAt(links, t(13))?.userId).toBe('A');
    expect(linkAt(links, t(14))?.userId).toBe('B');
    expect(linkAt([], t(8))).toBeNull();
  });

  it('never attributes to staff or to a user without consent', () => {
    const usable = (u: string) => u === 'A';
    expect(attributeEvent(links[0], usable)).toEqual({ userId: 'A', attribution: 'device_link' });
    expect(attributeEvent(links[1], usable)).toEqual({ userId: null, attribution: 'no_consent' });
    expect(attributeEvent({ ...links[0], isStaff: true }, usable)).toEqual({ userId: null, attribution: 'staff' });
    expect(attributeEvent(links[0], usable, 'staff')).toEqual({ userId: null, attribution: 'staff' });
    expect(attributeEvent(null, usable)).toEqual({ userId: null, attribution: null });
  });
});
