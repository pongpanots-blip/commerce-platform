import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackAppRecord } from './entities/winback-app-record.entity';
import { JoshErpSalesHistory as ErpSalesHistory } from './josh-copies.entity';
import { WinbackCatalogService } from './winback-catalog.service';
import { AppRecordsService, WinbackActor } from './app-records.service';
import {
  DailyReportQueryDto,
  InvoiceEvidenceQueryDto,
  MoveQuoteDto,
  QuoteDispatchDto,
  QuoteFollowUpDto,
  QuoteQueryDto,
  QuoteTermsCatalogDto,
  QuoteTermsDto,
  ReviewDailyReportDto,
  SaveDailyReportDto,
  SaveQuoteDto,
  SubmitDailyReportDto,
} from './dto/app-gaps.dto';
import { bangkokToday, CATALOG_SELLING_UNIT_ID, quoteMoveError, quoteStatusAt } from './app-gaps.helpers';
import { WinbackAppRecordKind as Kind, WinbackDailyReportStatus as Report, WinbackQuoteStatus as Quote } from './winback.enums';

type Payload = Record<string, unknown>;
type QuoteEvent = { at: string; label: string; actor_id: string; version: number };

const EMPTY_TERMS_CATALOG = { credit_days: [] as number[], price_lists: [], warehouses: [], delivery_slots: [] };

/**
 * The commercial screens, record-only: quotes the rep prepares and moves through review, the rep's own
 * "I sent it" log, the quote terms the team offers, daily reports, and invoice evidence read from the ERP
 * sales history. Nothing here sends anything (email / LINE / SMS), creates an order or changes revenue.
 */
@Injectable()
export class CommercialService {
  constructor(
    @InjectRepository(WinbackAppRecord) private readonly records: Repository<WinbackAppRecord>,
    @InjectRepository(WinbackAccount) private readonly accounts: Repository<WinbackAccount>,
    @InjectRepository(ErpSalesHistory) private readonly erpSales: Repository<ErpSalesHistory>,
    private readonly catalog: WinbackCatalogService,
    private readonly store: AppRecordsService,
  ) {}

  // --- quotes ---

  private quoteView(r: WinbackAppRecord, today = bangkokToday()): Payload {
    const v = this.store.view(r);
    return { ...v, status_at: quoteStatusAt(String(r.status), String(r.payload.valid_until), today) };
  }

  private assertQuoteAccess(actor: WinbackActor, r: WinbackAppRecord) {
    if (!actor.isManager && r.sales_user_id !== actor.id) throw new ForbiddenException('ดูได้เฉพาะใบเสนอราคาของตัวเอง');
  }

  private assertVersion(r: WinbackAppRecord, expected: number) {
    if (r.version !== expected) {
      throw new ConflictException(`ข้อมูลเปลี่ยนไปแล้ว (version ${r.version}) — โหลดใหม่แล้วลองอีกครั้ง`);
    }
  }

  async listQuotes(actor: WinbackActor, q: QuoteQueryDto) {
    const salesUserId = actor.isManager ? q.sales_user_id : actor.id;
    const where: Payload = { kind: Kind.QUOTE };
    if (salesUserId) where.sales_user_id = salesUserId;
    if (q.account_id) where.account_id = q.account_id;
    const rows = await this.records.find({ where, order: { create_date: 'DESC' }, take: 500 });
    const today = bangkokToday();
    return rows.map((r) => this.quoteView(r, today));
  }

  async getQuote(actor: WinbackActor, id: string) {
    const row = await this.store.byId(Kind.QUOTE, id);
    this.assertQuoteAccess(actor, row);
    return this.quoteView(row);
  }

  /** Lines priced from the catalog (the client's price is never taken). */
  private async priceLines(lines: SaveQuoteDto['lines']) {
    const products = await this.catalog.listProducts({ ids: [...new Set(lines.map((l) => l.product_id))], limit: 1000 });
    const byId = new Map(products.map((p) => [p.id, p]));
    return lines.map((l) => {
      const product = byId.get(l.product_id);
      if (!product) throw new BadRequestException(`ไม่พบสินค้า ${l.product_id} ในแคตตาล็อก`);
      const unit = product.units.find((u) => u.id === l.unit_id);
      if (!unit || l.unit_id !== CATALOG_SELLING_UNIT_ID) throw new BadRequestException(`สินค้า ${product.sku} ไม่มีหน่วย ${l.unit_id}`);
      if (unit.unit_price === null) throw new BadRequestException(`สินค้า ${product.sku} ยังไม่มีราคาขาย`);
      return {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        unit_id: unit.id,
        unit_label: unit.label,
        unit_price: unit.unit_price,
        quantity: l.quantity,
      };
    });
  }

