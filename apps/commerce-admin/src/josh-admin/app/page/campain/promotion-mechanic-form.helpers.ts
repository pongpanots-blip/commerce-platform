import { uiText as __uiText } from '@cp/ui';
// ui-static-options-migration: display metadata; identifiers remain unchanged
import { uiText } from '@cp/ui';
import {
  fromBangkokInputValue,
  toBangkokInputValue,
  type CreatePromotionMechanicPayload,
  type MechanicAudience,
  type PromotionMechanicAudience,
  type PromotionMechanicCap,
  type PromotionMechanicRecord,
  type PromotionValue,
  type UpdatePromotionMechanicPayload,
} from '@josh/shared-api';

/** `special_price` is the UI name for a single tier at min_qty 1 — the API has no such type. */
export type MechanicValueType = 'percentage' | 'special_price' | 'tiered' | 'bogo';

export type MechanicTierRow = {
  id: string;
  minQty: string;
  maxQty: string;
  price: string;
};

/** A company picked as (part of) the audience — the name is only for the chip. */
export type AudienceCompany = { id: string; name: string };

export type MechanicForm = {
  name: string;
  badgeText: string;
  /** English badge; '' = none (both empty = the API generates per language). */
  badgeTextEn: string;
  isActive: boolean;
  /** '' = not in a campaign. */
  campaignId: string;
  /** Bangkok `datetime-local` values; only used (and sent) without a campaign. */
  startDate: string;
  endDate: string;
  valueType: MechanicValueType;
  percent: string;
  specialPrice: string;
  tiers: MechanicTierRow[];
  buyQty: string;
  getQty: string;
  getDiscountPercent: string;
  productSetIds: string[];
  /** Sets whose snapshot the admin chose to re-take ("ใช้รายการล่าสุด"). */
  refreshSetIds: string[];
  /** Flash-sale unit cap as typed; '' = unlimited. */
  maxUnits: string;
  /** Who the promo is for: everyone (guests too) or only the picked companies. */
  audience: MechanicAudience;
  /** The picked companies; only used (and sent) when `audience` is `companies`. */
  audienceCompanies: AudienceCompany[];
};

/** What the server has now — lets an update send only what changed. */
export type MechanicOriginal = {
  value: PromotionValue | null;
  badgeText: string;
  badgeTextEn: string;
  /** Empty = legacy mechanic (hand-typed SKUs, no Product Set snapshots). */
  productSetIds: string[];
  /** '' = not in a campaign. */
  campaignId: string;
  /** Loaded Bangkok input values — dates are only sent when the admin changed them. */
  startDate: string;
  endDate: string;
  /** Loaded unit cap ('' = unlimited) — only sent when the admin changed it. */
  maxUnits: string;
  /** Loaded audience — only sent when the admin changed it. */
  audience: MechanicAudience;
  /** Loaded company ids (companies that still exist) — compared as a set. */
  audienceCompanyIds: string[];
  /** Old group / cart mechanic: the API only accepts name and is_active for it. */
  basicsOnly: boolean;
};

export const VALUE_TYPE_OPTIONS: Array<{ value: MechanicValueType; label: string }> = [
  { value: 'percentage', get label(){return uiText("ลดเป็น %");} },
  { value: 'special_price', get label(){return uiText("ราคาโปร");} },
  { value: 'tiered', get label(){return uiText("ยิ่งซื้อยิ่งถูก");} },
  { value: 'bogo', get label(){return uiText("ซื้อ X แถม Y");} },
];

let tierSeq = 0;
export function newTierRow(minQty = '', maxQty = '', price = ''): MechanicTierRow {
  tierSeq += 1;
  return { id: `tier-${tierSeq}`, minQty, maxQty, price };
}

/** Next tier starts right after the previous one ends (max, or min when open-ended). */
export function nextTierRow(tiers: MechanicTierRow[]): MechanicTierRow {
  const last = tiers[tiers.length - 1];
  const edge = last ? toNumber(last.maxQty) || toNumber(last.minQty) : NaN;
  return newTierRow(Number.isInteger(edge) ? String(edge + 1) : '');
}

