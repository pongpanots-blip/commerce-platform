import { uiText as __uiText } from '@cp/ui';
import type { CouponDiscountScope, CouponProductSetSnapshot } from '@josh/shared-api';
import type { CouponSkuMinimumRow } from './coupon-redemption.constants';
import {
  COUPON_PAYMENT_METHOD_OPTIONS,
  paymentMethodLabel,
} from './coupon-redemption.constants';

export type CouponProductPick = {
  variantId: string;
  sku: string;
  name: string;
};

export type CouponRedemptionForm = {
  minCartAmount: string;
  /** สิ่งที่ยอดขั้นต่ำเทียบด้วย — 'cart' (default) = ทั้งตะกร้า (ไม่รวมสินค้าที่ยกเว้น);
   * 'eligible_items' = เฉพาะยอดก่อน VAT ของสินค้าที่เข้าเงื่อนไข */
  minSpendBasis: 'cart' | 'eligible_items';
  includeProductSetIds: string[];
  excludeProductSetIds: string[];
  /** @deprecated legacy category picker — kept for backward compat, no longer rendered */
  includeCategoryIds: string[];
  /** @deprecated legacy SKU picker — kept for backward compat, no longer rendered */
  includeProducts: CouponProductPick[];
  /** @deprecated legacy category picker — kept for backward compat, no longer rendered */
  excludeCategoryIds: string[];
  /** @deprecated legacy SKU picker — kept for backward compat, no longer rendered */
  excludeProducts: CouponProductPick[];
  skuMinimums: CouponSkuMinimumRow[];
  restrictPaymentMethods: boolean;
  allowedPaymentMethods: string[];
  /** Read-only — server-owned SKU snapshot per referenced Promotion Product Set, keyed by
   * set id. Never sent back on save; the server ignores/recomputes it (see
   * `upsertCouponRedemptionRules`'s `refreshProductSetIds`). */
  productSetSnapshots: Record<string, CouponProductSetSnapshot>;
  /** Which snapshot ids to re-take from the live set on next save — admin's pending choice,
   * reset to [] after every successful save. */
  refreshProductSetIds: string[];
  /** Read-only — coupon's saved rules had a min_eligible_subtotal different from
   * min_cart_subtotal (the old "แยกยอดขั้นต่ำ" control). Informational only;
   * redemptionFormToRules always normalises min_eligible_subtotal = min_cart_subtotal. */
  legacyMinEligible: number | null;
};

/** discount_scope 'all' ไม่มีสินค้า "เข้าเงื่อนไข" ให้แยกนับ — บังคับนับทั้งตะกร้าเสมอ */
export function effectiveMinSpendBasis(
  form: Pick<CouponRedemptionForm, 'minSpendBasis'>,
  discountScope: CouponDiscountScope,
): CouponRedemptionForm['minSpendBasis'] {
  return discountScope === 'all' ? 'cart' : form.minSpendBasis;
}

export const EMPTY_COUPON_REDEMPTION_FORM: CouponRedemptionForm = {
  minCartAmount: '0',
  minSpendBasis: 'cart',
  includeProductSetIds: [],
  excludeProductSetIds: [],
  includeCategoryIds: [],
  includeProducts: [],
  excludeCategoryIds: [],
  excludeProducts: [],
  skuMinimums: [],
  restrictPaymentMethods: false,
  allowedPaymentMethods: [],
  legacyMinEligible: null,
  productSetSnapshots: {},
  refreshProductSetIds: [],
};

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function productPicksFromIds(
  ids: string[],
  existing: CouponProductPick[] = [],
): CouponProductPick[] {
  const byId = new Map(existing.map((item) => [item.variantId, item]));
  return ids.map((variantId) => {
    const found = byId.get(variantId);
    if (found) return found;
    return {
      variantId,
      sku: variantId.slice(0, 8),
      name: `SKU / ID ${variantId.slice(0, 8)}…`,
    };
  });
}

/** ปาร์ส product_set_snapshots แบบระวังตัว — ข้อมูลมาจาก server แต่ก็อาจเป็นคูปองเก่าที่ยังไม่มีฟิลด์นี้
 * หรือ shape เพี้ยนได้ ไม่ให้หน้าแตกไม่ว่า input จะเป็นอะไร */
