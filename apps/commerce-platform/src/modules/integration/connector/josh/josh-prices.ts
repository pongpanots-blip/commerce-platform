import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { repScopeSql } from './sales-rep-scope';
import { containsPattern } from '../../../../shared-kernel/helpers/like.helper';
import { JoshReplica } from './josh-replica';

const UUID = /^[0-9a-f-]{36}$/i;

/** josh shared/helpers/date-only.helper `isActiveDateRange` — copied as is (it compares UTC calendar days). */
export function isActiveDateRange(start: Date | string | null | undefined, end: Date | string | null | undefined, at: Date): boolean {
  const day = at.toISOString().slice(0, 10);
  const startDay = start ? new Date(start).toISOString().slice(0, 10) : null;
  const endDay = end ? new Date(end).toISOString().slice(0, 10) : null;
  if (startDay && day < startDay) return false;
  if (endDay && day > endDay) return false;
  return true;
}

export interface QtyRule { min_qty: number; max_qty: number | null; promotion_price: number }
/** josh shared/types/pricing.types `resolvePromotionPrice` — copied as is. */
export function resolvePromotionPrice(rules: QtyRule[], quantity: number, fallbackPrice: number): number {
  if (!rules.length) return fallbackPrice;
  const sorted = [...rules].sort((a, b) => a.min_qty - b.min_qty);
  for (const rule of sorted) {
    if (rule.max_qty == null) continue;
    if (quantity >= rule.min_qty && quantity <= rule.max_qty) return rule.promotion_price;
  }
  let matched = fallbackPrice;
  for (const rule of sorted) {
    if (rule.max_qty != null) continue;
    if (quantity >= rule.min_qty) matched = rule.promotion_price;
  }
  return matched;
}

type Dated = { start_date: string | null; end_date: string | null; price: number; id: string };
export interface PriceLayers {
  base: number;
  privatePrice: Dated[];
  contract: Dated[];
  branchSpecial: Dated[];
  qtyRules: QtyRule[];
  hasActiveMechanic: boolean;
}

/**
 * Which price josh charges for 1 unit — josh pricing.resolver `resolveSkuPrice` order:
 * company private price → branch contract → branch special → promotion mechanic → qty tiers → base.
 * Rows are newest start_date first, like josh. A promotion mechanic is only flagged (its
 * value/audience rules are josh's; this view does not recompute them).
 * Date columns are read as 'YYYY-MM-DD' text, as TypeORM gives them to josh — a pg Date would be
 * Bangkok midnight and shift every range by a day.
 */
export function winningPrice(l: PriceLayers, at = new Date()): { source: string; price: number | null; rowId?: string; endDate?: string | null } {
  for (const [source, rows] of [['customer_sku', l.privatePrice], ['contract_sku', l.contract], ['promotion', l.branchSpecial]] as const) {
    const row = rows.find((r) => isActiveDateRange(r.start_date, r.end_date, at));
    if (row) return { source, price: row.price, rowId: row.id, endDate: row.end_date };
  }
  if (l.hasActiveMechanic) return { source: 'promotion_mechanic', price: null };
  if (l.qtyRules.length) return { source: 'promotion_mechanic', price: resolvePromotionPrice(l.qtyRules, 1, l.base) };
  return { source: 'base', price: l.base };
}

/**
 * Prices a josh company / branch sees, READ-ONLY from josh's replica: every layer that exists
 * and the one josh would charge today, plus the ERP quotations for that customer code.
 */
@Injectable()
export class JoshPrices {
  constructor(private readonly replica: JoshReplica) {}

  get available() { return this.replica.configured; }

  /** Branches to pick from (with their company), searchable by company / branch / ERP code. */
  branches(search?: string, repIds?: string[]) {
    const s = search?.trim().slice(0, 100);
    const params: unknown[] = [];
    const w: string[] = [];
    if (s) { params.push(containsPattern(s)); w.push(`(c.name ILIKE $1 ESCAPE '\\' OR b.name ILIKE $1 ESCAPE '\\' OR c.erp_customer_code ILIKE $1 ESCAPE '\\')`); }
    if (repIds !== undefined) { params.push(repIds); w.push(repScopeSql('c', `$${params.length}`)); }
    return this.replica.query(`SELECT b.id AS branch_id, b.name AS branch_name, b.erp_branch_code, COALESCE(b.company_id, sh.company_id) AS company_id,
        c.name AS company_name, c.erp_customer_code
      FROM branch b LEFT JOIN shop sh ON sh.id = b.shop_id LEFT JOIN company c ON c.id = COALESCE(b.company_id, sh.company_id)
      ${w.length ? `WHERE ${w.join(' AND ')}` : ''}
      ORDER BY c.name, b.name LIMIT 100`, params);
  }