export function emptyMechanicForm(): MechanicForm {
  return {
    name: '',
    badgeText: '',
    badgeTextEn: '',
    isActive: true,
    campaignId: '',
    startDate: '',
    endDate: '',
    valueType: 'percentage',
    percent: '',
    specialPrice: '',
    tiers: [newTierRow('1')],
    buyQty: '',
    getQty: '',
    getDiscountPercent: '100',
    productSetIds: [],
    refreshSetIds: [],
    maxUnits: '',
    audience: 'all',
    audienceCompanies: [],
  };
}

function toNumber(text: string): number {
  return text.trim() === '' ? NaN : Number(text);
}

const isPositiveInt = (n: number) => Number.isInteger(n) && n >= 1;

function valueToFormFields(value: PromotionValue | null | undefined): Partial<MechanicForm> {
  if (value?.type === 'percentage') {
    return { valueType: 'percentage', percent: String(value.percent) };
  }
  if (value?.type === 'tiered') {
    const [only] = value.tiers;
    if (value.tiers.length === 1 && only.min_qty === 1 && only.max_qty == null) {
      return { valueType: 'special_price', specialPrice: String(only.promotion_price) };
    }
    return {
      valueType: 'tiered',
      tiers: value.tiers.map((t) =>
        newTierRow(String(t.min_qty), t.max_qty == null ? '' : String(t.max_qty), String(t.promotion_price)),
      ),
    };
  }
  if (value?.type === 'bogo') {
    return {
      valueType: 'bogo',
      buyQty: String(value.buy_qty),
      getQty: String(value.get_qty),
      getDiscountPercent: String(value.get_discount_percent),
    };
  }
  return {};
}

/** Highest cap the API accepts (`MAX_UNIT_CAP` in the backend DTO). */
export const MAX_UNIT_CAP = 1_000_000;

/** The typed value of the cap input ('' = unlimited) from the admin-only cap read. */
const capText = (cap: PromotionMechanicCap | null | undefined) =>
  cap?.max_units == null ? '' : String(cap.max_units);

/**
 * The audience read is admin-only (the public record carries none), and `null` = not loaded = everyone.
 * Chips show only companies that still exist: a deleted company id would be refused by the server on
 * save, so it is dropped here instead.
 */
const audienceKind = (audience: PromotionMechanicAudience | null | undefined): MechanicAudience =>
  audience?.audience ?? 'all';
const audienceCompaniesOf = (audience: PromotionMechanicAudience | null | undefined): AudienceCompany[] =>
  audience?.audience === 'companies' ? audience.companies : [];

/** Edit form from the loaded record + the set ids the server reports (empty = legacy) + the admin cap and audience. */
export function formFromMechanic(
  record: PromotionMechanicRecord,
  productSetIds: string[],
  cap: PromotionMechanicCap | null = null,
  audience: PromotionMechanicAudience | null = null,
): MechanicForm {
  return {
    ...emptyMechanicForm(),
    name: record.name,
    badgeText: record.badge_text ?? '',
    badgeTextEn: record.badge_text_en ?? '',
    isActive: record.is_active,
    campaignId: record.campaign_id ?? '',
    startDate: toBangkokInputValue(record.start_date),
    endDate: toBangkokInputValue(record.end_date),
    ...valueToFormFields(record.value),
    productSetIds,
    maxUnits: capText(cap),
    audience: audienceKind(audience),
    audienceCompanies: audienceCompaniesOf(audience),
  };
}

export function originalFromMechanic(
  record: PromotionMechanicRecord,
  productSetIds: string[],
  cap: PromotionMechanicCap | null = null,
  audience: PromotionMechanicAudience | null = null,
): MechanicOriginal {
  return {
    value: record.value,
    badgeText: record.badge_text ?? '',
    badgeTextEn: record.badge_text_en ?? '',
    productSetIds,
    campaignId: record.campaign_id ?? '',
    startDate: toBangkokInputValue(record.start_date),
    endDate: toBangkokInputValue(record.end_date),
    maxUnits: capText(cap),
    audience: audienceKind(audience),
    audienceCompanyIds: audienceCompaniesOf(audience).map((company) => company.id),
    basicsOnly: record.apply_to !== 'sku',
  };
}

