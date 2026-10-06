/**
 * Self-describing filter groups returned by every product listing and by search
 * (`filterGroups`, sibling of the legacy `filters` / `facets`). The client draws the
 * groups in order and sends `param=value` back without knowing what anything means.
 * Contract + examples: docs/filter-groups-api.md. The backend keeps a mirror in
 * apps/backend/src/shared/helpers/filter-groups.helper.ts — change both together.
 */
export type FilterGroupParam =
  | 'categoryId'
  | 'priceRange'
  | 'availability'
  | 'brandCode'
  | 'countryCode';

/** Both languages always, whatever `lang` the request sent. */
export type LocalizedLabel = { th: string; en: string };

export type FilterGroupOption = {
  /** Send back as `param=value`. */
  value: string;
  label: LocalizedLabel;
  count: number;
};

export type FilterGroup = {
  /** Query param name to send back. */
  param: FilterGroupParam;
  /** Section title. */
  label: LocalizedLabel;
  /** true → selected values are comma-joined in that one param. */
  multi: boolean;
  options: FilterGroupOption[];
};

/** Values of the `availability` query param (single value). */
export type ListingAvailability = 'in_stock' | 'preorder';
