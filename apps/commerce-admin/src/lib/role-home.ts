/** Shared homes for commerce staff. Independent of the parallel landing module. */
export const ROLE_HOME: Readonly<Record<string, string>> = {
  admin: '/', merchandising: '/products', business_analyst: '/reports/sales', cs: '/cs',
  graphic: '/j/product/bulk-image-upload', marketing: '/marketing/growth',
  sale: '/reports/sales', sales_manager: '/reports/sales',
};

export function normalizeRole(role: string | null | undefined): string {
  const value = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return value === 'sale_manager' ? 'sales_manager' : value;
}

export function homeForRole(role: string | null | undefined): string {
  const canonical = normalizeRole(role);
  return Object.prototype.hasOwnProperty.call(ROLE_HOME, canonical) ? ROLE_HOME[canonical] : '/account/password';
}
