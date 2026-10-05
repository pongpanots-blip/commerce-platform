// Copied from josh apps/backend/src/shared/{helpers,types} (origin/main d84d692b). Only imports changed:
// josh entities → slim copies in ./josh-pricing-tables, date helper → ../jagota/date-only.helper.
import { DataSource, In } from 'typeorm';
import { BranchContractPrice, PrivatePrice, ProductBranchSpecial, ProductInventory, PromotionQuantityRule } from './josh-pricing-tables';
import { formatGregorianDateOnly, isActiveDateRange } from '../jagota/date-only.helper';
import { loadMechanicPricingByProductIds } from './active-product-promotions.helper';
import { PromotionValue, resolvePromotionValue } from './promotion-value';
import {
  PromotionQuantityRuleRow,
  parsePromotionQuantityRules,
  resolvePromotionPrice,
} from './pricing.types';
/** josh response-cache.helper CATALOG_CACHE_VERSION_KEY (only the cache helpers below use it; commerce never calls them). */
const CATALOG_CACHE_VERSION_KEY = 'catalog:ver';

export { isActiveDateRange } from '../jagota/date-only.helper';

export type PriceSource =
  | 'customer_sku'
  /** @deprecated Kept for stale cart Redis payloads; resolver no longer emits this. */
  | 'branch_special'
  | 'contract_sku'
  | 'promotion'
  | 'promotion_mechanic'
  | 'base';

export type ResolvedSkuPrice = {
  price: number;
  base_price: number;
  source: PriceSource;
  private_price_id?: string;
  contract_price_id?: string;
  /** @deprecated Prefer private_price_id; kept for stale payloads. */
  branch_special_id?: string;
  promotion_id?: string;
  /**
   * Winning `promotion_mechanics.id` — set only when a mechanic priced the SKU
   * (`source: 'promotion_mechanic'`); null for every other source, including the
   * legacy promotion_quantity_rules fallback that has no mechanic. Recorded on
   * order_items for flash-sale caps / per-campaign reporting.
   */
  promotion_mechanic_id: string | null;
  /** Winning row's end_date, normalized to YYYY-MM-DD — only set for
   * `customer_sku` / `contract_sku` / legacy `branch_special` (the sources
   * cart.service.ts's isSpecialPrice treats as special); null for every
   * other source. */
  endDate: string | null;
};

async function loadPromotionQuantityRules(
  dataSource: DataSource,
  productInventoryId: string,
  legacyRules: unknown,
): Promise<PromotionQuantityRuleRow[]> {
  const rows = await dataSource.getRepository(PromotionQuantityRule).find({
    where: { product_inventory_id: productInventoryId, is_active: true },
    order: { sort_order: 'ASC', min_qty: 'ASC' },
  });

  if (rows.length > 0) {
    return rows.map((row) => ({
      min_qty: row.min_qty,
      max_qty: row.max_qty ?? undefined,
      promotion_price: Number(row.promotion_price),
      unit_label: row.unit_label ?? undefined,
      badge_text: row.badge_text ?? undefined,
    }));
  }

  return parsePromotionQuantityRules(legacyRules);
}

/**
 * Unit price from an active SKU mechanic PromotionValue.
 * - tiered → finalPrice from resolvePromotionValue
 * - percentage / bogo / fixed → (base*qty - discountAmount) / qty
 */
function unitPriceFromPromotionValue(
  value: PromotionValue,
  basePrice: number,
  quantity: number,
): number | null {
  const resolved = resolvePromotionValue(value, { basePrice, quantity });
  if (resolved.finalPrice != null) {
    return resolved.finalPrice;
  }
  if (resolved.discountAmount == null) {
    return null;
  }
  if (quantity <= 0) {
    return basePrice;
  }
  return (basePrice * quantity - resolved.discountAmount) / quantity;
}

