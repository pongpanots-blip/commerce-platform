import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { cronConfig } from '../../../../../config/cron.config';
import { JoshActionActor, JoshActions } from '../josh-actions';
import { JoshReplica } from '../josh-replica';
import { StaffPrice, StaffPriceKind } from './staff-price.entity';

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A josh private_price / branch_contract_price row as commerce reads it from the replica. */
export interface JoshPriceRow {
  josh_id: string; kind: StaffPriceKind; company_id: string | null; branch_id: string | null; product_inventory_id: string;
  sku: string | null; price: number; contract_ref: string | null; start_date: string; end_date: string | null;
}
export interface StaffPriceInput { companyId?: string; branchId?: string; productInventoryId?: string; sku?: string; price?: number; contractRef?: string | null; startDate?: string; endDate?: string | null }

const same = (a: Pick<JoshPriceRow, 'price' | 'start_date' | 'end_date' | 'contract_ref'>, b: StaffPrice) =>
  Number(a.price) === Number(b.price) && a.start_date === b.startDate && (a.end_date ?? null) === (b.endDate ?? null) && (a.contract_ref ?? null) === (b.contractRef ?? null);

/**
 * What an import from josh changes in commerce. josh is the source only for rows commerce is not
 * in the middle of writing: a `pending` / `failed` commerce edit is never overwritten (commerce will
 * send it), a synced row follows josh (ERP quotation, CS price request), a josh row commerce has
 * never seen is added, and a synced row josh no longer has is marked deleted.
 */
export function planImport(josh: JoshPriceRow[], commerce: StaffPrice[]) {
  const byJoshId = new Map(commerce.filter((c) => c.joshId).map((c) => [c.joshId!, c]));
  const seen = new Set<string>();
  const add: JoshPriceRow[] = [];
  const follow: Array<{ row: StaffPrice; josh: JoshPriceRow }> = [];
  for (const j of josh) {
    seen.add(j.josh_id);
    const c = byJoshId.get(j.josh_id);
    if (!c) add.push(j);
    else if (c.status === 'synced' && !c.deletedAt && !same(j, c)) follow.push({ row: c, josh: j });
  }
  const gone = commerce.filter((c) => c.joshId && c.status === 'synced' && !c.deletedAt && !seen.has(c.joshId));
  return { add, follow, gone };
}

/**
 * Customer and branch contract prices, owned by commerce (josh COMMERCE_OWNS_PRICES=true). Every
 * edit is stored here first, then written to josh through josh's own PrivatePriceService /
 * BranchPricingService (signed commerce action), which also clears josh's price caches. A row josh
 * refuses or cannot be reached for stays `failed` with josh's message until retried.
 */
@Injectable()
export class StaffPrices {
  private readonly logger = new Logger(StaffPrices.name);
  private importing = false;

  constructor(
    @InjectRepository(StaffPrice) private readonly prices: Repository<StaffPrice>,
    private readonly replica: JoshReplica,
    private readonly josh: JoshActions,
  ) {}

  get available() { return this.replica.configured; }

  @Cron(cronConfig.staffPricesImport.expression, { timeZone: cronConfig.staffPricesImport.timeZone, disabled: !cronConfig.staffPricesImport.enabled })
  async tick() {
    if (!this.available || this.importing) return; // ponytail: in-process guard; one commerce instance runs this cron
    try { await this.importFromJosh(); } catch (e) { this.logger.warn(`staff price import failed: ${e instanceof Error ? e.message : e}`); }
  }

  /** Pull josh's current customer / contract prices into commerce (see planImport). */
  async importFromJosh() {
    this.importing = true;
    try {
      const josh = await this.replica.query<JoshPriceRow>(`
        SELECT p.id::text AS josh_id, 'customer' AS kind, p.company_id::text AS company_id, NULL AS branch_id, p.product_inventory_id::text AS product_inventory_id,
               i.product_inventory_sku AS sku, p.private_selling_price::float AS price, NULL AS contract_ref, p.start_date::text AS start_date, p.end_date::text AS end_date
          FROM private_price p LEFT JOIN product_inventory i ON i.product_inventory_id = p.product_inventory_id
        UNION ALL
        SELECT c.id::text, 'contract', NULL, c.branch_id::text, c.product_inventory_id::text,
               i.product_inventory_sku, c.contract_price::float, c.contract_ref, c.start_date::text, c.end_date::text
          FROM branch_contract_price c LEFT JOIN product_inventory i ON i.product_inventory_id = c.product_inventory_id`);
      const commerce = await this.prices.find();
      const { add, follow, gone } = planImport(josh, commerce);
      const fromJosh = (j: JoshPriceRow) => ({ kind: j.kind, companyId: j.company_id, branchId: j.branch_id, productInventoryId: j.product_inventory_id, sku: j.sku,
        price: String(j.price), contractRef: j.contract_ref, startDate: j.start_date, endDate: j.end_date, joshId: j.josh_id, status: 'synced' as const,
        syncError: null, updatedBy: 'josh', updatedAt: new Date() });
      for (const batch of chunk(add, 500)) await this.prices.insert(batch.map(fromJosh));
      for (const { row, josh: j } of follow) await this.prices.update({ id: row.id }, fromJosh(j));
      if (gone.length) await this.prices.update({ id: In(gone.map((g) => g.id)) }, { deletedAt: new Date(), updatedBy: 'josh', updatedAt: new Date() });
      this.logger.log(`staff prices from josh: +${add.length} new, ${follow.length} changed in josh, ${gone.length} removed in josh`);
      return { added: add.length, changedInJosh: follow.length, removedInJosh: gone.length };
    } finally {
      this.importing = false;
    }
  }

