// Copied from josh apps/backend/src/shared/{helpers,types} (origin/main d84d692b). Only imports changed:
// josh entities → slim copies in ./josh-pricing-tables, date helper → ../jagota/date-only.helper.
import { DataSource, FindOptionsWhere, Not, Repository } from 'typeorm';
import { PromotionMechanic, PromotionMechanicSkuItem, PromotionPage } from './josh-pricing-tables';
import { isActiveDateRange } from '../jagota/date-only.helper';
import { PromotionValue } from './promotion-value';
import type { RequestLang } from './unit-label.helper';
import { localizeRuleUnitLabels } from './unit-label.helper';

export type ProductActivePromotion = {
  mechanic_id: string;
  name: string;
  badge_text: string | null;
  value: PromotionValue;
  page_slug: string | null;
  start_date: string;
  end_date: string;
};

type LegacyQtyRule = {
  min_qty: number;
  max_qty?: number;
  promotion_price: number;
  unit_label?: string;
  badge_text?: string;
};

/** The admin-typed badge pair of a sku item / mechanic (`badge_text` = Thai, `badge_text_en` = English). */
export type PromotionBadgeSource = {
  badge_text?: string | null;
  badge_text_en?: string | null;
} | null;

/**
 * The ONE badge a response carries, resolved for `lang`: the admin-typed badge of that language
 * (item first, then mechanic), else generated from `value`. A Thai-only typed badge is never
 * shown for `en` — it falls to the generated English text ("15% off") instead.
 */
export function formatPromotionBadgeText(
  value: PromotionValue | null,
  item?: PromotionBadgeSource,
  mechanic?: PromotionBadgeSource,
  lang: RequestLang = 'th',
): string | null {
  const en = lang === 'en';
  const typed = (source?: PromotionBadgeSource) =>
    (en ? source?.badge_text_en : source?.badge_text)?.trim();
  const custom = typed(item) || typed(mechanic);
  if (custom) return custom;
  if (!value) return null;
  switch (value.type) {
    case 'bogo': {
      const base = en
        ? `Buy ${value.buy_qty} get ${value.get_qty}`
        : `ซื้อ ${value.buy_qty} แถม ${value.get_qty}`;
      if (value.get_discount_percent === 100) return base;
      return en
        ? `${base} ${value.get_discount_percent}% off`
        : `${base} ลด ${value.get_discount_percent}%`;
    }
    case 'percentage':
      return en ? `${value.percent}% off` : `ลด ${value.percent}%`;
    case 'tiered':
      if (value.tiers.length <= 1) return en ? 'Special price' : 'ราคาพิเศษ';
      return en ? 'Volume discount' : 'ลดตามจำนวน';
    case 'fixed':
      return en ? `฿${value.amount} off` : `ลด ฿${value.amount}`;
    default:
      return null;
  }
}

export function promotionValueFromSkuItem(item: {
  value: PromotionValue | null;
  quantity_rules?: LegacyQtyRule[] | null;
}): PromotionValue | null {
  if (item.value) return item.value;
  const rules = item.quantity_rules ?? [];
  if (rules.length === 0) return null;
  return {
    type: 'tiered',
    tiers: rules.map((r) => ({
      min_qty: r.min_qty,
      max_qty: r.max_qty,
      promotion_price: Number(r.promotion_price),
      unit_label: r.unit_label,
      badge_text: r.badge_text,
    })),
  };
}

/**
 * A capped (flash-sale) mechanic whose units are all held by orders prices
 * nothing — lists, PDP and cart reprice fall through to the next price layer.
 * Uncapped (`max_units` null) is never sold out.
 */
export function isMechanicSoldOut(mechanic: {
  max_units?: number | null;
  sold_units?: number | null;
}): boolean {
  return (
    mechanic.max_units != null &&
    Number(mechanic.sold_units ?? 0) >= mechanic.max_units
  );
}

/**
 * Whether the mechanic is visible to (and prices for) this company — the one place the rule lives: the price
 * loader, the badge loader, the tier-rule loader (via the price loader), the hidden-mechanic list behind the
 * public mechanic reads and the promotion page products all go through it. Only an explicit
 * `audience = 'all'` applies to everyone (guests too); only an explicit `'companies'` applies to a company on its list. Everything else fails
 * closed for EVERYONE: an audience that was not loaded (`undefined`, e.g. a partial `select`) or a value
 * this code does not know never passes — not as `'all'`, and not even for a listed company. A guest / no
 * company never matches a targeted mechanic, and a company list that was not loaded
 * (`audience_company_ids` is `select: false`) matches nobody. A line already sitting in a cart keeps its
 * price and mechanic id until it is repriced — changing an audience does not reprice existing carts.
 */
