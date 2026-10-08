import { THAI_DISTRICTS, THAI_PROVINCES } from './winback-geography.data';

export interface WinbackProvince {
  /** josh `thai_provinces.province_code` (10 = กรุงเทพมหานคร). */
  code: number;
  name_th: string;
  name_en: string;
}

/** Lowercase, no spaces/dots/hyphens, without the "เขต / อำเภอ / Khet / Amphoe / District" wrapping. */
export function normalizePlaceName(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw.trim().toLowerCase();
  s = s.replace(/^(เขต|อำเภอ|อ\.|กิ่งอำเภอ|khet|amphoe|amphur|district of)\s*/u, '');
  s = s.replace(/\s+(district|khet|amphoe)$/u, '');
  return s.replace(/[\s.\-'’]/gu, '');
}

const PROVINCES: WinbackProvince[] = THAI_PROVINCES.map(([code, name_th, name_en]) => ({ code, name_th, name_en }));
const PROVINCE_BY_CODE = new Map(PROVINCES.map((p) => [p.code, p]));

const PROVINCE_BY_NAME = new Map<string, number>();
for (const p of PROVINCES) {
  PROVINCE_BY_NAME.set(normalizePlaceName(p.name_th), p.code);
  PROVINCE_BY_NAME.set(normalizePlaceName(p.name_en), p.code);
}
// ERP and Google write Bangkok several ways (ERP: `กรุงเทพฯ`).
for (const alias of ['กรุงเทพฯ', 'กรุงเทพ', 'กทม', 'กทม.', 'bangkok metropolis', 'krung thep maha nakhon']) {
  PROVINCE_BY_NAME.set(normalizePlaceName(alias), 10);
}

/** district name → province code; a name used in more than one province maps to null (ambiguous, never guessed). */
const DISTRICT_TO_PROVINCE = new Map<string, number | null>();
for (const [code, th, en] of THAI_DISTRICTS) {
  for (const name of [th, en]) {
    const key = normalizePlaceName(name);
    if (!key) continue;
    const seen = DISTRICT_TO_PROVINCE.get(key);
    DISTRICT_TO_PROVINCE.set(key, seen === undefined || seen === code ? code : null);
  }
}

const DISTRICTS_BY_PROVINCE = new Map<number, string[]>();
for (const [code, th, en] of THAI_DISTRICTS) {
  const list = DISTRICTS_BY_PROVINCE.get(code) ?? [];
  list.push(th, en);
  DISTRICTS_BY_PROVINCE.set(code, list);
}

export function listProvinces(): WinbackProvince[] {
  return PROVINCES;
}

export function provinceByCode(code: number | null | undefined): WinbackProvince | null {
  if (code === null || code === undefined) return null;
  return PROVINCE_BY_CODE.get(code) ?? null;
}

/** `TH-10`, `10` → 10; anything else → null. */
export function parseProvinceCode(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const m = /^(?:TH-)?(\d{2})$/i.exec(String(raw).trim());
  if (!m) return null;
  const code = Number(m[1]);
  return PROVINCE_BY_CODE.has(code) ? code : null;
}

export function provinceQueryCode(code: number): string {
  return `TH-${code}`;
}

/**
 * The province a Market Explorer place is in, from its free-text `district` (places carry no province).
 * Tries the whole text, then each comma part ("Watthana, Bangkok"); a part naming a province wins.
 * Null when the district is unknown or its name exists in more than one province.
 */
export function provinceForDistrict(district: string | null | undefined): WinbackProvince | null {
  if (!district?.trim()) return null;
  const parts = [district, ...district.split(',')].map(normalizePlaceName).filter(Boolean);
  for (const part of parts) {
    const province = PROVINCE_BY_NAME.get(part);
    if (province !== undefined) return provinceByCode(province);
  }
  for (const part of parts) {
    const code = DISTRICT_TO_PROVINCE.get(part);
    if (code) return provinceByCode(code);
  }
  return null;
}

/** Every district name (th + en) of a province, for an SQL `district IN (...)` prefilter. */
export function districtNamesOfProvince(code: number): string[] {
  return DISTRICTS_BY_PROVINCE.get(code) ?? [];
}