function readProductSetSnapshots(
  value: unknown,
): Record<string, CouponProductSetSnapshot> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, CouponProductSetSnapshot> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!id || !raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    const items = Array.isArray(record.items)
      ? record.items
          .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const row = item as Record<string, unknown>;
            const productInventoryId = String(row.product_inventory_id ?? '');
            // sku may legitimately be '' (server-side data gap) — the id is what identifies
            // the row; display falls back to the id when sku is blank, never drop the row over it.
            const sku = String(row.sku ?? '');
            return productInventoryId ? { product_inventory_id: productInventoryId, sku } : null;
          })
          .filter((item): item is { product_inventory_id: string; sku: string } => item != null)
      : [];
    out[id] = {
      name: typeof record.name === 'string' ? record.name : '',
      set_updated_at: typeof record.set_updated_at === 'string' ? record.set_updated_at : null,
      snapshotted_at: typeof record.snapshotted_at === 'string' ? record.snapshotted_at : '',
      items,
    };
  }
  return out;
}

export function redemptionFormFromRules(
  rules: Record<string, unknown> = {},
  // Mirrors the backend's own fallback (coupon-redemption.service.ts's cart-apply path:
  // `rules.min_cart_subtotal ?? Number(couponEntity.minimum_order_amount ?? 0)`) — a coupon
  // with no redemption-rules row at all (rules === {}) is still enforcing this minimum for
  // real; loading the form as 0 and saving it back would silently wipe that minimum to 0.
  minimumOrderAmountFallback = 0,
): CouponRedemptionForm {
  const minCart = Number(rules.min_cart_subtotal ?? minimumOrderAmountFallback ?? 0);
  const scope = (rules.eligible_scope ?? {}) as Record<string, unknown>;
  const exclude = (rules.exclude ?? {}) as Record<string, unknown>;
  const paymentMethods = (rules.payment_methods ?? {}) as Record<string, unknown>;
  const skuMinimumsRaw = Array.isArray(rules.sku_minimums)
    ? rules.sku_minimums
    : [];

  const includeCategoryIds = readStringArray(scope.category_ids);
  const includeProductIds = readStringArray(scope.product_inventory_ids);
  const includeProductSetIds = readStringArray(scope.product_set_ids);
  const excludeCategoryIds = readStringArray(exclude.category_ids);
  const excludeProductIds = readStringArray(exclude.product_inventory_ids);
  const excludeProductSetIds = readStringArray(exclude.product_set_ids);

  const allowedPaymentMethods = readStringArray(paymentMethods.allowed_methods);

  const rawMinEligible = rules.min_eligible_subtotal;
  const legacyMinEligible =
    rawMinEligible != null && Number(rawMinEligible) !== minCart
      ? Number(rawMinEligible)
      : null;

  return {
    minCartAmount: String(minCart || 0),
    minSpendBasis: rules.min_spend_basis === 'eligible_items' ? 'eligible_items' : 'cart',
    legacyMinEligible,
    includeProductSetIds,
    excludeProductSetIds,
    includeCategoryIds,
    includeProducts: productPicksFromIds(includeProductIds),
    excludeCategoryIds,
    excludeProducts: productPicksFromIds(excludeProductIds),
    skuMinimums: skuMinimumsRaw.map((row, index) => {
      const record = row as Record<string, unknown>;
      const variantId = String(record.product_inventory_id ?? '');
      const sku = String(record.sku ?? variantId.slice(0, 8));
      return {
        rowId: `sku-min-${index}-${variantId}`,
        product: {
          variantId,
          sku,
          name: sku,
        },
        minSubtotal: String(record.min_subtotal ?? '0'),
        minQuantity:
          record.min_quantity != null ? String(record.min_quantity) : '',
      };
    }),
    restrictPaymentMethods: allowedPaymentMethods.length > 0,
    allowedPaymentMethods,
    productSetSnapshots: readProductSetSnapshots(rules.product_set_snapshots),
    // Pending admin choice, never persisted — always starts empty on (re)load.
    refreshProductSetIds: [],
  };
}

/**
 * ไม่ส่ง product_set_snapshots กลับไปที่ server — server เป็นเจ้าของฟิลด์นี้ทั้งหมด (snapshot ชุดใหม่
 * ที่อ้างถึงเอง, คง snapshot เดิมไว้, re-snapshot เฉพาะ id ใน refresh_product_set_ids ที่ส่งแยกไปกับ
 * upsertCouponRedemptionRules) ส่งอะไรไปก็ถูก server เมิน แต่ไม่ส่งเลยชัดเจนกว่าว่าฟอร์มนี้ไม่ได้แก้ไขมัน
 */