  /** Products with a customer-specific price for this branch's company / branch (or matching `search`), each with all layers and today's winner. */
  async forBranch(branchId: string, search?: string, at = new Date(), repIds?: string[]) {
    if (!UUID.test(branchId)) throw new BadRequestException('branchId must be a uuid');
    const [branch] = await this.replica.query<{ branch_id: string; branch_name: string; company_id: string | null; company_name: string | null; erp_customer_code: string | null }>(
      `SELECT b.id AS branch_id, b.name AS branch_name, COALESCE(b.company_id, sh.company_id) AS company_id, c.name AS company_name, c.erp_customer_code
         FROM branch b LEFT JOIN shop sh ON sh.id = b.shop_id LEFT JOIN company c ON c.id = COALESCE(b.company_id, sh.company_id) WHERE b.id = $1 ${repIds !== undefined ? `AND ${repScopeSql('c', '$2')}` : ''}`, repIds !== undefined ? [branchId, repIds] : [branchId]);
    if (!branch) throw new NotFoundException(`branch ${branchId} not found in josh`);
    const s = search?.trim().slice(0, 100);
    const params: unknown[] = [branch.company_id, branchId];
    const products = await this.replica.query<{ id: string; sku: string; name: string; base: number }>(
      `SELECT p.product_inventory_id AS id, p.product_inventory_sku AS sku, COALESCE(th.product_name, p.product_inventory_sku) AS name,
              COALESCE(p.selling_unit_price, 0)::float AS base
         FROM product_inventory p LEFT JOIN product_translation th ON th.product_inventory_id = p.product_inventory_id AND th.language_code = 'th'
        WHERE ${s ? `(p.product_inventory_sku ILIKE $3 ESCAPE '\\' OR th.product_name ILIKE $3 ESCAPE '\\')` : `(
              EXISTS (SELECT 1 FROM private_price x WHERE x.company_id = $1 AND x.product_inventory_id = p.product_inventory_id)
           OR EXISTS (SELECT 1 FROM branch_contract_price x WHERE x.branch_id = $2 AND x.product_inventory_id = p.product_inventory_id)
           OR EXISTS (SELECT 1 FROM product_branch_specials x WHERE x.branch_id = $2 AND x.product_inventory_id = p.product_inventory_id AND x.is_active))`}
        ORDER BY p.product_inventory_sku LIMIT 200`, s ? [...params, containsPattern(s)] : params);
    const ids = products.map((p) => p.id);
    if (!ids.length) return { branch, at: at.toISOString(), items: [] };
    const dated = (sql: string, key: string | null) => this.replica.query<Dated & { product_inventory_id: string }>(sql, key === null ? [ids] : [key, ids]);
    const [priv, contract, special, rules, mechanics] = await Promise.all([
      branch.company_id ? dated(`SELECT id, product_inventory_id, start_date::text AS start_date, end_date::text AS end_date, private_selling_price::float AS price FROM private_price
          WHERE company_id = $1 AND product_inventory_id = ANY($2) ORDER BY start_date DESC NULLS LAST`, branch.company_id) : Promise.resolve([]),
      dated(`SELECT id, product_inventory_id, start_date::text AS start_date, end_date::text AS end_date, contract_price::float AS price FROM branch_contract_price
          WHERE branch_id = $1 AND product_inventory_id = ANY($2) ORDER BY start_date DESC NULLS LAST`, branchId),
      dated(`SELECT id, product_inventory_id, start_date::text AS start_date, end_date::text AS end_date, special_price::float AS price FROM product_branch_specials
          WHERE branch_id = $1 AND product_inventory_id = ANY($2) AND is_active ORDER BY start_date DESC NULLS LAST`, branchId),
      this.replica.query<QtyRule & { product_inventory_id: string }>(`SELECT product_inventory_id, min_qty, max_qty, promotion_price::float AS promotion_price
          FROM promotion_quantity_rules WHERE product_inventory_id = ANY($1) AND is_active ORDER BY sort_order, min_qty`, [ids]),
      this.replica.query<{ product_inventory_id: string; start_date: string | null; end_date: string | null }>(`SELECT i.product_inventory_id, m.start_date::text AS start_date, m.end_date::text AS end_date
          FROM promotion_mechanic_sku_items i JOIN promotion_mechanics m ON m.id = i.promotion_mechanic_id
         WHERE i.product_inventory_id = ANY($1) AND m.is_active`, [ids]),
    ]);
    const by = <T extends { product_inventory_id: string }>(rows: T[], id: string) => rows.filter((r) => r.product_inventory_id === id);
    return {
      branch, at: at.toISOString(),
      note: 'ราคาต่อ 1 หน่วย ตามลำดับของ josh · promotion mechanic แสดงแค่ว่ามี ราคาจริงคำนวณที่ josh',
      items: products.map((p) => {
        const layers: PriceLayers = {
          base: p.base, privatePrice: by(priv, p.id), contract: by(contract, p.id), branchSpecial: by(special, p.id),
          qtyRules: by(rules, p.id).map(({ min_qty, max_qty, promotion_price }) => ({ min_qty, max_qty, promotion_price })),
          hasActiveMechanic: by(mechanics, p.id).some((m) => isActiveDateRange(m.start_date, m.end_date, at)),
        };
        return { ...p, layers, winner: winningPrice(layers, at) };
      }),
    };
  }

  /** ERP quotations (special prices the ERP sent) for a customer code. */
  async quotations(customerCode: string, repIds?: string[]) {
    const code = customerCode.trim().slice(0, 50);
    if (!code) throw new BadRequestException('customerCode required');
    if (repIds !== undefined) {
      const [company] = await this.replica.query(`SELECT c.id FROM company c WHERE c.erp_customer_code = $1 AND ${repScopeSql('c', '$2')} LIMIT 1`, [code, repIds]);
      if (!company) throw new NotFoundException('customer not found');
    }
    return this.replica.query(`SELECT q.product_code, COALESCE(th.product_name, q.product_code) AS name, q.rate::float AS rate, q.ordering_rate::float AS ordering_rate,
        q.unit, q.quantity::float AS quantity, q.status, q.start_date::text AS start_date, q.expiry_date::text AS expiry_date, q.doc_book, q.doc_no, q.doc_date::text AS doc_date, q.updated_at
      FROM erp_quotations q LEFT JOIN product_inventory p ON p.product_inventory_sku = q.product_code
      LEFT JOIN product_translation th ON th.product_inventory_id = p.product_inventory_id AND th.language_code = 'th'
      WHERE q.customer_code = $1 ORDER BY q.status, q.expiry_date DESC NULLS LAST LIMIT 500`, [code]);
  }
}
