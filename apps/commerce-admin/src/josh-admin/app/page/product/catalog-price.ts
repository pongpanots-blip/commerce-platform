/**
 * Catalog prices for admin screens. Product responses are priced like the shop: a promotion
 * mechanic lowers `selling_unit_price` / `ordering_price`, a customer or contract price nulls
 * `selling_unit_price`. Anything an admin edits, saves back or lists as "the price" must read the
 * `base_*` fields (always the catalog value) — never the shop-priced ones.
 */
type PricedProduct = {
  base_selling_price?: number | string | null;
  selling_unit_price?: number | string | null;
  base_ordering_price?: number | string | null;
  ordering_price?: number | string | null;
};

/** Catalog rate per selling unit (ERP SELLING_UNIT_PRICE). */
export const catalogSellingPrice = (p: PricedProduct) =>
  p.base_selling_price ?? p.selling_unit_price;

/** Catalog box / order-unit price (ERP PRICE). */
export const catalogOrderingPrice = (p: PricedProduct) =>
  p.base_ordering_price ?? p.ordering_price;

/**
 * `promotion_rules` for the save payload — only when the admin actually edited the tier rows.
 * The form loads whatever the product response carries (a SKU in a tiered mechanic returns the
 * mechanic's tiers), so posting it back unconditionally copied a mechanic into product-level
 * rules on every save. `initial` is the serialized rows as loaded. A SKU whose tiers a mechanic
 * owns (`locked`) never posts them — the backend answers 400 to `promotion_rules` for it.
 */
export function editedPromotionRules(
  current: unknown[],
  initial: string | null,
  locked = false,
): string | undefined {
  if (locked) return undefined;
  const json = JSON.stringify(current);
  return json === initial ? undefined : json;
}

/**
 * The server's own message from a failed save (an axios error's `response.data.message`, e.g. the 400
 * that names the mechanic owning the SKU's tiers), else `fallback`. Never the transport text
 * ("Request failed with status code 400").
 */
export function saveErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: unknown } } } | null)?.response
    ?.data?.message;
  if (typeof message === 'string' && message) return message;
  if (Array.isArray(message) && message.length) return message.join(', ');
  return fallback;
}
