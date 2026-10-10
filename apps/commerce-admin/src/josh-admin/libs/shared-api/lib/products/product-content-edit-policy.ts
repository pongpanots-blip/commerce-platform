/** The copied full form must not overwrite the separately reviewed native content task. */
export const REVIEWED_PRODUCT_CONTENT_FIELDS = new Set([
  "product_name_th",
  "product_name_en",
  "product_description_th",
  "product_description_en",
  "ingredients",
  "allergens",
]);

export function productContentAuthority(ownership: unknown): boolean {
  if (
    !ownership ||
    typeof ownership !== "object" ||
    typeof (ownership as { productContent?: unknown }).productContent !==
      "boolean"
  ) {
    throw new Error(
      "Product content ownership is unavailable. Retry before editing.",
    );
  }
  return (ownership as { productContent: boolean }).productContent;
}

export function legacyProductFields(
  fields: Record<string, string>,
  contentOwned: boolean,
) {
  if (
    contentOwned &&
    Object.keys(fields).some((key) => REVIEWED_PRODUCT_CONTENT_FIELDS.has(key))
  ) {
    throw new Error(
      "Commerce owns product content. Use the product content task for names, descriptions, ingredients and allergens before saving. No product change was sent.",
    );
  }
  return { ...fields };
}
