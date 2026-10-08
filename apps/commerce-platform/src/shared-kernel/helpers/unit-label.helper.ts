// Copied from josh apps/backend/src/shared/{helpers,types} (origin/main d84d692b).
/** josh request-lang.helper RequestLang. */
export type RequestLang = 'th' | 'en';

/**
 * Customer-facing name for an ERP unit code (`KG`, `BX`, `PC`...), in the
 * request's language. Label fields (`promotion_rules[].unit_label`, cart
 * `subUnitLabel`) go through this; code fields (`selling_unit`,
 * `order_taking_unit`, `avg_price_unit`) stay raw codes for client logic.
 */
const UNIT_LABELS: Record<string, { th: string; en: string }> = {
  KG: { th: 'กิโลกรัม', en: 'kg' },
  G: { th: 'กรัม', en: 'g' },
  MG: { th: 'มิลลิกรัม', en: 'mg' },
  L: { th: 'ลิตร', en: 'L' },
  ML: { th: 'มิลลิลิตร', en: 'mL' },
  PC: { th: 'ชิ้น', en: 'pc' },
  BX: { th: 'กล่อง', en: 'box' },
  PK: { th: 'แพ็ค', en: 'pack' },
  CT: { th: 'ลัง', en: 'carton' },
  BG: { th: 'ถุง', en: 'bag' },
  JR: { th: 'ขวดโหล', en: 'jar' },
  CA: { th: 'กระป๋อง', en: 'can' },
  BT: { th: 'ขวด', en: 'bottle' },
  BK: { th: 'ก้อน', en: 'block' },
  DR: { th: 'ถัง', en: 'drum' },
  DZ: { th: 'โหล', en: 'dozen' },
  GL: { th: 'แกลลอน', en: 'gallon' },
  PA: { th: 'ถัง', en: 'pail' },
  ST: { th: 'ชุด', en: 'set' },
  TI: { th: 'กระป๋อง', en: 'tin' },
  TR: { th: 'ถาด', en: 'tray' },
  TU: { th: 'กระปุก', en: 'tub' },
  UN: { th: 'หน่วย', en: 'unit' },
};

/** ERP spellings + Thai words admins typed into `unit_label` → canonical code. */
const ALIASES: Record<string, string> = {
  GM: 'G',
  LT: 'L',
  CS: 'CT',
  TY: 'TR',
  PCS: 'PC',
  PIECE: 'PC',
  'กิโลกรัม': 'KG',
  'กก.': 'KG',
  'กก': 'KG',
  'โล': 'KG',
  'กิโล': 'KG',
  'กรัม': 'G',
  'ก.': 'G',
  'ลิตร': 'L',
  'มิลลิลิตร': 'ML',
  'มล.': 'ML',
  'ชิ้น': 'PC',
  'กล่อง': 'BX',
  'แพ็ค': 'PK',
  'แพ็ก': 'PK',
  'ลัง': 'CT',
  'ถุง': 'BG',
  'ขวด': 'BT',
  'ขวดโหล': 'JR',
  'กระป๋อง': 'CA',
};

/**
 * English display words (the `en` column above) that are not themselves codes. A form that was
 * pre-filled from an English-language read and saved back would otherwise persist "box" forever.
 */
const ENGLISH_LABEL_ALIASES: Record<string, string> = {
  BOX: 'BX',
  PACK: 'PK',
  CARTON: 'CT',
  CAN: 'CA',
  BAG: 'BG',
  JAR: 'JR',
  BOTTLE: 'BT',
  BLOCK: 'BK',
  DRUM: 'DR',
  DOZEN: 'DZ',
  GALLON: 'GL',
  PAIL: 'PA',
  SET: 'ST',
  TIN: 'TI',
  TRAY: 'TR',
  TUB: 'TU',
  UNIT: 'UN',
};

/** Unknown text (a custom admin label) comes back unchanged. */
export function localizeUnitLabel(
  unit: string | null | undefined,
  lang: RequestLang,
): string | null {
  const raw = unit?.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  const code = UNIT_LABELS[upper]
    ? upper
    : ALIASES[upper] ?? ALIASES[raw] ?? ENGLISH_LABEL_ALIASES[upper];
  return code ? UNIT_LABELS[code][lang] : raw;
}

export function localizeRuleUnitLabels<T extends { unit_label?: string }>(
  rules: T[],
  lang: RequestLang,
): T[] {
  return rules.map((rule) =>
    rule.unit_label
      ? { ...rule, unit_label: localizeUnitLabel(rule.unit_label, lang) ?? rule.unit_label }
      : rule,
  );
}

/**
 * What to persist for an admin-typed `unit_label`: an English display word ("box") is stored as
 * its ERP code ("BX") so a translated label can never end up in the table. Thai words, codes and
 * custom labels are kept exactly as typed.
 */
export function unitLabelForStorage<T extends string | null | undefined>(unit: T): T | string {
  const raw = unit?.trim();
  return (raw && ENGLISH_LABEL_ALIASES[raw.toUpperCase()]) || unit;
}
