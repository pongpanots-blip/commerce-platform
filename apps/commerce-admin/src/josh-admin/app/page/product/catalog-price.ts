/**
 * Catalog price for admin screens. Product responses are priced like the shop: a promotion
 * mechanic or a customer / contract price moves `selling_price`. Anything an admin edits, saves
 * back or lists as "the price" must read `base_selling_price` (always the catalog value) — never
 * the shop-priced one.
 */
type PricedProduct = {
  base_selling_price?: number | string | null;
  selling_price?: number | string | null;
};

/** Catalog red price per order unit (docs/pricing-total-model.md). */
export const catalogSellingPrice = (p: PricedProduct) =>
  p.base_selling_price ?? p.selling_price;

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