  private async termsSnapshot(terms: QuoteTermsDto | null | undefined) {
    if (!terms) return null;
    const catalog = await this.getTermsCatalog();
    const pick = <T extends { id: string }>(list: T[], id: string, what: string) => {
      const found = list.find((x) => x.id === id);
      if (!found) throw new BadRequestException(`${what} "${id}" ไม่อยู่ในเงื่อนไขที่ตั้งไว้`);
      return found;
    };
    if (!catalog.credit_days.includes(terms.credit_days)) {
      throw new BadRequestException(`เครดิต ${terms.credit_days} วัน ไม่อยู่ในเงื่อนไขที่ตั้งไว้`);
    }
    const priceList = pick(catalog.price_lists as Array<{ id: string; label: string }>, terms.price_list_id, 'price list');
    const warehouse = pick(catalog.warehouses as Array<{ id: string; label: string }>, terms.warehouse_id, 'warehouse');
    const slot = pick(
      catalog.delivery_slots as Array<{ id: string; label: string; weekdays: number[]; before_minutes: number }>,
      terms.delivery_slot_id,
      'delivery slot',
    );
    return {
      credit_days: terms.credit_days,
      price_list_id: priceList.id,
      price_list_label: priceList.label,
      warehouse_id: warehouse.id,
      warehouse_label: warehouse.label,
      delivery_slot_id: slot.id,
      delivery_slot_label: slot.label,
      delivery_weekdays: slot.weekdays,
      delivery_before_minutes: slot.before_minutes,
      delivery_location: terms.delivery_location.trim(),
    };
  }

  /** Create (`id` null) or revise. A revision goes back to draft and keeps the earlier content in `versions`. */
  async saveQuote(actor: WinbackActor, id: string | null, dto: SaveQuoteDto) {
    const today = bangkokToday();
    if (dto.valid_until < today) throw new BadRequestException('valid_until ต้องเป็นวันนี้หรือหลังจากนี้');
    if (!dto.lines.length) throw new BadRequestException('ใบเสนอราคาต้องมีสินค้าอย่างน้อย 1 รายการ');
    const content = {
      lines: await this.priceLines(dto.lines),
      valid_until: dto.valid_until,
      note: dto.note?.trim() ?? '',
      terms: await this.termsSnapshot(dto.terms),
    };
    const now = new Date().toISOString();

    if (!id) {
      const account = await this.accounts.findOne({ where: { id: dto.account_id } });
      if (!account) throw new NotFoundException('winback account not found');
      const row = this.records.create({
        kind: Kind.QUOTE,
        sales_user_id: actor.id,
        account_id: account.id,
        status: Quote.DRAFT,
        version: 1,
        created_by: actor.id,
        payload: {
          account_name: account.display_name ?? account.customer_code,
          ...content,
          content_version: 1,
          follow_up_at: null,
          events: [{ at: now, label: 'สร้างใบเสนอราคา', actor_id: actor.id, version: 1 }],
          versions: [],
        },
      });
      return this.quoteView(await this.records.save(row), today);
    }

    const row = await this.store.byId(Kind.QUOTE, id);
    this.assertQuoteAccess(actor, row);
    if (dto.expected_version === undefined) throw new BadRequestException('expected_version is required');
    this.assertVersion(row, dto.expected_version);
    if (dto.account_id !== row.account_id) throw new BadRequestException('เปลี่ยนลูกค้าของใบเสนอราคาไม่ได้');
    const p = row.payload;
    const contentVersion = Number(p.content_version ?? 1) + 1;
    const version = row.version + 1;
    row.payload = {
      ...p,
      ...content,
      content_version: contentVersion,
      versions: [
        ...((p.versions as Payload[]) ?? []),
        { version: row.version, content_version: p.content_version, lines: p.lines, valid_until: p.valid_until, note: p.note, terms: p.terms },
      ],
      events: [...((p.events as QuoteEvent[]) ?? []), { at: now, label: `แก้ไขเป็นฉบับ ${contentVersion}`, actor_id: actor.id, version }],
    };
    row.status = Quote.DRAFT;
    row.version = version;
    return this.quoteView(await this.records.save(row), today);
  }