export function buildValue(form: MechanicForm): PromotionValue {
  switch (form.valueType) {
    case 'percentage':
      return { type: 'percentage', percent: Number(form.percent) };
    case 'special_price':
      return {
        type: 'tiered',
        tiers: [{ min_qty: 1, promotion_price: Number(form.specialPrice) }],
      };
    case 'tiered':
      return {
        type: 'tiered',
        tiers: form.tiers
          .map((t) => ({
            min_qty: Number(t.minQty),
            ...(t.maxQty.trim() === '' ? {} : { max_qty: Number(t.maxQty) }),
            promotion_price: Number(t.price),
          }))
          .sort((a, b) => a.min_qty - b.min_qty),
      };
    case 'bogo':
      return {
        type: 'bogo',
        buy_qty: Number(form.buyQty),
        get_qty: Number(form.getQty),
        get_discount_percent: Number(form.getDiscountPercent),
      };
  }
}

/** Order-insensitive fingerprint — the server's jsonb does not preserve key order. */
function valueKey(value: PromotionValue | null | undefined): string {
  if (!value) return '';
  switch (value.type) {
    case 'percentage':
      return `p:${value.percent}`;
    case 'tiered':
      return `t:${[...value.tiers]
        .sort((a, b) => a.min_qty - b.min_qty)
        .map((t) => `${t.min_qty}-${t.max_qty ?? ''}-${t.promotion_price}`)
        .join('|')}`;
    case 'bogo':
      return `b:${value.buy_qty}:${value.get_qty}:${value.get_discount_percent}`;
    default:
      return JSON.stringify(value);
  }
}

// The server keeps the admin's set order (`product_set_ids`) and this UI has no reorder, so
// only membership can change — compare as sets.
const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * Legacy mechanic and no set picked: value / badge / sets are not sent (the API needs a set
 * to convert), so the UI locks those fields and only name/active/campaign/dates are saved.
 */
export function isLegacyKeep(form: MechanicForm, original?: MechanicOriginal): boolean {
  return !!original && original.productSetIds.length === 0 && form.productSetIds.length === 0;
}

function campaignFields(form: MechanicForm) {
  return form.campaignId
    ? { campaign_id: form.campaignId }
    : {
        start_date: fromBangkokInputValue(form.startDate),
        end_date: fromBangkokInputValue(form.endDate),
      };
}

export function buildCreatePayload(form: MechanicForm): CreatePromotionMechanicPayload {
  const badge = form.badgeText.trim();
  const badgeEn = form.badgeTextEn.trim();
  const maxUnits = form.maxUnits.trim();
  return {
    name: form.name.trim(),
    value: buildValue(form),
    product_set_ids: form.productSetIds,
    ...(badge ? { badge_text: badge } : {}),
    ...(badgeEn ? { badge_text_en: badgeEn } : {}),
    ...(maxUnits ? { max_units: Number(maxUnits) } : {}),
    // everyone is the server default: only a targeted promo says anything
    ...(form.audience === 'companies'
      ? { audience: 'companies' as const, audience_company_ids: form.audienceCompanies.map((company) => company.id) }
      : {}),
    ...campaignFields(form),
  };
}

/**
 * Sends only what changed: value / badge (either language) / sets each make the server re-materialize every SKU
 * item and flush price caches, so a rename or on/off toggle must not carry them.
 */