export function mechanicAudienceAllows(
  mechanic: { audience?: string | null; audience_company_ids?: string[] | null },
  companyId: string | null | undefined,
): boolean {
  if (mechanic.audience === 'all') return true;
  if (mechanic.audience !== 'companies' || !companyId) return false;
  const company = companyId.toLowerCase();
  return (mechanic.audience_company_ids ?? []).some((id) => id.toLowerCase() === company);
}

/**
 * Ids of the mechanics `companyId` may NOT see, among those matching `where` — targeted at other
 * companies. What the public mechanic reads and the promotion page product list drop (a promo the caller is not eligible for is invisible, not listed at
 * normal price). One small query: only targeted rows.
 */
export async function loadHiddenTargetedMechanicIds(
  mechanics: Repository<PromotionMechanic>,
  companyId: string | null,
  where: FindOptionsWhere<PromotionMechanic> = {},
): Promise<Set<string>> {
  const targeted = await mechanics.find({
    where: { ...where, audience: Not('all') },
    select: ['id', 'audience', 'audience_company_ids'],
  });
  return new Set(
    targeted
      .filter((mechanic) => !mechanicAudienceAllows(mechanic, companyId))
      .map((mechanic) => mechanic.id),
  );
}

/** `mechanicId` = the winning mechanic; both null when none is active. */
export type MechanicPricing = {
  value: PromotionValue | null;
  mechanicId: string | null;
};

/**
 * Returns a map entry for every SKU assigned to a mechanic, even after the
 * campaign expires. `value: null` means there is no active mechanic, so undated
 * copies in promotion_quantity_rules must not be used as a fallback.
 *
 * `companyId` is required on purpose (`null` = guest / no company): a caller that forgets it
 * fails to compile instead of silently pricing targeted mechanics for everyone. A targeted
 * mechanic the company is not on is skipped
 * like an inactive one: the SKU still counts as mechanic-owned (no fallback to undated rules), so it
 * is priced normally, and the next mechanic that does apply wins.
 */
export async function loadMechanicPricingByProductIds(
  dataSource: DataSource,
  productInventoryIds: string[],
  companyId: string | null,
  at: Date = new Date(),
): Promise<Map<string, MechanicPricing>> {
  const result = new Map<string, MechanicPricing>();
  const ids = [...new Set(productInventoryIds.filter(Boolean))];
  if (ids.length === 0) return result;

  const items = await dataSource
    .getRepository(PromotionMechanicSkuItem)
    .createQueryBuilder('item')
    .innerJoinAndSelect('item.promotionMechanic', 'mechanic')
    .addSelect('mechanic.audience_company_ids')
    .where('item.product_inventory_id IN (:...ids)', { ids })
    .orderBy('mechanic.start_date', 'DESC')
    .getMany();

  const itemsByProduct = new Map<string, PromotionMechanicSkuItem[]>();
  for (const item of items) {
    const productId = item.product_inventory_id;
    if (!productId) continue;
    const productItems = itemsByProduct.get(productId) ?? [];
    productItems.push(item);
    itemsByProduct.set(productId, productItems);
  }

  for (const [productId, productItems] of itemsByProduct) {
    const activeItem = productItems.find(
      (item) =>
        item.promotionMechanic.is_active &&
        !isMechanicSoldOut(item.promotionMechanic) &&
        mechanicAudienceAllows(item.promotionMechanic, companyId) &&
        isActiveDateRange(
          item.promotionMechanic.start_date,
          item.promotionMechanic.end_date,
          at,
        ),
    );
    result.set(productId, {
      value: activeItem ? promotionValueFromSkuItem(activeItem) : null,
      mechanicId: activeItem?.promotionMechanic.id ?? null,
    });
  }

  return result;
}

/**
 * The badge / link list (`active_promotions`) of each SKU. `companyId` is required for the same
 * reason as in `loadMechanicPricingByProductIds` (`null` = guest): a targeted mechanic never
 * shows on a product the caller's company is not on.
 */
