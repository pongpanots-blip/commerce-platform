/**
 * Admin reads of the shared product endpoints always ask for Thai. The backend falls back to
 * `Accept-Language` when `lang` is absent, and an admin on an English browser would then get
 * translated names and `promotion_rules[].unit_label` ("box") back into forms that save them.
 */
export const ADMIN_PRODUCT_READ = { lang: 'th' } as const;