async function findActivePrivatePrice(
  dataSource: DataSource,
  companyId: string,
  productInventoryId: string,
  at: Date,
): Promise<PrivatePrice | null> {
  const privatePrices = await dataSource
    .getRepository(PrivatePrice)
    .createQueryBuilder('pp')
    .where('pp.company_id = :companyId', { companyId })
    .andWhere('pp.product_inventory_id = :productInventoryId', {
      productInventoryId,
    })
    .orderBy('pp.start_date', 'DESC')
    .getMany();

  return (
    privatePrices.find((row) =>
      isActiveDateRange(row.start_date, row.end_date, at),
    ) ?? null
  );
}

type SkuPriceCacheRedis = {
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    options?: { EX?: number },
  ) => Promise<unknown>;
  incr: (key: string) => Promise<unknown>;
};

/**
 * Short-lived cache for resolveSkuPrice (the 7-layer hierarchy is several
 * queries per call, run on every cart add/update). Keyed by a per-inventory
 * VERSION counter so a price write invalidates every (branch, company, qty)
 * combination at once without pattern scans — bump the version, old entries
 * age out via TTL. The 60s TTL is the backstop for writes that don't bump
 * (e.g. a promotion window opening).
 */
const SKU_PRICE_CACHE_TTL_SEC = 60;
// Key version is v3: v2 entries stored under an empty company were computed with a company
// derived from the branch — do not let them be served now that a company is never derived.


/**
 * Global price version, part of every price cache key. Bumped by writes whose
 * affected SKUs aren't cheap to enumerate (private / contract / branch special
 * price, promotion quantity rules — incl. bulk delete + CSV import) so
 * customer-specific prices are visible immediately, not after the TTL.
 */
const GLOBAL_PRICE_VERSION_KEY = 'price:ver:all';

/**
 * Call after any customer-specific price write (private_price,
 * branch_contract_price, product_branch_specials, promotion_quantity_rules).
 * Also stales whole-response caches (PDP / carousel) that embed prices.
 */
export async function invalidateAllSkuPriceCaches(
  redisClient: { incr?: (key: string) => Promise<unknown> } | null | undefined,
): Promise<void> {
  if (!redisClient?.incr) return;
  try {
    await Promise.all([
      redisClient.incr(GLOBAL_PRICE_VERSION_KEY),
      redisClient.incr(CATALOG_CACHE_VERSION_KEY),
    ]);
  } catch {
    // Best-effort; TTL is the backstop.
  }
}

function skuPriceVersionKey(productInventoryId: string): string {
  return `price:ver:${productInventoryId.toLowerCase()}`;
}

/**
 * Call after any write that changes what resolveSkuPrice returns for the SKU
 * (catalog price, private/contract price, tier rows). INCR — never DEL — so a
 * later write can't resurrect entries cached under an old version.
 */
export async function invalidateSkuPriceCache(
  redisClient: Pick<SkuPriceCacheRedis, 'incr'> | null | undefined,
  productInventoryIds: string | string[],
): Promise<void> {
  if (!redisClient?.incr) return;
  const ids = (
    Array.isArray(productInventoryIds)
      ? productInventoryIds
      : [productInventoryIds]
  ).filter(Boolean);
  try {
    await Promise.all(
      ids.map((id) => redisClient.incr(skuPriceVersionKey(id))),
    );
  } catch {
    // Best-effort; TTL is the backstop.
  }
}

