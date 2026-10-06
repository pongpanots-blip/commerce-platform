import { apiClient } from '../api-client/api-client';
import type { CouponDiscountScope } from '../coupon/coupon.api';
import type { FilterGroup } from '../filter-groups/filter-groups.api';
import type {
  PromotionMechanicFilters,
  PromotionMechanicGetQuery,
  PromotionMechanicRecord,
} from '../pricing/promotion-mechanic.api';

/**
 * A promotion page = banner (desktop/mobile x th/en) + the product list of its
 * campaign. Admin row; list and detail are the same shape.
 */
export type PromotionPageSummary = {
  id: string;
  slug: string;
  name: string;
  /** Thai banner — required on create; the `_en` pair falls back to it when empty. */
  image_url_desktop: string | null;
  image_url_mobile: string | null;
  image_url_desktop_en: string | null;
  image_url_mobile_en: string | null;
  /** Default `mobileshop://promotion/<slug>`. Legacy rows may hold a mechanic id. */
  mobile_deeplink: string | null;
  /** true → a HERO banner for this page is kept in sync on the storefront home. */
  show_on_home: boolean;
  home_banner_sort_order: number;
  /** The one web_banners row this page owns and syncs; other banners pointing at the page are never touched. */
  home_banner_id: string | null;
  /** Legacy only: pages made before campaigns listed one mechanic directly. */
  promotion_mechanic_id: string | null;
  campaign_id: string | null;
  is_active: boolean;
  /** Copied from the campaign; a page without one is open-ended. */
  start_date: string | null;
  end_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * A public, active, in-window coupon of the page's campaign, text already in the
 * requested `lang`. `coupon_code` is null when `auto_apply` (nothing to type — checkout
 * applies it by itself).
 */
export type PromotionPageCoupon = {
  id: string;
  coupon_code: string | null;
  name: string;
  detail: string | null;
  applicable_product: string | null;
  image_url: string | null;
  discount_type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discount_scope: CouponDiscountScope;
  discount_value: number;
  maximum_discount_amount: number | null;
  minimum_order_amount: number;
  end_date: string | null;
  auto_apply: boolean;
};

/**
 * GET /promotion-pages/by-slug/:slug — the page header for the requested
 * `lang`. Images are already one language (en falls back to th). Products come
 * from `getPromotionPageProducts`.
 */
export type PromotionPagePublic = {
  id: string;
  slug: string;
  name: string;
  image_url_desktop: string | null;
  image_url_mobile: string | null;
  mobile_deeplink: string;
  campaign_id: string | null;
  start_date: string | null;
  end_date: string | null;
  /** Always present; `[]` when the campaign has no public coupon live right now. */
  coupons: PromotionPageCoupon[];
};

/** Create body. Uploads for the images use `scope: 'promotions'`. */
export type CreatePromotionPagePayload = {
  slug: string;
  name: string;
  /** Required (400 without it): a page belongs to exactly one campaign, which owns its dates. */
  campaign_id: string;
  /** Legacy only. */
  promotion_mechanic_id?: string;
  image_url_desktop: string;
  image_url_mobile: string;
  image_url_desktop_en?: string | null;
  image_url_mobile_en?: string | null;
  /** Empty / omitted → `mobileshop://promotion/<slug>`. */
  mobile_deeplink?: string | null;
  show_on_home?: boolean;
  home_banner_sort_order?: number;
  is_active?: boolean;
};

/**
 * PUT body — every field optional; `slug` cannot change (400 if it differs).
 * `mobile_deeplink: ''` resets to the default; an empty / null English image clears it.
 */
export type UpdatePromotionPagePayload = Omit<
  Partial<CreatePromotionPagePayload>,
  'campaign_id' | 'promotion_mechanic_id'
> & {
  campaign_id?: string | null;
  promotion_mechanic_id?: string | null;
};

/**
 * Public shop/mobile list of live pages, images resolved for `lang`. Field
 * names are the ones the shop list and the app already read.
 */
export type PromotionPageShopSummary = {
  id: string;
  slug: string;
  title: string;
  /** Always null now (no layout SEO text); kept so clients that decode it keep working. */
  description: null;
  imageUrlWeb: string | null;
  imageUrlMobile: string | null;
  mobile_deeplink: string;
  startDate: string | null;
  endDate: string | null;
  /** Always null now (no publish step); kept so clients that decode it keep working. */
  publishedAt: null;
};

/** GET /promotion-pages/by-slug/:slug/products — same shape as GET /promotion-mechanics/:id. */
export type PromotionPageProducts = {
  /**
   * Each item carries the id of the mechanic (promotion) it came from. Coupon-scoped SKUs
   * have no mechanic: `promotion_mechanic_id`, `badge_text` and `value` are null (plain card).
   */
  skuItems: Array<
    Omit<NonNullable<PromotionMechanicRecord['skuItems']>[number], 'id' | 'badge_text' | 'value'> & {
      /** Coupon-only SKUs are not a mechanic item row, so they carry no id. */
      id?: string;
      promotion_mechanic_id: string | null;
      badge_text?: string | null;
      value?: PromotionMechanicRecord['value'];
    }
  >;
  filters: PromotionMechanicFilters;
  /** Self-describing filter UI (see docs/filter-groups-api.md). */
  filterGroups: FilterGroup[];
  meta: NonNullable<PromotionMechanicRecord['meta']>;
};

export async function listPromotionPages(): Promise<PromotionPageSummary[]> {
  const res = await apiClient.get('/promotion-pages');
  return res.data;
}

export async function listShopPromotionPages(
  lang?: 'th' | 'en',
): Promise<PromotionPageShopSummary[]> {
  const res = await apiClient.get('/promotion-pages/shop', {
    params: lang ? { lang } : undefined,
  });
  return res.data;
}

export async function createPromotionPage(
  payload: CreatePromotionPagePayload,
): Promise<PromotionPageSummary> {
  const res = await apiClient.post('/promotion-pages', payload);
  return res.data;
}

export async function getPromotionPage(id: string): Promise<PromotionPageSummary> {
  const res = await apiClient.get(`/promotion-pages/${id}`);
  return res.data;
}

export async function updatePromotionPage(
  id: string,
  payload: UpdatePromotionPagePayload,
): Promise<PromotionPageSummary> {
  const res = await apiClient.put(`/promotion-pages/${id}`, payload);
  return res.data;
}

export async function deletePromotionPage(id: string): Promise<void> {
  await apiClient.delete(`/promotion-pages/${id}`);
}

/** Returns null on 404 (hidden or unknown page) so the caller can `notFound()` without a try/catch. */
async function getOrNull<T>(
  path: string,
  params?: Record<string, unknown>,
): Promise<T | null> {
  try {
    const res = await apiClient.get(path, { params });
    return res.data;
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 404) return null;
    throw err;
  }
}

/** Public read used by shop-web's `/promotions/[slug]` (header: banner, name, deeplink). */
export function getPromotionPageBySlug(
  slug: string,
  lang?: 'th' | 'en',
): Promise<PromotionPagePublic | null> {
  return getOrNull(`/promotion-pages/by-slug/${slug}`, lang ? { lang } : undefined);
}

/** Public product list of the page: filters / sort / paging like `getPromotionMechanic`. */
export function getPromotionPageProducts(
  slug: string,
  query?: PromotionMechanicGetQuery,
): Promise<PromotionPageProducts | null> {
  return getOrNull(`/promotion-pages/by-slug/${slug}/products`, query);
}
