const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

/** Prefix relative upload paths with the API origin; pass absolute URLs through. */
export function resolveAdminAssetUrl(url?: string | null): string {
  const value = (url ?? '').trim();
  if (!value) return '';
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:')) return value;
  return `${API_BASE}${value.startsWith('/') ? '' : '/'}${value}`;
}