/** resolveSkuPrice with the version-keyed cache; falls back on any Redis error. */
export async function resolveSkuPriceCached(
  dataSource: DataSource,
  redisClient: SkuPriceCacheRedis | null | undefined,
  options: Parameters<typeof resolveSkuPrice>[1],
): Promise<ResolvedSkuPrice> {
  // Historical lookups (`at`) must not share entries with "now".
  if (!redisClient?.get || options.at) {
    return resolveSkuPrice(dataSource, options);
  }
  const inv = String(options.productInventoryId).toLowerCase();
  let key: string | null = null;
  try {
    const [ver, gver] = await Promise.all([
      redisClient.get(skuPriceVersionKey(inv)),
      redisClient.get(GLOBAL_PRICE_VERSION_KEY),
    ]);
    key = `price:resolve:v3:${gver ?? '0'}:${inv}:${ver ?? '0'}:${options.companyId ?? ''}:${options.branchId ?? ''}:${options.quantity ?? 1}`;
    const cached = await redisClient.get(key);
    if (cached) return JSON.parse(cached) as ResolvedSkuPrice;
  } catch {
    key = null;
  }
  const resolved = await resolveSkuPrice(dataSource, options);
  if (key) {
    try {
      await redisClient.set(key, JSON.stringify(resolved), {
        EX: SKU_PRICE_CACHE_TTL_SEC,
      });
    } catch {
      // Best-effort cache write.
    }
  }
  return resolved;
}

/**
 * resolveSkuPricesBatch with the same version-keyed cache as
 * resolveSkuPriceCached: the key embeds every SKU's `price:ver` counter, so a
 * price write on ANY SKU in the page invalidates the whole entry. Listing
 * pages repeat the same 12-SKU set per (company, branch), so the hit rate is
 * high. Bypasses for `at` / `quantityById` / `promotionRulesByProduct`
 * (cart-shaped calls stay fresh).
 */
export async function resolveSkuPricesBatchCached(
  dataSource: DataSource,
  redisClient: SkuPriceCacheRedis | null | undefined,
  options: Parameters<typeof resolveSkuPricesBatch>[1],
): Promise<Map<string, ResolvedSkuPrice>> {
  if (
    !redisClient?.get ||
    options.at ||
    options.quantityById ||
    options.promotionRulesByProduct
  ) {
    return resolveSkuPricesBatch(dataSource, options);
  }
  const ids = [
    ...new Set(
      options.productInventoryIds.filter(Boolean).map((id) => id.toLowerCase()),
    ),
  ].sort();
  if (ids.length === 0) return new Map();

  let key: string | null = null;
  try {
    // node-redis pipelines same-tick commands — N GETs = 1 round trip.
    const [gver, ...vers] = await Promise.all([
      redisClient.get(GLOBAL_PRICE_VERSION_KEY),
      ...ids.map((id) => redisClient.get(skuPriceVersionKey(id))),
    ]);
    key =
      `price:batch:v3:${gver ?? '0'}:${options.companyId ?? ''}:${options.branchId ?? ''}:` +
      `${options.quantity ?? 1}:` +
      ids.map((id, i) => `${id}.${vers[i] ?? '0'}`).join(',');
    const cached = await redisClient.get(key);
    if (cached) {
      return new Map(
        Object.entries(JSON.parse(cached) as Record<string, ResolvedSkuPrice>),
      );
    }
  } catch {
    key = null;
  }

  const result = await resolveSkuPricesBatch(dataSource, options);
  if (key) {
    try {
      await redisClient.set(key, JSON.stringify(Object.fromEntries(result)), {
        EX: SKU_PRICE_CACHE_TTL_SEC,
      });
    } catch {
      // Best-effort cache write.
    }
  }
  return result;
}

