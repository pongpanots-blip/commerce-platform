import { findMasterMatch, fmt, pageGuide, setUiLocale } from '@cp/ui';
import { formatShipmentDuration } from './josh-admin/libs/shared-api/lib/orders/orders.api';

describe('page usability', () => {
  afterEach(() => setUiLocale('th'));

  it('shows shipment time in the selected language', () => {
    setUiLocale('th');
    expect(formatShipmentDuration(30)).toBe('<1 นาที');
    expect(formatShipmentDuration(120)).toBe('2 นาที');
    expect(formatShipmentDuration(3600)).toBe('1 ชม.');
    setUiLocale('en');
    expect(formatShipmentDuration(30)).toBe('<1 min');
    expect(formatShipmentDuration(120)).toBe('2 min');
    expect(formatShipmentDuration(3600)).toBe('1 hr');
  });

  it('shows timestamps in Bangkok time', () => {
    setUiLocale('en');
    expect(fmt.when('2026-01-01T00:00:00Z')).toContain('07:00');
  });

  it('treats a different case or extra spaces as the same master record', () => {
    const options = [{ value: 'b1', label: 'Acme Foods' }];
    expect(findMasterMatch(options, '  acme   foods ')?.value).toBe('b1');
    expect(findMasterMatch([{ value: 'c1', label: 'ร้านอาหารบ้านสวน · CUST-01' }], 'cust-01')?.value).toBe('c1');
    expect(findMasterMatch(options, 'Other')).toBeUndefined();
  });

  it('gives a guide only for a route that has its own', () => {
    expect(pageGuide('/j/segments/builder')?.summary).toContain('ไม่ล็อกรายชื่อ');
    expect(pageGuide('/j/segments/builder/00000000-0000-4000-8000-000000000001')?.summary).toContain('ไม่ล็อกรายชื่อ');
    expect(pageGuide('/marketing/research')?.steps.length).toBeGreaterThan(0);
    expect(pageGuide('/anything/create')).toBeUndefined();
    expect(pageGuide('/anything/12')).toBeUndefined();
    expect(pageGuide('/not-a-known-page')).toBeUndefined();
    expect(pageGuide('/home')).toBeUndefined();
  });
});