  async summary() {
    const rows = await this.prices.query(`SELECT kind, status, count(*)::int AS n FROM staff_prices WHERE deleted_at IS NULL GROUP BY 1, 2`);
    return { rows };
  }

  async list(f: { kind?: string; scopeId?: string; search?: string; status?: string }, page = 1, limit = 100) {
    const w: string[] = ['p.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (f.kind) { if (!['customer', 'contract'].includes(f.kind)) throw new BadRequestException('kind must be customer or contract'); params.push(f.kind); w.push(`p.kind = $${params.length}`); }
    if (f.scopeId) { if (!UUID.test(f.scopeId)) throw new BadRequestException('scopeId must be a uuid'); params.push(f.scopeId); w.push(`(p.company_id = $${params.length} OR p.branch_id = $${params.length})`); }
    if (f.status) { if (!['synced', 'pending', 'failed'].includes(f.status)) throw new BadRequestException('status must be synced, pending or failed'); params.push(f.status); w.push(`p.status = $${params.length}`); }
    const s = f.search?.trim().slice(0, 100);
    if (s) { params.push(`%${s}%`); w.push(`p.sku ILIKE $${params.length}`); }
    const where = `WHERE ${w.join(' AND ')}`;
    const [items, [{ total }]] = await Promise.all([
      this.prices.query(`SELECT p.id, p.kind, p.company_id AS "companyId", p.branch_id AS "branchId", p.product_inventory_id AS "productInventoryId", p.sku, p.price::float AS price,
          p.contract_ref AS "contractRef", p.start_date::text AS "startDate", p.end_date::text AS "endDate", p.josh_id AS "joshId", p.status, p.sync_error AS "syncError",
          p.updated_by AS "updatedBy", p.updated_at AS "updatedAt"
        FROM staff_prices p ${where} ORDER BY p.updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, (page - 1) * limit]),
      this.prices.query(`SELECT count(*)::int AS total FROM staff_prices p ${where}`, params),
    ]);
    return { items, total, page, limit };
  }

  private validate(kind: StaffPriceKind, input: StaffPriceInput, creating: boolean) {
    if (creating) {
      const scope = kind === 'customer' ? input.companyId : input.branchId;
      if (!scope || !UUID.test(scope)) throw new BadRequestException(kind === 'customer' ? 'companyId (uuid) required' : 'branchId (uuid) required');
      if (!input.productInventoryId || !UUID.test(input.productInventoryId)) throw new BadRequestException('productInventoryId (uuid) required');
      if (input.price == null) throw new BadRequestException('price required');
    }
    if (input.price != null && (!Number.isFinite(Number(input.price)) || Number(input.price) < 0)) throw new BadRequestException('price must be a number ≥ 0');
    for (const k of ['startDate', 'endDate'] as const) if (input[k] && !DAY.test(input[k]!)) throw new BadRequestException(`${k} must be YYYY-MM-DD`);
    if (input.startDate && input.endDate && input.endDate < input.startDate) throw new BadRequestException('endDate is before startDate');
  }

  /** New price (a customer price for a company + product that already has one replaces it, like josh). */
  async create(kind: StaffPriceKind, input: StaffPriceInput, actor: JoshActionActor) {
    if (!['customer', 'contract'].includes(kind)) throw new BadRequestException('kind must be customer or contract');
    if (!input.productInventoryId && input.sku?.trim()) {
      const [p] = await this.replica.query<{ id: string }>(`SELECT product_inventory_id AS id FROM product_inventory WHERE product_inventory_sku = $1`, [input.sku.trim().slice(0, 100)]);
      if (!p) throw new BadRequestException(`ไม่พบ SKU ${input.sku} ใน josh`);
      input = { ...input, productInventoryId: p.id };
    }
    this.validate(kind, input, true);
    if (kind === 'customer') {
      const existing = await this.prices.findOneBy({ kind, companyId: input.companyId!, productInventoryId: input.productInventoryId!, deletedAt: IsNull() });
      if (existing) return this.update(existing.id, input, actor);
    }
    const [sku] = await this.replica.query<{ sku: string }>(`SELECT product_inventory_sku AS sku FROM product_inventory WHERE product_inventory_id = $1`, [input.productInventoryId]).catch(() => []);
    const row = await this.prices.save(this.prices.create({
      kind, companyId: kind === 'customer' ? input.companyId! : null, branchId: kind === 'contract' ? input.branchId! : null,
      productInventoryId: input.productInventoryId!, sku: sku?.sku ?? null, price: String(input.price), contractRef: input.contractRef ?? null,
      startDate: input.startDate ?? new Date().toISOString().slice(0, 10), endDate: input.endDate ?? null,
      joshId: null, status: 'pending', syncError: null, updatedBy: actor.email, deletedAt: null,
    }));
    return this.push(row, actor);
  }

  async update(id: string, input: StaffPriceInput, actor: JoshActionActor) {
    const row = await this.get(id);
    this.validate(row.kind, input, false);
    if (input.price != null) row.price = String(input.price);
    if (input.contractRef !== undefined) row.contractRef = input.contractRef;
    if (input.startDate) row.startDate = input.startDate;
    if (input.endDate !== undefined) row.endDate = input.endDate;
    if (row.endDate && row.endDate < row.startDate) throw new BadRequestException('endDate is before startDate');
    Object.assign(row, { status: 'pending', syncError: null, updatedBy: actor.email, updatedAt: new Date() });
    return this.push(await this.prices.save(row), actor);
  }

  async remove(id: string, actor: JoshActionActor) {
    const row = await this.get(id);
    if (row.joshId) {
      try {
        await this.josh.run(target(row.kind), 'delete', { id: row.joshId }, actor, 'admin');
      } catch (e) {
        // Already gone in josh = deleted; anything else keeps the row so nobody thinks josh stopped charging it.
        if (!/not ?found|ไม่พบ/i.test(errorText(e))) {
          await this.prices.update({ id }, { status: 'failed', syncError: `ลบใน josh ไม่สำเร็จ: ${errorText(e)}`.slice(0, 500), updatedAt: new Date() });
          throw e;
        }
      }
    }
    await this.prices.update({ id }, { deletedAt: new Date(), updatedBy: actor.email, updatedAt: new Date() });
    return { deleted: true };
  }

  /** Send a pending / failed row again. */
  async retry(id: string, actor: JoshActionActor) {
    const row = await this.get(id);
    if (row.status === 'synced') return row;
    return this.push(row, actor);
  }

  private async get(id: string) {
    if (!UUID.test(id)) throw new BadRequestException('id must be a uuid');
    const row = await this.prices.findOneBy({ id, deletedAt: IsNull() });
    if (!row) throw new NotFoundException('price not found');
    return row;
  }

  /** Write the row to josh through josh's own service; remember josh's id, or why it failed. */
  private async push(row: StaffPrice, actor: JoshActionActor) {
    const args = row.kind === 'customer'
      ? (row.joshId
        ? { action: 'update', args: { id: row.joshId, price: Number(row.price), startDate: row.startDate, endDate: row.endDate ?? undefined } }
        : { action: 'upsert', args: { companyId: row.companyId, productInventoryId: row.productInventoryId, price: Number(row.price), startDate: row.startDate, endDate: row.endDate ?? undefined } })
      : (row.joshId
        ? { action: 'update', args: { id: row.joshId, price: Number(row.price), contractRef: row.contractRef ?? undefined, startDate: row.startDate, endDate: row.endDate ?? undefined } }
        : { action: 'create', args: { branchId: row.branchId, productInventoryId: row.productInventoryId, price: Number(row.price), contractRef: row.contractRef ?? undefined, startDate: row.startDate, endDate: row.endDate ?? undefined } });
    try {
      const answer = await this.josh.run<{ data?: { id?: string } }>(target(row.kind), args.action, args.args, actor, 'admin');
      const joshId = answer?.data?.id ?? row.joshId;
      await this.prices.update({ id: row.id }, { joshId, status: 'synced', syncError: null, updatedAt: new Date() });
      return { ...row, joshId, status: 'synced' as const, syncError: null };
    } catch (e) {
      const syncError = errorText(e).slice(0, 500);
      await this.prices.update({ id: row.id }, { status: 'failed', syncError, updatedAt: new Date() });
      return { ...row, status: 'failed' as const, syncError };
    }
  }
}

const target = (kind: StaffPriceKind) => (kind === 'customer' ? 'customer-prices' : 'contract-prices');
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
function chunk<T>(rows: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n));
  return out;
}