export async function resolveSkuPrice(
  dataSource: DataSource,
  options: {
    productInventoryId: string;
    branchId?: string | null;
    /**
     * Enables Customer SKU / private_price — and only when the caller passes it.
     * It is NEVER derived from `branchId`: a branch id is easy to send from a client,
     * and deriving a company from it handed one company's private prices to anyone who
     * named that company's branch. Callers take the company from
     * `pricing-scope.helper` (the authenticated user's own) or, on admin-guarded
     * routes, from the customer being acted for. `null` / absent = no company pricing.
     */
    companyId?: string | null;
    quantity?: number;
    at?: Date;
  },
): Promise<ResolvedSkuPrice> {
  const at = options.at ?? new Date();
  const quantity = options.quantity ?? 1;

  const inventory = await dataSource.getRepository(ProductInventory).findOne({
    where: { product_inventory_id: options.productInventoryId },
    select: ['product_inventory_id', 'selling_unit_price'],
  });

  const basePrice = Number(inventory?.selling_unit_price ?? 0);

  const companyId = options.companyId ?? null;

  if (companyId) {
    const activePrivate = await findActivePrivatePrice(
      dataSource,
      companyId,
      options.productInventoryId,
      at,
    );

    if (activePrivate) {
      return {
        price: Number(activePrivate.private_selling_price),
        base_price: basePrice,
        source: 'customer_sku',
        private_price_id: activePrivate.id,
        promotion_mechanic_id: null,
        endDate: formatGregorianDateOnly(activePrivate.end_date),
      };
    }
  }

  if (options.branchId) {
    const contracts = await dataSource
      .getRepository(BranchContractPrice)
      .createQueryBuilder('cp')
      .where('cp.branch_id = :branchId', { branchId: options.branchId })
      .andWhere('cp.product_inventory_id = :productInventoryId', {
        productInventoryId: options.productInventoryId,
      })
      .orderBy('cp.start_date', 'DESC')
      .getMany();

    const activeContract = contracts.find((row) =>
      isActiveDateRange(row.start_date, row.end_date, at),
    );

    if (activeContract) {
      return {
        price: Number(activeContract.contract_price),
        base_price: basePrice,
        source: 'contract_sku',
        contract_price_id: activeContract.id,
        promotion_mechanic_id: null,
        endDate: formatGregorianDateOnly(activeContract.end_date),
      };
    }

    const promotions = await dataSource
      .getRepository(ProductBranchSpecial)
      .createQueryBuilder('pbs')
      .where('pbs.branch_id = :branchId', { branchId: options.branchId })
      .andWhere('pbs.product_inventory_id = :productInventoryId', {
        productInventoryId: options.productInventoryId,
      })
      .andWhere('pbs.is_active = true')
      .orderBy('pbs.start_date', 'DESC')
      .getMany();

    const activePromotion = promotions.find((row) =>
      isActiveDateRange(row.start_date, row.end_date, at),
    );

    if (activePromotion) {
      return {
        price: Number(activePromotion.special_price),
        base_price: basePrice,
        source: 'promotion',
        promotion_id: activePromotion.id,
        promotion_mechanic_id: null,
        endDate: null,
      };
    }
  }

  // `companyId` (as given — never derived from a branch here) also decides which targeted mechanics apply.
  const mechanicPromotions = await loadMechanicPricingByProductIds(
    dataSource,
    [options.productInventoryId],
    companyId,
    at,
  );
  if (mechanicPromotions.has(options.productInventoryId)) {
    const mechanic = mechanicPromotions.get(options.productInventoryId);
    if (mechanic?.value) {
      const unitPrice = unitPriceFromPromotionValue(
        mechanic.value,
        basePrice,
        quantity,
      );
      if (unitPrice != null) {
        return {
          price: unitPrice,
          base_price: basePrice,
          source: 'promotion_mechanic',
          promotion_mechanic_id: mechanic.mechanicId,
          endDate: null,
        };
      }
    }

    // Mechanic quantity rules are campaign-dated. Never fall through to their
    // undated promotion_quantity_rules mirror after a campaign expires.
    return {
      price: basePrice,
      base_price: basePrice,
      source: 'base',
      promotion_mechanic_id: null,
      endDate: null,
    };
  }

  const rules = await loadPromotionQuantityRules(
    dataSource,
    options.productInventoryId,
    null,
  );

  if (rules.length > 0) {
    const promotionPrice = resolvePromotionPrice(rules, quantity, basePrice);
    return {
      price: promotionPrice,
      base_price: basePrice,
      source: 'promotion_mechanic',
      // legacy promotion_quantity_rules row — no mechanic behind it
      promotion_mechanic_id: null,
      endDate: null,
    };
  }

  return {
    price: basePrice,
    base_price: basePrice,
    source: 'base',
    promotion_mechanic_id: null,
    endDate: null,
  };
}

