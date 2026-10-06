import type {
  CreatePromotionPagePayload,
  PromotionPageSummary,
  UpdatePromotionPagePayload,
} from '@josh/shared-api';

/** Same expression as the backend (`PROMOTION_PAGE_SLUG_PATTERN`). */
export const PAGE_SLUG_PATTERN = /^[a-z0-9-]{3,80}$/;
/** Same as the backend's `PROMOTION_PAGE_SLUG_NOT_UUID`: the app reads a UUID after `promotion/` as a mechanic id, not a slug. */
export const PAGE_SLUG_UUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `scheme://something` — same rule as the backend DTO. */
const DEEPLINK_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i;

/** What the backend fills in when `mobile_deeplink` is empty — shown as the placeholder. */
export const defaultDeeplink = (slug: string) => `mobileshop://promotion/${slug}`;

/** Route inside shop-web (`toShopPath` / `toShopUrl` add the base path). */
export const shopPagePath = (slug: string) => `/promotions/${slug}`;

export type ImageField = 'imageDesktop' | 'imageMobile' | 'imageDesktopEn' | 'imageMobileEn';

export type PageFormState = {
  slug: string;
  name: string;
  campaignId: string;
  imageDesktop: string;
  imageMobile: string;
  imageDesktopEn: string;
  imageMobileEn: string;
  /** '' = use the default (`mobileshop://promotion/<slug>`). */
  deeplink: string;
  showOnHome: boolean;
  /** Text so the field can be cleared while typing. */
  homeSortOrder: string;
  isActive: boolean;
};

export type PageFormErrors = Partial<
  Record<'slug' | 'name' | 'campaign' | 'imageDesktop' | 'imageMobile' | 'deeplink' | 'homeSortOrder', string>
>;

export const emptyPageForm = (campaignId = ''): PageFormState => ({
  slug: '',
  name: '',
  campaignId,
  imageDesktop: '',
  imageMobile: '',
  imageDesktopEn: '',
  imageMobileEn: '',
  deeplink: '',
  showOnHome: false,
  homeSortOrder: '0',
  isActive: true,
});

export function formFromPage(page: PromotionPageSummary): PageFormState {
  const deeplink = page.mobile_deeplink ?? '';
  return {
    slug: page.slug,
    name: page.name,
    campaignId: page.campaign_id ?? '',
    imageDesktop: page.image_url_desktop ?? '',
    imageMobile: page.image_url_mobile ?? '',
    imageDesktopEn: page.image_url_desktop_en ?? '',
    imageMobileEn: page.image_url_mobile_en ?? '',
    // The default is not "a value": leaving the field empty is what keeps it the default.
    deeplink: deeplink === defaultDeeplink(page.slug) ? '' : deeplink,
    showOnHome: page.show_on_home,
    homeSortOrder: String(page.home_banner_sort_order ?? 0),
    isActive: page.is_active,
  };
}

/**
 * `original` = the saved form when editing, null when creating. A Thai image is required to
 * create a page; on edit only if the page has one (a legacy row may have none) — the admin
 * may not clear an image that is there. A campaign is required to create; on edit the page
 * keeps whatever it has (a legacy page without one stays valid until the admin picks one).
 */
