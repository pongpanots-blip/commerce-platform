import { BadRequestException } from '@nestjs/common';
import { ProductFilters } from './josh-products';

/**
 * Role `cs` reads exactly what the CS desk's "order on behalf" pickers show (commerce-admin CsDesk.tsx):
 * a customer search, one customer's users / branches / credit, and an active-product search.
 * Search is required, pages are small, every other filter is refused and responses carry only the shown columns.
 * cs is not rep-scoped (all customers, like admin / sales_manager) and never chooses a rep (salesUserId → 400).
 */
export const CS_CUSTOMER_LIMIT = 20;
export const CS_PRODUCT_LIMIT = 10;

type Row = Record<string, unknown>;
const pick = (row: Row, keys: readonly string[]): Row => Object.fromEntries(keys.map((k) => [k, row[k]]));

function csSearch(query: object, allowed: readonly string[]): string {
  const q = query as Row;
  const extra = Object.keys(q).filter((k) => !allowed.includes(k));
  if (extra.length) throw new BadRequestException(`cs can only search here (${allowed.join(', ')}); not allowed: ${extra.join(', ')}`);
  const search = typeof q.search === 'string' ? q.search.trim() : '';
  if (!search) throw new BadRequestException('search is required');
  return search;
}

export function csCustomerSearch(q: object): { search: string } {
  return { search: csSearch(q, ['search', 'page', 'limit']) };
}

/** Active products only — the desk always asks for status=active; anything else is refused. */
export function csProductSearch(q: ProductFilters): ProductFilters {
  const search = csSearch(q, ['search', 'status', 'page', 'limit']);
  if (q.status !== undefined && q.status !== 'active') throw new BadRequestException('cs can only search active products');
  return { search, status: 'active' };
}

const CUSTOMER_ROW = ['id', 'name', 'erp_customer_code'] as const;
const CUSTOMER_DETAIL = [...CUSTOMER_ROW, 'credit_limit', 'credit_used', 'credit_term_days'] as const;
const CUSTOMER_USER = ['id', 'first_name', 'last_name', 'role', 'is_active'] as const;
const CUSTOMER_BRANCH = ['id', 'name', 'is_default_delivery'] as const;
const PRODUCT_ROW = ['product_inventory_id', 'product_inventory_sku', 'name_th', 'name_en', 'selling_unit_price', 'selling_unit'] as const;

export function csCustomerSearchView(r: { items: Row[]; total: unknown }) {
  return { items: r.items.map((i) => pick(i, CUSTOMER_ROW)), total: r.total };
}

export function csCustomerDetailView(d: Row & { users: Row[]; branches: Row[] }) {
  return { ...pick(d, CUSTOMER_DETAIL), users: d.users.map((u) => pick(u, CUSTOMER_USER)), branches: d.branches.map((b) => pick(b, CUSTOMER_BRANCH)) };
}

export function csProductSearchView(r: { items: Row[]; total: unknown; page: number; limit: number }) {
  return { items: r.items.map((i) => pick(i, PRODUCT_ROW)), total: r.total, page: r.page, limit: r.limit };
}
