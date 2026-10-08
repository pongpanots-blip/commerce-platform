import { pageGuide, setUiLocale } from '@cp/ui';
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

  it('gives a first-visit guide for known routes and a fallback for the rest', () => {
    expect(pageGuide('/j/segments/builder').summary).toContain('ไม่ล็อกรายชื่อ');
    expect(pageGuide('/j/segments/builder/00000000-0000-4000-8000-000000000001').summary).toContain('ไม่ล็อกรายชื่อ');
    expect(pageGuide('/marketing/research').steps.length).toBeGreaterThan(0);
    expect(pageGuide('/anything/create').summary).toContain('สร้างรายการใหม่');
    expect(pageGuide('/anything/12').summary).toContain('รายละเอียด');
    expect(pageGuide('/not-a-known-page').summary).toContain('รายการ');
  });
});