  async moveQuote(actor: WinbackActor, id: string, dto: MoveQuoteDto) {
    const row = await this.store.byId(Kind.QUOTE, id);
    this.assertQuoteAccess(actor, row);
    this.assertVersion(row, dto.expected_version);
    const today = bangkokToday();
    const from = quoteStatusAt(String(row.status), String(row.payload.valid_until), today);
    const error = quoteMoveError(from, dto.status, actor.isManager);
    if (error) throw (error.startsWith('เฉพาะ manager') ? new ForbiddenException(error) : new BadRequestException(error));
    row.version += 1;
    row.status = dto.status;
    row.payload = {
      ...row.payload,
      events: [...((row.payload.events as QuoteEvent[]) ?? []), { at: new Date().toISOString(), label: `เปลี่ยนสถานะ: ${dto.status}`, actor_id: actor.id, version: row.version }],
    };
    return this.quoteView(await this.records.save(row), today);
  }

  async followUpQuote(actor: WinbackActor, id: string, dto: QuoteFollowUpDto) {
    const row = await this.store.byId(Kind.QUOTE, id);
    this.assertQuoteAccess(actor, row);
    this.assertVersion(row, dto.expected_version);
    const today = bangkokToday();
    const status = quoteStatusAt(String(row.status), String(row.payload.valid_until), today);
    if ([Quote.EXPIRED, Quote.ACCEPTED, Quote.DECLINED].includes(status as Quote)) {
      throw new BadRequestException(`ใบเสนอราคาสถานะ ${status} บันทึกการติดตามไม่ได้`);
    }
    if (dto.at < today) throw new BadRequestException('at ต้องเป็นวันนี้หรือหลังจากนี้');
    const note = dto.note.trim();
    if (!note) throw new BadRequestException('note ต้องไม่ว่าง');
    row.version += 1;
    row.payload = {
      ...row.payload,
      follow_up_at: dto.at,
      events: [...((row.payload.events as QuoteEvent[]) ?? []), { at: new Date().toISOString(), label: `บันทึกการติดตาม: ${note}`, actor_id: actor.id, version: row.version }],
    };
    return this.quoteView(await this.records.save(row), today);
  }

  // --- quote dispatch (the rep's record that they sent it; nothing is sent) ---

  async listDispatches(actor: WinbackActor, quoteId: string) {
    const quote = await this.store.byId(Kind.QUOTE, quoteId);
    this.assertQuoteAccess(actor, quote);
    const rows = await this.records.find({ where: { kind: Kind.QUOTE_DISPATCH, record_key: Like(`${quoteId}:%`) }, order: { create_date: 'DESC' } });
    return rows.map((r) => this.store.view(r));
  }

  /** Idempotent per quote content version: confirming the same content again returns the first receipt. */
  async recordDispatch(actor: WinbackActor, quoteId: string, dto: QuoteDispatchDto) {
    const quote = await this.store.byId(Kind.QUOTE, quoteId);
    this.assertQuoteAccess(actor, quote);
    const key = `${quoteId}:${dto.content_version}`;
    const existing = await this.store.byKey(Kind.QUOTE_DISPATCH, key);
    if (existing) return this.store.view(existing);
    this.assertVersion(quote, dto.expected_version);
    if (Number(quote.payload.content_version) !== dto.content_version) {
      throw new ConflictException('ใบเสนอราคาถูกแก้ไขแล้ว — ตรวจฉบับล่าสุดก่อนบันทึกการส่ง');
    }
    if (quoteStatusAt(String(quote.status), String(quote.payload.valid_until), bangkokToday()) !== Quote.FOLLOW_UP) {
      throw new BadRequestException('บันทึกการส่งได้เฉพาะใบเสนอราคาที่อนุมัติแล้ว (follow_up)');
    }
    const p = quote.payload;
    const row = await this.store.put(
      Kind.QUOTE_DISPATCH,
      key,
      { sales_user_id: quote.sales_user_id, account_id: quote.account_id, status: 'recorded', created_by: actor.id },
      {
        quote_id: quoteId,
        content_version: dto.content_version,
        quote_version: quote.version,
        account_name: p.account_name,
        actor_id: actor.id,
        channel: dto.channel,
        at: new Date().toISOString(),
        valid_until: p.valid_until,
        note: p.note,
        lines: p.lines,
        terms: p.terms,
        // Record only — this endpoint never sends email / LINE / SMS.
        sent_by_system: false,
      },
    );
    return this.store.view(row);
  }

  // --- quote terms catalog ---

  async getTermsCatalog() {
    const row = await this.store.byKey(Kind.QUOTE_TERMS_CATALOG, 'default');
    return { ...EMPTY_TERMS_CATALOG, ...(row?.payload ?? {}), configured: !!row, updated_at: row?.update_date ?? null };
  }