export function redemptionFormToRules(
  form: CouponRedemptionForm,
  discountScope: CouponDiscountScope,
): Record<string, unknown> {
  const minCart = Number(form.minCartAmount) || 0;

  // discount_scope (coupon payload) is the single source of truth for the mode — 'all'
  // always saves as unrestricted, even if a Promotion Product Set is still selected.
  const hasInclude = discountScope !== 'all';

  const sku_minimums = form.skuMinimums
    .filter((row) => row.product.variantId)
    .map((row) => {
      const min_subtotal = Number(row.minSubtotal) || 0;
      const min_quantity = row.minQuantity.trim()
        ? Number(row.minQuantity) || 0
        : null;
      return {
        product_inventory_id: row.product.variantId,
        sku: row.product.sku,
        min_subtotal,
        ...(min_quantity != null && min_quantity > 0 ? { min_quantity } : {}),
      };
    })
    .filter((row) => row.min_subtotal > 0 || row.min_quantity != null);

  return {
    min_cart_subtotal: minCart,
    min_spend_basis: effectiveMinSpendBasis(form, discountScope),
    // Admin form has no separate eligible-minimum control — always equal to min_cart_subtotal
    // (backend invariant for "no separate eligible minimum"; the field itself still exists
    // for coupons whose rules predate this form and haven't been re-saved).
    min_eligible_subtotal: minCart,
    eligible_scope: {
      mode: hasInclude ? 'include' : 'all',
      product_set_ids: hasInclude ? form.includeProductSetIds : [],
      category_ids: hasInclude ? form.includeCategoryIds : [],
      product_inventory_ids: hasInclude
        ? form.includeProducts.map((item) => item.variantId)
        : [],
      cuisine_ids: [],
    },
    exclude: {
      product_set_ids: form.excludeProductSetIds,
      category_ids: form.excludeCategoryIds,
      product_inventory_ids: form.excludeProducts.map((item) => item.variantId),
    },
    sku_minimums,
    payment_methods: {
      allowed_methods: form.restrictPaymentMethods
        ? form.allowedPaymentMethods
        : [],
    },
  };
}

export function validateCouponRedemptionForm(
  form: CouponRedemptionForm,
  discountScope: CouponDiscountScope,
): string | null {
  // Blank/'0' = no minimum (old behaviour: `Number(text) || 0`). Anything else must parse to a
  // finite number >= 0 — a plain text input silently saved e.g. "1,000" as 0 (Number('1,000') is
  // NaN), which looked like "no minimum" was intended when it wasn't.
  const trimmedMinCart = form.minCartAmount.trim();
  if (trimmedMinCart !== '') {
    const parsedMinCart = Number(trimmedMinCart);
    if (!Number.isFinite(parsedMinCart) || parsedMinCart < 0) {
      return 'ยอดขั้นต่ำต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป (0 = ไม่กำหนด)';
    }
  }

  if (
    form.restrictPaymentMethods &&
    form.allowedPaymentMethods.length === 0
  ) {
    return 'กรุณาเลือกช่องทางชำระเงินอย่างน้อย 1 รายการ';
  }

  // Must be an actual Promotion Product Set — legacy includeCategoryIds/includeProducts
  // (old category/SKU pickers) don't satisfy this even if still present on the coupon;
  // they can stay saved alongside a set, they just don't substitute for picking one.
  if (discountScope !== 'all' && form.includeProductSetIds.length === 0) {
    return 'กรุณาเลือก Promotion Product Set ที่ร่วมรายการอย่างน้อย 1 ชุด';
  }

  // No per-row validation here anymore — skuMinimums has no editor UI (§ removed
  // CouponSkuMinimumEditor), only a read-only legacy notice + "ล้าง". Rows with nothing
  // useful are already dropped silently in redemptionFormToRules; erroring here would block
  // saving the rest of the form over legacy data the admin can no longer fix from this page.

  return null;
}

