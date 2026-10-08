/**
 * josh's category rules (backend product-category.service.ts / title-case.helper.ts), kept identical so a tree edited in
 * commerce looks exactly like one josh would have written.
 */

/** "HERBS & SPICES" → "Herbs & Spices". Non-Latin (Thai) characters are unchanged. */
export function toTitleCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.toLowerCase().replace(/(^|[^a-z0-9])([a-z])/g, (_m, boundary: string, letter: string) => `${boundary}${letter.toUpperCase()}`);
}

/** `FRESHFOOD > HERBS & SPICES` → `Freshfood > Herbs & Spices`. */
export function toTitleCasePath(path: string): string {
  return path.split(' > ').map(toTitleCase).join(' > ');
}

/** The category's own English name upper-cased, non-[A-Z0-9] runs → `_`. Set once at create, never on rename. */
export function toCatCode(nameEn: string): string {
  return nameEn.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function normalizeSortOptions(options?: Array<{ key: string; label: string; order?: number }>) {
  return (options ?? []).map((opt, index) => ({ key: opt.key, label: opt.label, order: opt.order ?? index }));
}

/** Josh web #549. Parent null, level 1, sort 0, code ALL. Josh's applyTree skips this id on delete; commerce still stores the row so parity and image edits have it. */
export const ALL_CATEGORY_ID = '00000000-0000-4000-8000-000000000a11';

export function isAllCategory(id: string | null | undefined): boolean {
  return id === ALL_CATEGORY_ID;
}

/** Numbered level-1 order. All stays out of it so resort cannot rewrite its code or move it off sort 0. */
export function level1NumberedIds(orderedIds: string[]): string[] {
  return orderedIds.filter((id) => !isAllCategory(id));
}

/** Columns of a category row, as josh's product_category has them (the tree snapshot carries exactly these). */
export const CATEGORY_COLUMNS = [
  'id', 'parent_id', 'category_code', 'category_name_en', 'category_name_th', 'category_path', 'category_path_code', 'sort',
  'level', 'is_active', 'created_at', 'updated_at', 'category_image', 'show_on_homepage', 'default_sort_key', 'sort_options', 'cat_code',
] as const;
export type CategoryRow = Record<(typeof CATEGORY_COLUMNS)[number], unknown> & {
  id: string; parent_id: string | null; category_code: string | null; category_name_en: string; category_name_th: string | null;
  category_path: string | null; category_path_code: string | null; sort: number | null; level: number | null;
};

/** A row in josh's API shape (entity property names), so josh-admin pages read commerce's answer like josh's. */
export function presentCategory(r: CategoryRow) {
  return {
    category_id_uuid: r.id, parent_id_uuid: r.parent_id, category_code: r.category_code,
    category_name_en: toTitleCase(r.category_name_en ?? ''), category_name_th: r.category_name_th,
    category_path: r.category_path ? toTitleCasePath(r.category_path) : r.category_path, category_path_code: r.category_path_code,
    cat_code: r.cat_code, sort_order: r.sort, category_level: r.level, is_active: r.is_active, category_image: r.category_image,
    show_on_homepage: r.show_on_homepage, default_sort_key: r.default_sort_key, sort_options: r.sort_options,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}