  async saveTermsCatalog(actor: WinbackActor, dto: QuoteTermsCatalogDto) {
    if (!actor.isManager) throw new ForbiddenException('เฉพาะ manager ที่ตั้งเงื่อนไขใบเสนอราคาได้');
    for (const [what, list] of [['price_lists', dto.price_lists], ['warehouses', dto.warehouses], ['delivery_slots', dto.delivery_slots]] as const) {
      const ids = list.map((x) => x.id);
      if (new Set(ids).size !== ids.length) throw new BadRequestException(`${what}: id ซ้ำ`);
    }
    await this.store.put(Kind.QUOTE_TERMS_CATALOG, 'default', { created_by: actor.id }, {
      credit_days: [...new Set(dto.credit_days)].sort((a, b) => a - b),
      price_lists: dto.price_lists.map(({ id, label }) => ({ id, label })),
      warehouses: dto.warehouses.map(({ id, label }) => ({ id, label })),
      delivery_slots: dto.delivery_slots.map(({ id, label, weekdays, before_minutes }) => ({ id, label, weekdays, before_minutes })),
    });
    return this.getTermsCatalog();
  }

  // --- daily reports (one per rep per day) ---

  private reportKey(salesUserId: string, day: string) {
    return `${salesUserId}|${day}`;
  }

  private reportView(salesUserId: string, day: string, r: WinbackAppRecord | null) {
    if (!r) {
      return {
        id: null, sales_user_id: salesUserId, day, status: Report.DRAFT, note: '', next_plan: '', review_note: '',
        version: 1, totals: null, evidence_ids: [], updated_at: null,
      };
    }
    return {
      id: r.id, sales_user_id: salesUserId, day, status: r.status, note: '', next_plan: '', review_note: '',
      totals: null, evidence_ids: [], ...r.payload, version: r.version, updated_at: r.update_date,
    };
  }

  private assertReportReader(actor: WinbackActor, salesUserId: string) {
    if (!actor.isManager && salesUserId !== actor.id) throw new ForbiddenException('ดูได้เฉพาะรายงานของตัวเอง');
  }

  async listReports(actor: WinbackActor, q: DailyReportQueryDto) {
    const salesUserId = actor.isManager ? q.sales_user_id : actor.id;
    const where: Payload = { kind: Kind.DAILY_REPORT };
    if (salesUserId) where.sales_user_id = salesUserId;
    if (q.status) where.status = q.status;
    const rows = await this.records.find({ where, order: { create_date: 'DESC' }, take: 500 });
    return rows
      .map((r) => this.reportView(r.sales_user_id!, String(r.payload.day), r))
      .filter((r) => (!q.from || r.day >= q.from) && (!q.to || r.day <= q.to))
      .sort((a, b) => b.day.localeCompare(a.day));
  }

  async getReport(actor: WinbackActor, salesUserId: string, day: string) {
    this.assertReportReader(actor, salesUserId);
    return this.reportView(salesUserId, day, await this.store.byKey(Kind.DAILY_REPORT, this.reportKey(salesUserId, day)));
  }

  private async ownReport(actor: WinbackActor, salesUserId: string, day: string, expected: number) {
    if (salesUserId !== actor.id) throw new ForbiddenException('แก้ไขได้เฉพาะรายงานของตัวเอง');
    const row = await this.store.byKey(Kind.DAILY_REPORT, this.reportKey(salesUserId, day));
    if ((row?.version ?? 1) !== expected) {
      throw new ConflictException(`ข้อมูลเปลี่ยนไปแล้ว (version ${row?.version ?? 1}) — โหลดใหม่แล้วลองอีกครั้ง`);
    }
    const status = row?.status ?? Report.DRAFT;
    if (status !== Report.DRAFT && status !== Report.NEEDS_REVISION) {
      throw new BadRequestException(`รายงานสถานะ ${status} แก้ไขไม่ได้`);
    }
    return row;
  }

  private async writeReport(salesUserId: string, day: string, row: WinbackAppRecord | null, status: string, payload: Payload) {
    const next = row ?? this.records.create({ kind: Kind.DAILY_REPORT, record_key: this.reportKey(salesUserId, day), version: 1, sales_user_id: salesUserId, created_by: salesUserId });
    next.status = status;
    next.payload = { ...(row?.payload ?? {}), ...payload, day };
    next.version = (row?.version ?? 1) + 1;
    return this.reportView(salesUserId, day, await this.records.save(next));
  }

  async saveReport(actor: WinbackActor, salesUserId: string, day: string, dto: SaveDailyReportDto) {
    const row = await this.ownReport(actor, salesUserId, day, dto.expected_version);
    const note = dto.note.trim();
    const nextPlan = dto.next_plan.trim();
    if (!note || !nextPlan) throw new BadRequestException('note และ next_plan ต้องไม่ว่าง');
    return this.writeReport(salesUserId, day, row, row?.status ?? Report.DRAFT, {
      note,
      next_plan: nextPlan,
      totals: dto.totals ?? row?.payload.totals ?? null,
      evidence_ids: dto.evidence_ids ?? row?.payload.evidence_ids ?? [],
    });
  }

