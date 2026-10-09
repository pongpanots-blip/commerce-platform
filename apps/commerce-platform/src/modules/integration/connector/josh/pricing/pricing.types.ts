export type PromotionQuantityRuleRow = {
  min_qty: number;
  max_qty?: number;
  promotion_price: number;
  unit_label?: string;
  badge_text?: string;
};

/** Josh currentLinePricing stores the resolved (or approximate order) UNIT price at two decimals. */
export function roundOrderUnitPrice(price: number): number {
  return Math.round(price * 100) / 100;
}

/** @deprecated use PromotionQuantityRuleRow */
export type PriceTier = {
  min_qty: number;
  max_qty?: number;
  price: number;
  unit_label?: string;
};

export function parsePromotionQuantityRules(
  raw: unknown,
): PromotionQuantityRuleRow[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((row): PromotionQuantityRuleRow | null => {
      if (!row || typeof row !== 'object') return null;
      const item = row as Record<string, unknown>;
      const minQty = Number(item.min_qty ?? item.minQty ?? item.quantity ?? 0);
      const promotionPrice = Number(
        item.promotion_price ?? item.promotionPrice ?? item.price ?? item.unit_price ?? 0,
      );
      const maxQtyRaw = item.max_qty ?? item.maxQty;
      const maxQty =
        maxQtyRaw != null && maxQtyRaw !== '' ? Number(maxQtyRaw) : undefined;
      if (!minQty || Number.isNaN(promotionPrice)) return null;

      const rule: PromotionQuantityRuleRow = {
        min_qty: minQty,
        promotion_price: promotionPrice,
      };
      if (maxQty != null && !Number.isNaN(maxQty)) {
        rule.max_qty = maxQty;
      }
      if (typeof item.unit_label === 'string') {
        rule.unit_label = item.unit_label;
      }
      if (typeof item.badge_text === 'string') {
        rule.badge_text = item.badge_text;
      }
      return rule;
    })
    .filter((row): row is PromotionQuantityRuleRow => row !== null)
    .sort((a, b) => a.min_qty - b.min_qty);
}

/** @deprecated use parsePromotionQuantityRules */
export function parsePriceTiers(raw: unknown): PriceTier[] {
  return parsePromotionQuantityRules(raw).map((rule) => ({
    min_qty: rule.min_qty,
    max_qty: rule.max_qty,
    price: rule.promotion_price,
    unit_label: rule.unit_label,
  }));
}

export function resolvePromotionPrice(
  rules: PromotionQuantityRuleRow[],
  quantity: number,
  fallbackPrice: number,
): number {
  if (!rules.length) return fallbackPrice;

  const sorted = [...rules].sort((a, b) => a.min_qty - b.min_qty);

  for (const rule of sorted) {
    if (rule.max_qty == null) continue;
    if (quantity >= rule.min_qty && quantity <= rule.max_qty) {
      return rule.promotion_price;
    }
  }

  let matched = fallbackPrice;
  for (const rule of sorted) {
    if (rule.max_qty != null) continue;
    if (quantity >= rule.min_qty) matched = rule.promotion_price;
  }
  return matched;
}

/** @deprecated use resolvePromotionPrice */
export function resolveTierPrice(
  tiers: PriceTier[],
  quantity: number,
  fallbackPrice: number,
): number {
  return resolvePromotionPrice(
    tiers.map((tier) => ({
      min_qty: tier.min_qty,
      max_qty: tier.max_qty,
      promotion_price: tier.price,
      unit_label: tier.unit_label,
    })),
    quantity,
    fallbackPrice,
  );
}

export function buildDefaultPromotionRuleFromPrice(
  sellingPrice: number,
  unitLabel?: string,
): PromotionQuantityRuleRow[] {
  if (!sellingPrice || sellingPrice <= 0) return [];

  const rule: PromotionQuantityRuleRow = {
    min_qty: 1,
    promotion_price: sellingPrice,
  };
  if (unitLabel) rule.unit_label = unitLabel;
  return [rule];
}

/** @deprecated */
export function buildDefaultTierFromPrice(
  sellingPrice: number,
  unitLabel?: string,
): PriceTier[] {
  return buildDefaultPromotionRuleFromPrice(sellingPrice, unitLabel).map(
    (rule) => ({
      min_qty: rule.min_qty,
      price: rule.promotion_price,
      unit_label: rule.unit_label,
    }),
  );
}

export function firstPromotionPrice(
  rules: PromotionQuantityRuleRow[],
  fallback = 0,
): number {
  if (!rules.length) return fallback;
  return Number(rules[0].promotion_price);
}

/** @deprecated use firstPromotionPrice */
export function firstTierPrice(tiers: PriceTier[], fallback = 0): number {
  return firstPromotionPrice(
    tiers.map((tier) => ({
      min_qty: tier.min_qty,
      promotion_price: tier.price,
      unit_label: tier.unit_label,
    })),
    fallback,
  );
}

export function parsePromotionRulesFromDto(raw: unknown): PromotionQuantityRuleRow[] {
  if (raw == null || raw === '') return [];

  if (typeof raw === 'string') {
    try {
      return parsePromotionQuantityRules(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  return parsePromotionQuantityRules(raw);
}

/** @deprecated use parsePromotionRulesFromDto */
export function parseTierPricesFromDto(raw: unknown): PriceTier[] {
  return parsePromotionRulesFromDto(raw).map((rule) => ({
    min_qty: rule.min_qty,
    max_qty: rule.max_qty,
    price: rule.promotion_price,
    unit_label: rule.unit_label,
  }));
}
