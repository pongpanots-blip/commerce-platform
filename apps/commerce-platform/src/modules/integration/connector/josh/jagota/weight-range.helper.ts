export type WeightRange = { min: number; max: number | null; unit: string | null };

/**
 * Parses inventory weight strings like "5.5 - 6.5 KG" or "6.50 KG" into a
 * structured range. Deliberately not `toNumerics` from product-inventory.entity.ts —
 * that strips everything but digits/dots, so "5.5 - 6.5" collapses into "5.56.5".
 *
 * Trailing pack-count suffixes ("7 - 8.5 KG X 1 PC") are dropped: only the
 * leading number(s) + unit before a standalone X/x are kept.
 */
export function parseWeightRange(
  value: string | null | undefined,
): WeightRange | null {
  if (!value) return null;

  // Drop everything from a standalone "X"/"x" token onward (e.g. "... X 1 PC").
  const withoutSuffix = value.split(/\s+x\s+/i)[0].trim();

  const match = withoutSuffix.match(
    /^(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?)\s*)?([A-Za-z]+)?$/,
  );
  if (!match) return null;

  const min = Number(match[1]);
  const max = match[2] != null ? Number(match[2]) : null;
  const unit = match[3] ?? null;

  if (!Number.isFinite(min)) return null;

  return { min, max, unit };
}

/**
 * Total Weight is only meaningful for variable-weight ('Approx') inventory —
 * 'Fixed' items (e.g. "48 PC X 1 BX") have a real, exact pack count, not a
 * weight range, so their weight fields must stay null regardless of what
 * `pack_size`/`weight_per_unit` happens to contain.
 */
export function weightFieldsFor(
  packagingType: string | null | undefined,
  source: string | null | undefined,
): WeightRange | null {
  if (packagingType?.trim().toLowerCase() !== 'approx') return null;
  return parseWeightRange(source);
}
