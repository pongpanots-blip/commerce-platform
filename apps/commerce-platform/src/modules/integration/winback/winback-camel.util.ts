function snakeToCamelKey(key: string): string {
  return key.replace(/_([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function toCamelCaseDeep<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => toCamelCaseDeep(item)) as T;
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[snakeToCamelKey(k)] = toCamelCaseDeep(v);
  }
  return out as T;
}
