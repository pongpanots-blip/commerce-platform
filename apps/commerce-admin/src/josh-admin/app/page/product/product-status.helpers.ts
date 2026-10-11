import { uiText as __uiText, type Tone } from '@cp/ui';
// ui-static-options-migration: display metadata; identifiers remain unchanged
import { uiText } from '@cp/ui';
/** Status filter options for the admin product list `Select`. */
export const PRODUCT_STATUS_OPTIONS = [
  { value: 'active', get label(){return uiText("ใช้งาน");} },
  { value: 'draft', get label(){return uiText("รออนุมัติ");} },
  { value: 'inactive', get label(){return uiText("ไม่ได้ใช้งาน");} },
  { value: 'all', get label(){return uiText("ทั้งหมด");} },
];

/** Normalizes `product_status` — legacy rows may still hold `'1'`/`'0'`/numbers. */
export function normalizeProductStatus(raw: unknown): 'active' | 'draft' | 'inactive' {
  if (raw === 'draft') return 'draft';
  if (raw === 'active' || raw === '1' || Number(raw) === 1) return 'active';
  return 'inactive';
}

/** Badge label + chip tone for a normalized product status, matching AllProduct.tsx's style. */
export function productStatusBadge(
  status: 'active' | 'draft' | 'inactive',
): { label: string; tone: Tone } {
  switch (status) {
    case 'active':
      return { label: __uiText("ใช้งาน"), tone: 'ok' };
    case 'draft':
      return { label: __uiText("รออนุมัติ"), tone: 'warn' };
    default:
      return { label: __uiText("ไม่ได้ใช้งาน"), tone: 'muted' };
  }
}

// ui-display-helper-migration: display descriptions; record values and enum keys remain data