export async function loadActivePromotionsByProductIds(
  dataSource: DataSource,
  productInventoryIds: string[],
  companyId: string | null,
  at: Date = new Date(),
  lang: RequestLang = 'th',
): Promise<Map<string, ProductActivePromotion[]>> {
  const result = new Map<string, ProductActivePromotion[]>();
  if (productInventoryIds.length === 0) return result;

  const items = await dataSource
    .getRepository(PromotionMechanicSkuItem)
    .createQueryBuilder('item')
    .innerJoinAndSelect('item.promotionMechanic', 'mechanic')
    .addSelect('mechanic.audience_company_ids')
    .where('item.product_inventory_id IN (:...ids)', {
      ids: productInventoryIds,
    })
    .andWhere('mechanic.is_active = true')
    .orderBy('mechanic.start_date', 'DESC')
    .getMany();

  const activeRows: Array<{
    item: PromotionMechanicSkuItem;
    value: PromotionValue;
  }> = [];

  for (const item of items) {
    const productId = item.product_inventory_id;
    if (!productId) continue;

    const mechanic = item.promotionMechanic;
    if (
      isMechanicSoldOut(mechanic) ||
      !mechanicAudienceAllows(mechanic, companyId) ||
      !isActiveDateRange(mechanic.start_date, mechanic.end_date, at)
    ) {
      continue;
    }

    const value = promotionValueFromSkuItem(item);
    if (!value) continue;

    activeRows.push({ item, value });
  }

  // page_slug = slug of the LIVE page (active, inside its window) of the
  // mechanic's campaign — or, for a legacy page, the page that lists the
  // mechanic directly. Newest page wins if there are several.
  const mechanics = new Map(
    activeRows.map(({ item }) => [item.promotionMechanic.id, item.promotionMechanic]),
  );
  const pageSlugByMechanicId = new Map<string, string>();
  if (mechanics.size > 0) {
    const mechanicIds = [...mechanics.keys()];
    const campaignIds = [
      ...new Set(
        [...mechanics.values()]
          .map((mechanic) => mechanic.campaign_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const pages = await dataSource
      .getRepository(PromotionPage)
      .createQueryBuilder('page')
      .where('page.is_active = true')
      .andWhere('(page.start_date IS NULL OR page.start_date <= :at)', { at })
      .andWhere('(page.end_date IS NULL OR page.end_date >= :at)', { at })
      .andWhere(
        campaignIds.length
          ? '(page.campaign_id IN (:...campaignIds) OR page.promotion_mechanic_id IN (:...mechanicIds))'
          : 'page.promotion_mechanic_id IN (:...mechanicIds)',
        { campaignIds, mechanicIds },
      )
      .orderBy('page.updated_at', 'DESC')
      .getMany();

    for (const mechanic of mechanics.values()) {
      const page = pages.find(
        (candidate) =>
          (mechanic.campaign_id && candidate.campaign_id === mechanic.campaign_id) ||
          candidate.promotion_mechanic_id === mechanic.id,
      );
      if (page) pageSlugByMechanicId.set(mechanic.id, page.slug);
    }
  }

  for (const { item, value } of activeRows) {
    const productId = item.product_inventory_id!;
    const mechanic = item.promotionMechanic;

    const promotion: ProductActivePromotion = {
      mechanic_id: mechanic.id,
      name: mechanic.name,
      badge_text: formatPromotionBadgeText(value, item, mechanic, lang),
      value:
        value.type === 'tiered'
          ? { ...value, tiers: localizeRuleUnitLabels(value.tiers, lang) }
          : value,
      page_slug: pageSlugByMechanicId.get(mechanic.id) ?? null,
      start_date: new Date(mechanic.start_date).toISOString(),
      end_date: new Date(mechanic.end_date).toISOString(),
    };

    const list = result.get(productId) ?? [];
    list.push(promotion);
    result.set(productId, list);
  }

  return result;
}

/** The mechanic that owns a SKU's price, as the admin product read reports it. */
export type MechanicOwner = { mechanic_id: string; mechanic_name: string };

/**
 * Which promotion mechanic owns each SKU's price — the resolver's own test: the SKU has ANY
 * `promotion_mechanic_sku_items` row, active or not, inside its window or not (a SKU assigned to
 * a mechanic never falls back to undated product-level rules, see `resolveSkuPrice`). When several
 * mechanics hold the SKU, the one running now wins, else the newest `start_date`.
 */
export async function loadMechanicOwnersByProductIds(
  dataSource: DataSource,
  productInventoryIds: string[],
  at: Date = new Date(),
): Promise<Map<string, MechanicOwner>> {
  const owners = new Map<string, MechanicOwner>();
  const ids = [...new Set(productInventoryIds.filter(Boolean))];
  if (ids.length === 0) return owners;

  const items = await dataSource
    .getRepository(PromotionMechanicSkuItem)
    .createQueryBuilder('item')
    .innerJoinAndSelect('item.promotionMechanic', 'mechanic')
    .where('item.product_inventory_id IN (:...ids)', { ids })
    .orderBy('mechanic.start_date', 'DESC')
    .getMany();

  const runningNow = new Set<string>();
  for (const item of items) {
    const productId = item.product_inventory_id;
    if (!productId) continue;
    const mechanic = item.promotionMechanic;
    const running =
      mechanic.is_active &&
      isActiveDateRange(mechanic.start_date, mechanic.end_date, at);
    // first row per SKU = newest; a running mechanic replaces a non-running one, never the reverse
    if (owners.has(productId) && !(running && !runningNow.has(productId))) continue;
    owners.set(productId, { mechanic_id: mechanic.id, mechanic_name: mechanic.name });
    if (running) runningNow.add(productId);
  }
  return owners;
}
