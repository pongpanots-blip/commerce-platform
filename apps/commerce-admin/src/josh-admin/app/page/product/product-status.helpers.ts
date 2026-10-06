/** Status filter options for the admin product list `Select`. */
export const PRODUCT_STATUS_OPTIONS = [
  { value: 'active', label: 'ใช้งาน' },
  { value: 'draft', label: 'รออนุมัติ' },
  { value: 'inactive', label: 'ไม่ได้ใช้งาน' },
  { value: 'all', label: 'ทั้งหมด' },
];

/** Normalizes `product_status` — legacy rows may still hold `'1'`/`'0'`/numbers. */
export function normalizeProductStatus(raw: unknown): 'active' | 'draft' | 'inactive' {
  if (raw === 'draft') return 'draft';
  if (raw === 'active' || raw === '1' || Number(raw) === 1) return 'active';
  return 'inactive';
}

/** Badge label + classes for a normalized product status, matching AllProduct.tsx's style. */
export function productStatusBadge(
  status: 'active' | 'draft' | 'inactive',
): { label: string; className: string } {
  switch (status) {
    case 'active':
      return { label: 'ใช้งาน', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'draft':
      return { label: 'รออนุมัติ', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    default:
      return { label: 'ไม่ได้ใช้งาน', className: 'bg-rose-50 text-rose-700 border-rose-200' };
  }
}