function applyActiveRows<
  T extends {
    product_inventory_id: string;
    start_date?: Date | string | null;
    end_date?: Date | string | null;
  },
>(
  rows: T[],
  at: Date,
  result: Map<string, ResolvedSkuPrice>,
  toResolved: (row: T, basePrice: number) => ResolvedSkuPrice,
  basePriceById: Map<string, number>,
): void {
  const seen = new Set<string>();

  for (const row of rows) {
    const productId = row.product_inventory_id;
    if (seen.has(productId) || result.get(productId)?.source !== 'base') {
      continue;
    }
    if (!isActiveDateRange(row.start_date, row.end_date, at)) {
      continue;
    }

    seen.add(productId);
    const basePrice = basePriceById.get(productId) ?? 0;
    result.set(productId, toResolved(row, basePrice));
  }
}

export async function resolveSkuPricesBatch(
  dataSource: DataSource,
  options: {
    productInventoryIds: string[];
    branchId?: string | null;
    /** Same contract as `resolveSkuPrice`: only the company the caller passes — never derived from `branchId`. */
    companyId?: string | null;
    quantity?: number;
    /**
     * จำนวนรายตัว SKU — ใช้กับตะกร้าที่แต่ละบรรทัดมีจำนวนไม่เท่ากัน
     *
     * จำนวนมีผลเฉพาะขั้น promotion mechanic / quantity rule (ราคาขั้นบันได)
     * งาน query ทั้งหมดไม่ขึ้นกับจำนวน จึงยิงรวดเดียวได้แล้วค่อยคิดราคาตาม
     * จำนวนของแต่ละบรรทัดในหน่วยความจำ — ไม่ต้องแยก batch ตามจำนวน
     *
     * ไม่ส่งมา (หรือไม่มี key นั้น) → ใช้ `quantity`
     */
    quantityById?: Map<string, number>;
    at?: Date;
    promotionRulesByProduct?: Map<string, PromotionQuantityRuleRow[]>;
  },
): Promise<Map<string, ResolvedSkuPrice>> {
  const uniqueIds = [...new Set(options.productInventoryIds.filter(Boolean))];
  const result = new Map<string, ResolvedSkuPrice>();
  if (uniqueIds.length === 0) return result;

  const at = options.at ?? new Date();
  const quantity = options.quantity ?? 1;

  const inventories = await dataSource.getRepository(ProductInventory).find({
    where: { product_inventory_id: In(uniqueIds) },
    select: ['product_inventory_id', 'selling_unit_price'],
  });

  const basePriceById = new Map<string, number>();
  for (const inventory of inventories) {
    basePriceById.set(
      inventory.product_inventory_id,
      Number(inventory.selling_unit_price ?? 0),
    );
  }

  for (const id of uniqueIds) {
    const basePrice = basePriceById.get(id) ?? 0;
    result.set(id, {
      price: basePrice,
      base_price: basePrice,
      source: 'base',
      promotion_mechanic_id: null,
      endDate: null,
    });
  }

  const companyId = options.companyId ?? null;

  if (companyId) {
    const privatePrices = await dataSource.getRepository(PrivatePrice).find({
      where: {
        company_id: companyId,
        product_inventory_id: In(uniqueIds),
      },
      order: { start_date: 'DESC' },
    });

    applyActiveRows(
      privatePrices,
      at,
      result,
      (row, basePrice) => ({
        price: Number(row.private_selling_price),
        base_price: basePrice,
        source: 'customer_sku',
        private_price_id: row.id,
        promotion_mechanic_id: null,
        endDate: formatGregorianDateOnly(row.end_date),
      }),
      basePriceById,
    );
  }

  if (options.branchId) {
    const branchId = options.branchId;
    const [contracts, promotions] = await Promise.all([
      dataSource.getRepository(BranchContractPrice).find({
        where: { branch_id: branchId, product_inventory_id: In(uniqueIds) },
        order: { start_date: 'DESC' },
      }),
      dataSource.getRepository(ProductBranchSpecial).find({
        where: {
          branch_id: branchId,
          product_inventory_id: In(uniqueIds),
          is_active: true,
        },
        order: { start_date: 'DESC' },
      }),
    ]);

    // customer_sku already applied; only fill still-`base` slots.
    applyActiveRows(
      contracts,
      at,
      result,
      (row, basePrice) => ({
        price: Number(row.contract_price),
        base_price: basePrice,
        source: 'contract_sku',
        contract_price_id: row.id,
        promotion_mechanic_id: null,
        endDate: formatGregorianDateOnly(row.end_date),
      }),
      basePriceById,
    );

    applyActiveRows(
      promotions,
      at,
      result,
      (row, basePrice) => ({
        price: Number(row.special_price),
        base_price: basePrice,
        source: 'promotion',
        promotion_id: row.id,
        promotion_mechanic_id: null,
        endDate: null,
      }),
      basePriceById,
    );
  }

  const mechanicValues = await loadMechanicPricingByProductIds(
    dataSource,
    uniqueIds,
    companyId,
    at,
  );
  for (const id of uniqueIds) {
    if (result.get(id)?.source !== 'base') continue;
    if (!mechanicValues.has(id)) continue;
    const mechanic = mechanicValues.get(id);
    if (!mechanic?.value) continue;
    const basePrice = basePriceById.get(id) ?? 0;
    const unitPrice = unitPriceFromPromotionValue(
      mechanic.value,
      basePrice,
      options.quantityById?.get(id) ?? quantity,
    );
    if (unitPrice == null) continue;
    result.set(id, {
      price: unitPrice,
      base_price: basePrice,
      source: 'promotion_mechanic',
      promotion_mechanic_id: mechanic.mechanicId,
      endDate: null,
    });
  }

  let rulesByProduct = options.promotionRulesByProduct;
  if (!rulesByProduct) {
    rulesByProduct = new Map<string, PromotionQuantityRuleRow[]>();
    for (const id of uniqueIds) {
      rulesByProduct.set(id, []);
    }

    const fallbackIds = uniqueIds.filter((id) => !mechanicValues.has(id));
    if (fallbackIds.length > 0) {
      const rows = await dataSource.getRepository(PromotionQuantityRule).find({
        where: { product_inventory_id: In(fallbackIds), is_active: true },
        order: { sort_order: 'ASC', min_qty: 'ASC' },
      });

      const grouped = new Map<string, PromotionQuantityRule[]>();
      for (const row of rows) {
        const list = grouped.get(row.product_inventory_id) ?? [];
        list.push(row);
        grouped.set(row.product_inventory_id, list);
      }

      for (const [productId, productRows] of grouped) {
        rulesByProduct.set(
          productId,
          productRows.map((row) => ({
            min_qty: row.min_qty,
            max_qty: row.max_qty ?? undefined,
            promotion_price: Number(row.promotion_price),
            unit_label: row.unit_label ?? undefined,
            badge_text: row.badge_text ?? undefined,
          })),
        );
      }
    }
  }

  for (const id of uniqueIds) {
    if (result.get(id)?.source !== 'base') continue;
    if (mechanicValues.has(id)) continue;

    const rules = rulesByProduct.get(id) ?? [];
    if (rules.length === 0) continue;

    const basePrice = basePriceById.get(id) ?? 0;
    result.set(id, {
      price: resolvePromotionPrice(
        rules,
        options.quantityById?.get(id) ?? quantity,
        basePrice,
      ),
      base_price: basePrice,
      source: 'promotion_mechanic',
      // legacy promotion_quantity_rules row — no mechanic behind it
      promotion_mechanic_id: null,
      endDate: null,
    });
  }

  return result;
}
