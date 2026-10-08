/**
 * Shared homes for commerce staff (also the post-login landing in landing.ts). Each is a page in the role's
 * own sidebar whose first API calls the platform allows for that role.
 */
export const ROLE_HOME: Readonly<Record<string, string>> = {
  admin: '/', // Dashboard (admin-only)
  merchandising: '/products', // GET /products
  business_analyst: '/reports/sales', // GET /reports/sales (read-only role)
  cs: '/cs', // CS desk — no API call on load; tabs use the josh relay /cs-admin/*
  graphic: '/j/product/bulk-image-upload', // relay /product/images*
  marketing: '/marketing/growth', // GET /growth/*
  sale: '/reports/sales', // own sales, scoped to the caller's reps
  sales_manager: '/reports/sales', // team sales
};

export function normalizeRole(role: string | null | undefined): string {
  const value = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return value === 'sale_manager' ? 'sales_manager' : value;
}

export function homeForRole(role: string | null | undefined): string {
  const canonical = normalizeRole(role);
  return Object.prototype.hasOwnProperty.call(ROLE_HOME, canonical) ? ROLE_HOME[canonical] : '/account/password';
}
