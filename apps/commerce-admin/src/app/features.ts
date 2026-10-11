/** Feature homes are navigation aliases, not permission aliases or blanket redirects. */
export const FEATURE_HOMES: Readonly<Record<string, string>> = {
  '/josh/kyc': '/j/kyc',
  '/josh/credit_terms': '/j/credit-terms',
  '/josh/admin_access': '/j/admin-access',
  '/josh/shipments': '/j/shipments',
  '/josh/payments': '/j/payment-transactions',
  '/josh/credit_notes': '/j/credit-notes',
  '/josh/credit_backs': '/j/credit-backs',
  '/josh/invoices': '/j/billing',
  '/josh/coupons': '/j/coupons',
  '/josh/campaigns': '/j/promotions/campaigns',
  '/josh/segments': '/j/segments',
  '/josh/suppliers': '/j/suppliers',
  '/j/cs/sample-requests': '/cs',
  '/j/product/create': '/j/allproducts',
  '/j/order/import': '/j/order',
  // Duplicate pages merged into another (their routes redirect there).
  '/j/invoices': '/j/billing',
  '/j/active-offers': '/prices/staff',
  '/j/marketing-links': '/j/smart-links',
  '/erp-ingest': '/erp/inbound-log',
  '/erp/webhook-platforms': '/subscriptions',
};

export function featureHome(path: string): string {
  return FEATURE_HOMES[path] ?? path;
}

export const FEATURE_ACTIONS: Readonly<Record<string, readonly { to: string; label: string }[]>> = {
  '/j/allproducts': [{ to: '/j/product/create', label: 'เพิ่มสินค้า' }],
  '/j/order': [{ to: '/j/order/import', label: 'นำเข้าออเดอร์' }],
  '/j/coupons': [{ to: '/josh/coupons', label: 'เปิดหรือปิดคูปองจากข้อมูลสำรอง' }],
  '/j/suppliers': [{ to: '/josh/suppliers', label: 'เพิ่มหรือแก้ซัพพลายเออร์จากข้อมูลสำรอง' }],
  '/j/credit-terms': [{ to: '/josh/credit_terms', label: 'พิจารณาเครดิตจากข้อมูลสำรอง' }],
  '/j/admin-access': [{ to: '/josh/admin_access', label: 'พิจารณาสิทธิ์จากข้อมูลสำรอง' }],
  ...Object.fromEntries(Object.entries(FEATURE_HOMES)
    .filter(([alias]) => alias.startsWith('/josh/') && !['/josh/coupons', '/josh/suppliers', '/josh/credit_terms', '/josh/admin_access'].includes(alias))
    .map(([alias, home]) => [home, [{ to: alias, label: 'ดูข้อมูลสำรอง' }]])),
};