export function describeRedemptionRules(
  form: CouponRedemptionForm,
  discountScope: CouponDiscountScope,
): string {
  const parts: string[] = [];

  const minCart = Number(form.minCartAmount) || 0;
  if (minCart > 0) {
    parts.push(
      effectiveMinSpendBasis(form, discountScope) === 'eligible_items'
        ? __uiText("ยอดสินค้าที่เข้าเงื่อนไข (ก่อน VAT) ขั้นต่ำ {0} บาท",{"0":minCart.toLocaleString()})
        : __uiText("ยอดตะกร้าขั้นต่ำ (ก่อน VAT) {0} บาท",{"0":minCart.toLocaleString()}),
    );
  }

  if (form.skuMinimums.length > 0) {
    parts.push(
      __uiText("เงื่อนไข SKU ขั้นต่ำเดิม {0} รายการ",{"0":form.skuMinimums.length}),
    );
  }

  if (form.restrictPaymentMethods && form.allowedPaymentMethods.length > 0) {
    parts.push(
      __uiText("ชำระผ่าน {0}",{"0":form.allowedPaymentMethods.map(paymentMethodLabel).join(', ')}),
    );
  }

  if (discountScope !== 'all') {
    const includeParts: string[] = [];
    if (form.includeProductSetIds.length > 0) {
      includeParts.push(__uiText("{0} ชุดสินค้า",{"0":form.includeProductSetIds.length}));
    }
    if (form.includeCategoryIds.length > 0) {
      includeParts.push(__uiText("{0} หมวด",{"0":form.includeCategoryIds.length}));
    }
    if (form.includeProducts.length > 0) {
      includeParts.push(`${form.includeProducts.length} SKU`);
    }
    if (includeParts.length > 0) {
      parts.push(__uiText("นับเฉพาะ {0}",{"0":includeParts.join(' + ')}));
    }
  }

  const excludeParts: string[] = [];
  if (form.excludeProductSetIds.length > 0) {
    excludeParts.push(__uiText("ไม่รวม {0} ชุดสินค้า",{"0":form.excludeProductSetIds.length}));
  }
  if (form.excludeCategoryIds.length > 0) {
    excludeParts.push(__uiText("ไม่รวม {0} หมวด",{"0":form.excludeCategoryIds.length}));
  }
  if (form.excludeProducts.length > 0) {
    excludeParts.push(__uiText("ไม่รวม {0} SKU",{"0":form.excludeProducts.length}));
  }
  if (excludeParts.length > 0) {
    parts.push(excludeParts.join(', '));
  }

  if (parts.length === 0) {
    return __uiText("ไม่กำหนดเงื่อนไขพิเศษ");
  }

  return parts.join(' · ');
}

export function parseSkuCsv(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line) => line.split(/[,;\t]/))
    .map((cell) => cell.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

export type ProductSetLiveItem = { productInventoryId: string; sku: string; name: string };

/** เทียบ SKU ระหว่าง snapshot ที่บันทึกไว้กับรายการล่าสุดของ Promotion Product Set —
 * key ด้วย product_inventory_id ใช้ตัดสินว่ามี "added" (อยู่ในล่าสุด แต่ไม่อยู่ใน snapshot)
 * หรือ "removed" (อยู่ใน snapshot แต่หายไปจากล่าสุด) บ้างไหม */
export function diffProductSetItems(
  oldItems: Array<{ product_inventory_id: string; sku: string }>,
  latest: ProductSetLiveItem[],
): { added: ProductSetLiveItem[]; removed: Array<{ product_inventory_id: string; sku: string }> } {
  const oldIds = new Set(oldItems.map((item) => item.product_inventory_id));
  const latestIds = new Set(latest.map((item) => item.productInventoryId));
  return {
    added: latest.filter((item) => !oldIds.has(item.productInventoryId)),
    removed: oldItems.filter((item) => !latestIds.has(item.product_inventory_id)),
  };
}

/** true เมื่อ Promotion Product Set มีการแก้ไข (updated_at) หลังจาก snapshot ถูกบันทึกไว้ —
 * ไม่มีข้อมูลพอจะเทียบ (null/พัง) ถือว่า "เป็นไปได้ว่าเปลี่ยน" (changed-candidate) ให้ caller ไปเช็คต่อ */
export function hasProductSetChanged(
  liveUpdatedAt: string | null | undefined,
  snapshotSetUpdatedAt: string | null | undefined,
): boolean {
  if (!liveUpdatedAt || !snapshotSetUpdatedAt) return true;
  const liveTime = new Date(liveUpdatedAt).getTime();
  const snapshotTime = new Date(snapshotSetUpdatedAt).getTime();
  if (Number.isNaN(liveTime) || Number.isNaN(snapshotTime)) return true;
  return liveTime !== snapshotTime;
}

/** ตัด id ออกจาก refreshProductSetIds ถ้าไม่มี include/exclude ชุดไหนอ้างอิงมันอีกแล้ว — ต้องเช็คทั้งสอง
 * ฝั่งพร้อมกัน เพราะชุดเดียวกันอาจถูกเลือกทั้งใน include และ exclude ในเวลาเดียวกัน เอาออกจากฝั่งหนึ่งไม่ควร
 * ทำให้เลือก refresh ของอีกฝั่งหายไปด้วย */
export function pruneRefreshIds(
  refreshIds: string[],
  includeIds: string[],
  excludeIds: string[],
): string[] {
  const referenced = new Set([...includeIds, ...excludeIds]);
  return refreshIds.filter((id) => referenced.has(id));
}

// Re-export for consumers importing from helpers
export { COUPON_PAYMENT_METHOD_OPTIONS, paymentMethodLabel };

// ui-display-helper-migration: display descriptions; record values and enum keys remain data