export function buildUpdatePayload(
  form: MechanicForm,
  original: MechanicOriginal,
): UpdatePromotionMechanicPayload {
  const payload: UpdatePromotionMechanicPayload = {
    name: form.name.trim(),
    is_active: form.isActive,
  };
  if (original.basicsOnly) return payload;

  // Only what changed: an unchanged campaign_id lets the server's "moved mid-save" check
  // work, and re-sending a loaded date would round it to the minute (…16:59:59.999 → :59:00).
  // null detaches (the server keeps the dates); dates are ignored inside a campaign.
  if (form.campaignId !== original.campaignId) payload.campaign_id = form.campaignId || null;
  if (!form.campaignId) {
    if (form.startDate !== original.startDate) {
      payload.start_date = fromBangkokInputValue(form.startDate);
    }
    if (form.endDate !== original.endDate) payload.end_date = fromBangkokInputValue(form.endDate);
  }
  // The cap does not depend on Product sets, so a legacy mechanic can be capped too. A change makes the
  // server re-check the price caches; blank = unlimited = null (clears it).
  if (form.maxUnits.trim() !== original.maxUnits.trim()) {
    payload.max_units = form.maxUnits.trim() === '' ? null : Number(form.maxUnits);
  }
  // The audience does not depend on Product sets either. A change makes the server drop every price cache,
  // so an untouched audience is never sent; `all` clears the list on the server.
  const companyIds = form.audienceCompanies.map((company) => company.id);
  if (
    form.audience !== original.audience ||
    (form.audience === 'companies' && !sameIds(companyIds, original.audienceCompanyIds))
  ) {
    payload.audience = form.audience;
    if (form.audience === 'companies') payload.audience_company_ids = companyIds;
  }
  if (isLegacyKeep(form, original)) return payload;

  const value = buildValue(form);
  const converting = original.productSetIds.length === 0;
  if (converting || valueKey(value) !== valueKey(original.value)) payload.value = value;
  if (form.badgeText.trim() !== original.badgeText.trim()) {
    payload.badge_text = form.badgeText.trim();
  }
  if (form.badgeTextEn.trim() !== original.badgeTextEn.trim()) {
    payload.badge_text_en = form.badgeTextEn.trim();
  }
  if (converting || !sameIds(form.productSetIds, original.productSetIds)) {
    payload.product_set_ids = form.productSetIds;
  }
  const refresh = form.refreshSetIds.filter((id) => form.productSetIds.includes(id));
  if (refresh.length > 0) payload.refresh_product_set_ids = refresh;
  return payload;
}

export type MechanicFormErrors = Record<string, string>;

/** Key of a tier cell's error, e.g. `tier-3-min` — the form reads it by row id. */
export const tierErrorKey = (rowId: string, field: 'min' | 'max' | 'price') =>
  `${rowId}-${field}`;

function validateTiers(tiers: MechanicTierRow[], errors: MechanicFormErrors) {
  if (tiers.length === 0) {
    errors.tiers = 'เพิ่มอย่างน้อย 1 ขั้น';
    return;
  }
  const parsed = tiers.map((row) => ({
    row,
    min: toNumber(row.minQty),
    max: row.maxQty.trim() === '' ? undefined : toNumber(row.maxQty),
    price: toNumber(row.price),
  }));
  for (const { row, min, max, price } of parsed) {
    if (!isPositiveInt(min)) errors[tierErrorKey(row.id, 'min')] = 'ต้องเป็นจำนวนเต็ม ≥ 1';
    if (max !== undefined && !(isPositiveInt(max) && !(max < min))) {
      errors[tierErrorKey(row.id, 'max')] = 'ต้องเป็นจำนวนเต็ม และไม่น้อยกว่าขั้นต่ำ';
    }
    if (!(price >= 0)) errors[tierErrorKey(row.id, 'price')] = 'ราคาต้อง ≥ 0';
  }
  if (Object.keys(errors).some((key) => key.startsWith('tier-'))) return;

  // Same rule as the backend: each tier starts after the previous one ends (max, or its min).
  const sorted = [...parsed].sort((a, b) => a.min - b.min);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    if (sorted[i].min <= (prev.max ?? prev.min)) {
      errors[tierErrorKey(sorted[i].row.id, 'min')] = 'ช่วงห้ามทับกับขั้นก่อนหน้า';
    }
  }
}

