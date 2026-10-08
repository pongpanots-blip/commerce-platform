import {
  districtNamesOfProvince,
  listProvinces,
  normalizePlaceName,
  parseProvinceCode,
  provinceByCode,
  provinceForDistrict,
} from './winback-geography';

describe('winback geography (josh thailand-geography master data)', () => {
  it('carries all 77 provinces with josh province codes', () => {
    expect(listProvinces()).toHaveLength(77);
    expect(provinceByCode(10)).toEqual({ code: 10, name_th: 'กรุงเทพมหานคร', name_en: 'Bangkok' });
    expect(provinceByCode(99)).toBeNull();
  });

  it('parses TH-10 / 10, rejects unknown codes', () => {
    expect(parseProvinceCode('TH-10')).toBe(10);
    expect(parseProvinceCode('th-50')).toBe(50);
    expect(parseProvinceCode(10)).toBe(10);
    expect(parseProvinceCode('TH-99')).toBeNull();
    expect(parseProvinceCode('Bangkok')).toBeNull();
  });

  it('normalizes the เขต / อำเภอ / Khet / District wrapping', () => {
    expect(normalizePlaceName('เขตวัฒนา')).toBe('วัฒนา');
    expect(normalizePlaceName('Khet Bang Rak')).toBe('bangrak');
    expect(normalizePlaceName('Bang Rak District')).toBe('bangrak');
  });

  it('maps a place district to its province (Thai, English, prefixed, with a province part)', () => {
    expect(provinceForDistrict('วัฒนา')?.code).toBe(10);
    expect(provinceForDistrict('เขตบางรัก')?.code).toBe(10);
    expect(provinceForDistrict('Bang Rak')?.code).toBe(10);
    expect(provinceForDistrict('Mueang Chiang Mai')?.code).toBe(50);
    expect(provinceForDistrict('Somewhere, Chiang Mai')?.code).toBe(50);
    expect(provinceForDistrict('กรุงเทพฯ')?.code).toBe(10);
  });

  it('never guesses: unknown, empty or ambiguous district names map to null', () => {
    expect(provinceForDistrict('Atlantis')).toBeNull();
    expect(provinceForDistrict('')).toBeNull();
    expect(provinceForDistrict(null)).toBeNull();
    // "Ban Na" is a district name in more than one province.
    const counts = new Map<string, number>();
    for (const p of listProvinces()) {
      for (const n of districtNamesOfProvince(p.code)) counts.set(normalizePlaceName(n), (counts.get(normalizePlaceName(n)) ?? 0) + 1);
    }
    const ambiguous = [...counts].find(([, c]) => c > 1)?.[0];
    expect(ambiguous).toBeDefined();
    expect(provinceForDistrict(ambiguous!)).toBeNull();
  });

  it('lists a province district names for the SQL prefilter', () => {
    expect(districtNamesOfProvince(10)).toEqual(expect.arrayContaining(['วัฒนา', 'Watthana']));
    expect(districtNamesOfProvince(99)).toEqual([]);
  });
});
