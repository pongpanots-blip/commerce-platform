import { ALL_CATEGORY_ID } from '../modules/commerce/product-categories/category-rules';
import { compareRows } from './category-parity';

describe('category parity', () => {
  it('prints a josh-only ALL row instead of an empty failure', () => {
    const report = compareRows([{ id: ALL_CATEGORY_ID, category_code: 'ALL' }], [], ['category_code']);
    const printed = JSON.stringify({ categories: report }, null, 2);
    expect(printed).toContain(ALL_CATEGORY_ID);
    expect(report.onlyJosh).toEqual([ALL_CATEGORY_ID]);
  });

  it('matches a seeded ALL row when only the audit clocks differ, and still reports a real column', () => {
    const cols = ['category_code', 'category_image', 'created_at', 'updated_at'];
    const josh = { id: ALL_CATEGORY_ID, category_code: 'ALL', category_image: null, created_at: new Date('2026-01-01T00:00:00Z'), updated_at: new Date('2026-01-02T00:00:00Z') };
    const seeded = { ...josh, created_at: new Date('2026-10-08T00:00:00Z'), updated_at: new Date('2026-10-08T00:00:00Z') };
    expect(compareRows([josh], [seeded], cols).different).toBe(0);
    const drifted = compareRows([josh], [{ ...seeded, category_image: 'https://cdn/all.png' }], cols);
    expect(drifted.different).toBe(1);
    expect(JSON.stringify(drifted.sample)).toContain('category_image');
    const other = '00000000-0000-4000-8000-0000000000b2';
    expect(compareRows([{ id: other, updated_at: new Date('2026-01-01T00:00:00Z') }], [{ id: other, updated_at: new Date('2026-02-01T00:00:00Z') }], ['updated_at']).different).toBe(1);
  });
});