export function validateMechanicForm(
  form: MechanicForm,
  original?: MechanicOriginal,
): MechanicFormErrors {
  const errors: MechanicFormErrors = {};
  if (!form.name.trim()) errors.name = 'กรุณากรอกชื่อโปร';
  if (original?.basicsOnly) return errors;
  if (
    form.maxUnits.trim() !== '' &&
    !(isPositiveInt(toNumber(form.maxUnits)) && toNumber(form.maxUnits) <= MAX_UNIT_CAP)
  ) {
    errors.maxUnits = `ต้องเป็นจำนวนเต็ม 1 – ${MAX_UNIT_CAP.toLocaleString('th-TH')} (เว้นว่าง = ไม่จำกัด)`;
  }
  if (form.audience === 'companies' && form.audienceCompanies.length === 0) {
    errors.audience = 'เลือกบริษัทอย่างน้อย 1 บริษัท หรือเปลี่ยนเป็น “ทุกคน”';
  }

  if (!form.campaignId) {
    const start = fromBangkokInputValue(form.startDate);
    const end = fromBangkokInputValue(form.endDate);
    if (!start || !end) errors.dates = 'กรุณาระบุวันเริ่มและวันสิ้นสุด หรือเลือก Campaign';
    else if (end < start) errors.dates = 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม';
  }
  if (isLegacyKeep(form, original)) return errors;

  if (form.productSetIds.length === 0) errors.sets = 'เลือก Product set อย่างน้อย 1 ชุด';

  switch (form.valueType) {
    case 'percentage': {
      const percent = toNumber(form.percent);
      if (!(percent > 0 && percent <= 100)) errors.percent = 'ระบุ % มากกว่า 0 ถึง 100';
      break;
    }
    case 'special_price':
      if (!(toNumber(form.specialPrice) >= 0)) errors.specialPrice = 'ระบุราคาโปร (≥ 0)';
      break;
    case 'tiered':
      validateTiers(form.tiers, errors);
      break;
    case 'bogo': {
      if (!isPositiveInt(toNumber(form.buyQty))) errors.buyQty = 'ต้องเป็นจำนวนเต็ม ≥ 1';
      if (!isPositiveInt(toNumber(form.getQty))) errors.getQty = 'ต้องเป็นจำนวนเต็ม ≥ 1';
      const off = toNumber(form.getDiscountPercent);
      if (!(off >= 0 && off <= 100)) errors.getDiscountPercent = 'ระบุ % ระหว่าง 0 ถึง 100';
      break;
    }
  }
  return errors;
}

/** Thai one-liner for the list. */
export function summarizeMechanicValue(value: PromotionValue | null | undefined): string {
  switch (value?.type) {
    case 'percentage':
      return __uiText("ลด {0}%",{"0":value.percent});
    case 'tiered': {
      const [only] = value.tiers;
      // same test as valueToFormFields: a single open-ended tier at 1 is "ราคาโปร"
      return value.tiers.length === 1 && only.min_qty === 1 && only.max_qty == null
        ? __uiText("ราคาโปร ฿{0}",{"0":Number(only.promotion_price).toLocaleString('th-TH')})
        : __uiText("ยิ่งซื้อยิ่งถูก {0} ขั้น",{"0":value.tiers.length});
    }
    case 'bogo':
      return __uiText("ซื้อ {0} แถม {1}{2}",{"0":value.buy_qty,"1":value.get_qty,"2":value.get_discount_percent === 100 ? '' : __uiText(" (ลด {0}%)",{"0":value.get_discount_percent})});
    default:
      return '-';
  }
}

type LegacyItem = NonNullable<PromotionMechanicRecord['skuItems']>[number];

/**
 * Legacy mechanics keep the discount per SKU (item `value`, or only `quantity_rules`).
 * One line for the read-only display: the shared discount, or how many kinds there are.
 */
export function summarizeLegacyItems(items: LegacyItem[] | undefined): string {
  const kinds = new Set(
    (items ?? []).map((item) =>
      summarizeMechanicValue(
        item.value ??
          (item.quantity_rules?.length
            ? {
                type: 'tiered',
                tiers: item.quantity_rules.map(({ min_qty, max_qty, promotion_price }) => ({
                  min_qty,
                  max_qty,
                  promotion_price,
                })),
              }
            : null),
      ),
    ),
  );
  kinds.delete('-');
  if (kinds.size === 0) return '-';
  return kinds.size === 1 ? [...kinds][0] : __uiText("หลายแบบ ({0} แบบ ตามแต่ละสินค้า)",{"0":kinds.size});
}

/** List cell: new mechanics carry one `value`; a legacy one has none (its discount is per SKU). */
export function summarizeMechanicRow(value: PromotionValue | null | undefined): string {
  return value ? summarizeMechanicValue(value) : __uiText("ตามแต่ละสินค้า (แบบเดิม)");
}

// ui-display-helper-migration: display descriptions; record values and enum keys remain data