export function validatePageForm(form: PageFormState, original: PageFormState | null): PageFormErrors {
  const errors: PageFormErrors = {};
  if (!original && !PAGE_SLUG_PATTERN.test(form.slug.trim())) {
    errors.slug = 'ใช้ตัวพิมพ์เล็ก a-z ตัวเลข และ - ยาว 3–80 ตัวอักษร';
  } else if (!original && PAGE_SLUG_UUID_SHAPED.test(form.slug.trim())) {
    errors.slug = 'slug ห้ามเป็นรูปแบบ UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)';
  }
  if (!original && !form.campaignId) errors.campaign = 'เลือก Campaign ที่หน้านี้ผูกอยู่';
  const name = form.name.trim();
  if (!name) errors.name = 'กรอกชื่อหน้า';
  else if (name.length > 200) errors.name = 'ชื่อยาวเกิน 200 ตัวอักษร';
  if (!form.imageDesktop.trim() && (!original || original.imageDesktop.trim())) {
    errors.imageDesktop = 'อัปโหลดภาพ Desktop (TH)';
  }
  if (!form.imageMobile.trim() && (!original || original.imageMobile.trim())) {
    errors.imageMobile = 'อัปโหลดภาพ Mobile (TH)';
  }
  // The server refuses this too (400) — say it on the field instead of after the round trip.
  if (form.showOnHome && !form.imageDesktop.trim() && !errors.imageDesktop) {
    errors.imageDesktop = 'ต้องมีภาพ Desktop (TH) ก่อนแสดงบนหน้าแรก';
  }
  const deeplink = form.deeplink.trim();
  if (deeplink && (deeplink.length > 500 || !DEEPLINK_PATTERN.test(deeplink))) {
    errors.deeplink = 'ต้องเป็นรูปแบบ scheme://path เช่น mobileshop://promotion/summer-sale';
  }
  const order = Number(form.homeSortOrder);
  if (!Number.isInteger(order) || order < 0) errors.homeSortOrder = 'ใส่จำนวนเต็ม 0 ขึ้นไป';
  return errors;
}

export function buildCreatePagePayload(form: PageFormState): CreatePromotionPagePayload {
  const payload: CreatePromotionPagePayload = {
    slug: form.slug.trim(),
    name: form.name.trim(),
    campaign_id: form.campaignId,
    image_url_desktop: form.imageDesktop.trim(),
    image_url_mobile: form.imageMobile.trim(),
    show_on_home: form.showOnHome,
    home_banner_sort_order: Number(form.homeSortOrder),
    is_active: form.isActive,
  };
  if (form.imageDesktopEn.trim()) payload.image_url_desktop_en = form.imageDesktopEn.trim();
  if (form.imageMobileEn.trim()) payload.image_url_mobile_en = form.imageMobileEn.trim();
  // Empty → the server writes the default; sending nothing says the same thing.
  if (form.deeplink.trim()) payload.mobile_deeplink = form.deeplink.trim();
  return payload;
}

/**
 * PUT body. `slug` is never sent (fixed after create). `campaign_id` goes only when the
 * admin attached a campaign to a page that had none — otherwise the campaign is read-only
 * and never sent. `mobile_deeplink` goes only when it changed — omitting it keeps a legacy
 * `mobileshop://promotion/<mechanic id>` link intact — and `''` resets it. An emptied
 * English image goes as `null` (clears it; the Thai image is served instead). A Thai image
 * that is empty (legacy page that never had one) is left out: the API refuses `''`.
 */
export function buildUpdatePagePayload(
  form: PageFormState,
  original: PageFormState,
): UpdatePromotionPagePayload {
  const payload: UpdatePromotionPagePayload = {
    name: form.name.trim(),
    image_url_desktop_en: form.imageDesktopEn.trim() || null,
    image_url_mobile_en: form.imageMobileEn.trim() || null,
    show_on_home: form.showOnHome,
    home_banner_sort_order: Number(form.homeSortOrder),
    is_active: form.isActive,
  };
  if (form.imageDesktop.trim()) payload.image_url_desktop = form.imageDesktop.trim();
  if (form.imageMobile.trim()) payload.image_url_mobile = form.imageMobile.trim();
  if (form.campaignId && form.campaignId !== original.campaignId) payload.campaign_id = form.campaignId;
  if (form.deeplink.trim() !== original.deeplink.trim()) {
    payload.mobile_deeplink = form.deeplink.trim();
  }
  return payload;
}

/** Unsaved edits? `baseline` = the saved form, or the empty one when creating. */
export const isPageFormDirty = (form: PageFormState, baseline: PageFormState): boolean =>
  (Object.keys(baseline) as Array<keyof PageFormState>).some((key) => form[key] !== baseline[key]);
