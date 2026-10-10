/** Keep every native SKU representable without weakening the app's encoded-path policy. */
export const priceDetailUrl = (sku: string) =>
  `/product-prices/pending/s-${Array.from(sku)
    .map((c) => c.codePointAt(0)!.toString(16))
    .join("-")}`;
export function priceSkuFromToken(token: string) {
  if (!/^s-[a-f0-9]+(?:-[a-f0-9]+)*$/.test(token)) return null;
  try {
    const codes = token
      .slice(2)
      .split("-")
      .map((s) => Number.parseInt(s, 16));
    if (codes.some((c) => c > 0x10ffff || (c >= 0xd800 && c <= 0xdfff)))
      return null;
    const sku = String.fromCodePoint(...codes);
    return sku.length > 0 &&
      Array.from(sku).length <= 64 &&
      priceDetailUrl(sku).endsWith(token)
      ? sku
      : null;
  } catch {
    return null;
  }
}
