export type NutritionItemRow = {
  label: string;
  value: string;
  unit: string;
};

export const EMPTY_NUTRITION_ROW: NutritionItemRow = {
  label: '',
  value: '',
  unit: '',
};

export function hydrateNutrition(raw: unknown): {
  nutrition_basis: string;
  nutrition_items: NutritionItemRow[];
} {
  if (raw == null || raw === '') {
    return { nutrition_basis: '', nutrition_items: [{ ...EMPTY_NUTRITION_ROW }] };
  }

  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return { nutrition_basis: '', nutrition_items: [{ ...EMPTY_NUTRITION_ROW }] };
    }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { nutrition_basis: '', nutrition_items: [{ ...EMPTY_NUTRITION_ROW }] };
  }

  const obj = data as { basis?: unknown; items?: unknown };
  const basis = typeof obj.basis === 'string' ? obj.basis : '';
  const items = Array.isArray(obj.items)
    ? obj.items
        .filter(
          (row): row is Record<string, unknown> =>
            !!row && typeof row === 'object' && !Array.isArray(row),
        )
        .map((row) => ({
          label: typeof row.label === 'string' ? row.label : '',
          value: row.value === undefined || row.value === null ? '' : String(row.value),
          unit: typeof row.unit === 'string' ? row.unit : '',
        }))
    : [];

  return {
    nutrition_basis: basis,
    nutrition_items: items.length ? items : [{ ...EMPTY_NUTRITION_ROW }],
  };
}

export function buildNutritionPayload(
  nutrition_basis: string,
  nutrition_items: NutritionItemRow[],
): {
  basis?: string;
  items: NutritionItemRow[];
} | null {
  const nutrition = {
    basis: nutrition_basis || undefined,
    items: nutrition_items.filter((row) => row.label.trim()),
  };
  return nutrition.items.length || nutrition.basis ? nutrition : null;
}

export function toDatetimeLocalValue(raw: unknown): string {
  if (raw == null || raw === '') return '';
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type NutritionDisplayItem = {
  label: string;
  value: string;
  unit: string;
};

export function nutritionForDisplay(raw: unknown): {
  basis: string;
  items: NutritionDisplayItem[];
} | null {
  if (raw == null || raw === '') return null;
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as { basis?: unknown; items?: unknown };
  if (!Array.isArray(obj.items) || obj.items.length === 0) return null;
  const items = obj.items
    .filter(
      (row): row is Record<string, unknown> =>
        !!row && typeof row === 'object' && !Array.isArray(row),
    )
    .map((row) => ({
      label: typeof row.label === 'string' ? row.label : '',
      value: row.value === undefined || row.value === null ? '' : String(row.value),
      unit: typeof row.unit === 'string' ? row.unit : '',
    }))
    .filter((row) => row.label);
  if (!items.length) return null;
  return {
    basis: typeof obj.basis === 'string' ? obj.basis : '',
    items,
  };
}