  async submitReport(actor: WinbackActor, salesUserId: string, day: string, dto: SubmitDailyReportDto) {
    const row = await this.ownReport(actor, salesUserId, day, dto.expected_version);
    if (!row || !String(row.payload.note ?? '').trim() || !String(row.payload.next_plan ?? '').trim()) {
      throw new BadRequestException('บันทึกรายงาน (note, next_plan) ก่อนส่ง');
    }
    return this.writeReport(salesUserId, day, row, Report.SUBMITTED, { submitted_at: new Date().toISOString() });
  }

  async reviewReport(actor: WinbackActor, salesUserId: string, day: string, dto: ReviewDailyReportDto) {
    if (!actor.isManager) throw new ForbiddenException('เฉพาะ manager ที่ตรวจรายงานได้');
    const row = await this.store.byKey(Kind.DAILY_REPORT, this.reportKey(salesUserId, day));
    if (!row) throw new NotFoundException('ไม่พบรายงานนี้');
    if (row.version !== dto.expected_version) {
      throw new ConflictException(`ข้อมูลเปลี่ยนไปแล้ว (version ${row.version}) — โหลดใหม่แล้วลองอีกครั้ง`);
    }
    if (row.status !== Report.SUBMITTED) throw new BadRequestException('ตรวจได้เฉพาะรายงานที่ส่งแล้ว (submitted)');
    const reason = dto.reason?.trim() ?? '';
    if (!dto.approved && !reason) throw new BadRequestException('ส่งกลับให้แก้ต้องใส่เหตุผล (reason)');
    return this.writeReport(salesUserId, day, row, dto.approved ? Report.APPROVED : Report.NEEDS_REVISION, {
      review_note: reason,
      reviewed_by: actor.id,
      reviewed_at: new Date().toISOString(),
    });
  }

  // --- invoice evidence (ERP sales history, read-only) ---

  /**
   * One row per customer per invoice day (the ERP export has invoice LINES), matched to winback accounts by
   * customer code; the issuer is the account's current owner. Read-only: the ERP export is a static
   * import, so the newest rows can be days old.
   */
  async invoiceEvidence(actor: WinbackActor, q: InvoiceEvidenceQueryDto) {
    const salesUserId = actor.isManager ? q.sales_user_id : actor.id;
    const qb = this.erpSales
      .createQueryBuilder('e')
      .innerJoin(WinbackAccount, 'a', 'a.customer_code = UPPER(TRIM(e.cust_code))')
      .select('a.id', 'account_id')
      .addSelect('a.display_name', 'account_name')
      .addSelect('a.customer_code', 'customer_code')
      .addSelect('a.assigned_sales_user_id', 'sales_user_id')
      .addSelect('e.inv_date', 'inv_date')
      .addSelect('SUM(e.total)', 'amount')
      .groupBy('a.id')
      .addGroupBy('a.display_name')
      .addGroupBy('a.customer_code')
      .addGroupBy('a.assigned_sales_user_id')
      .addGroupBy('e.inv_date')
      .having('SUM(e.total) > 0')
      .orderBy('e.inv_date', 'DESC')
      .limit(q.limit);
    if (salesUserId) qb.andWhere('a.assigned_sales_user_id = :uid', { uid: salesUserId });
    if (q.account_id) qb.andWhere('a.id = :aid', { aid: q.account_id });
    if (q.from) qb.andWhere('e.inv_date >= :from', { from: q.from.slice(0, 10) });
    if (q.to) qb.andWhere('e.inv_date <= :to', { to: q.to.slice(0, 10) });
    const rows = await qb.getRawMany<{
      account_id: string; account_name: string | null; customer_code: string; sales_user_id: string | null; inv_date: string | Date; amount: string;
    }>();
    return rows.map((r) => {
      const day = typeof r.inv_date === 'string' ? r.inv_date.slice(0, 10) : bangkokToday(r.inv_date);
      return {
        id: `${r.customer_code}:${day}`,
        account_id: r.account_id,
        account_name: r.account_name,
        sales_user_id: r.sales_user_id,
        issued_at: day,
        amount: Math.round(Number(r.amount) * 100) / 100,
        label: `ใบแจ้งหนี้ ${r.customer_code} ${day}`,
        status: 'issued',
        is_synthetic: false,
      };
    });
  }
}
