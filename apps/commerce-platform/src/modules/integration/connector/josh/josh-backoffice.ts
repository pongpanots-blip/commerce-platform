import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { JoshReplica } from './josh-replica';
import { maskEmail, maskPersonName, maskPhone } from './winback/pii.helper';

type Kind = 'text' | 'money' | 'number' | 'date' | 'datetime' | 'bool' | 'status' | 'code' | 'phone' | 'email';
interface Column { key: string; label: string; sql: string; kind?: Kind }
interface View {
  title: string;
  /** josh web-admin page this mirrors. */
  joshPage: string;
  from: string;
  columns: Column[];
  search?: string[];
  /** Expression grouped for the summary and matched by ?status=. */
  status?: string;
  order: string;
  /** Extra masking that needs more than one column (people's names). */
  mask?: (row: Record<string, unknown>) => Record<string, unknown>;
}

const c = (key: string, label: string, sql: string, kind: Kind = 'text'): Column => ({ key, label, sql, kind });
const COMPANY = c('company_name', 'บริษัท', 'co.name');

/**
 * josh back-office lists that only staff see, READ-ONLY from josh's replica. Column keys are
 * josh's column names. Phones, emails and people's names are masked like josh's winback screens;
 * KYC files, card data, gateway payloads and password hashes are never selected.
 */
export const BACKOFFICE_VIEWS: Record<string, View> = {
  kyc: {
    title: 'KYC รอตรวจ', joshPage: 'kyc/KycQueue',
    from: 'kyc_document k LEFT JOIN company co ON co.id = k.company_id',
    columns: [c('id', 'id', 'k.id', 'code'), COMPANY, c('erp_customer_code', 'รหัสลูกค้า ERP', 'co.erp_customer_code', 'code'),
      c('document_type', 'เอกสาร', 'k.document_type'), c('status', 'สถานะ', 'k.status', 'status'), c('rejection_reason', 'เหตุผลที่ไม่ผ่าน', 'k.rejection_reason'),
      c('decided_by', 'ตรวจโดย', 'k.decided_by'), c('decided_at', 'ตรวจเมื่อ', 'k.decided_at', 'datetime'), c('created_at', 'ส่งเมื่อ', 'k.created_at', 'datetime')],
    search: ['co.name', 'co.erp_customer_code'], status: 'k.status', order: 'k.created_at',
  },
  credit_terms: {
    title: 'ขอเครดิต', joshPage: 'CS/CreditTermsAdmin',
    from: 'credit_term_applications a LEFT JOIN company co ON co.id = a.company_id',
    columns: [c('application_id', 'id', 'a.application_id', 'code'), COMPANY, c('erp_customer_code', 'รหัสลูกค้า ERP', 'co.erp_customer_code', 'code'),
      c('application_type', 'ประเภท', 'a.application_type::text'), c('status', 'สถานะ', 'a.status::text', 'status'),
      c('requested_credit_limit', 'วงเงินที่ขอ', 'a.requested_credit_limit::float', 'money'), c('requested_term_days', 'เครดิต (วัน) ที่ขอ', 'a.requested_term_days', 'number'),
      c('approved_credit_limit', 'วงเงินที่อนุมัติ', 'a.approved_credit_limit::float', 'money'), c('approved_term_days', 'เครดิต (วัน) ที่อนุมัติ', 'a.approved_term_days', 'number'),
      c('reject_reason', 'เหตุผลที่ไม่อนุมัติ', 'a.reject_reason'), c('accounting_remark', 'หมายเหตุบัญชี', 'a.accounting_remark'),
      c('reviewed_at', 'พิจารณาเมื่อ', 'a.reviewed_at', 'datetime'), c('created_at', 'ยื่นเมื่อ', 'a.created_at', 'datetime')],
    search: ['co.name', 'co.erp_customer_code'], status: 'a.status::text', order: 'a.created_at',
  },
  credit_notes: {
    title: 'Credit notes', joshPage: 'accounting/CreditNotesAdmin',
    from: 'credit_notes n LEFT JOIN orders o ON o.orders_id = n.issued_from_order_id LEFT JOIN company co ON co.id = o.company_id',
    columns: [c('cn_number', 'เลข CN', 'n.cn_number', 'code'), c('order_number', 'Order', 'o.order_number', 'code'), COMPANY,
      c('total_amount', 'ยอด', 'n.total_amount::float', 'money'), c('remaining_amount', 'คงเหลือ', 'n.remaining_amount::float', 'money'),
      c('cn_status', 'สถานะ', 'n.cn_status', 'status'), c('claim_reason', 'เหตุผลเคลม', 'n.claim_reason'), c('created_at', 'ออกเมื่อ', 'n.created_at', 'datetime')],
    search: ['n.cn_number', 'o.order_number', 'co.name'], status: 'n.cn_status', order: 'n.created_at',
  },
  invoices: {
    title: 'ใบแจ้งหนี้', joshPage: 'accounting/Invoices',
    from: `invoices i LEFT JOIN orders o ON o.orders_id = i.order_id LEFT JOIN company co ON co.id = o.company_id`,
    columns: [c('invoice_number', 'เลขใบแจ้งหนี้', 'i.invoice_number', 'code'), c('erp_inv', 'เลข ERP', "concat_ws('/', i.erp_inv_book, i.erp_inv_no)", 'code'),
      c('order_number', 'Order', 'o.order_number', 'code'), COMPANY, c('payment_method', 'ชำระด้วย', 'i.payment_method', 'code'),
      c('state', 'สถานะ', `CASE WHEN i.erp_invoice_cancelled THEN 'cancelled' WHEN i.is_paid THEN 'paid' WHEN i.due_date < current_date THEN 'overdue' ELSE 'open' END`, 'status'),
      c('due_date', 'ครบกำหนด', 'i.due_date', 'date'), c('paid_at', 'ชำระเมื่อ', 'i.paid_at', 'datetime'), c('created_at', 'ออกเมื่อ', 'i.created_at', 'datetime')],
    search: ['i.invoice_number', 'i.erp_inv_no', 'o.order_number', 'co.name'],
    status: `CASE WHEN i.erp_invoice_cancelled THEN 'cancelled' WHEN i.is_paid THEN 'paid' WHEN i.due_date < current_date THEN 'overdue' ELSE 'open' END`,
    order: 'i.created_at',
  },
  credit_backs: {
    title: 'Credit backs', joshPage: 'accounting/CreditBacksAdmin',
    from: 'credit_backs b LEFT JOIN orders o ON o.orders_id = b.issued_from_order_id LEFT JOIN company co ON co.id = o.company_id',
    columns: [c('cb_number', 'เลข CB', 'b.cb_number', 'code'), c('order_number', 'Order', 'o.order_number', 'code'), COMPANY,
      c('invoice_number', 'Invoice', 'b.invoice_number', 'code'), c('order_amount', 'ยอด order', 'b.order_amount::float', 'money'),
      c('invoice_amount', 'ยอด invoice', 'b.invoice_amount::float', 'money'), c('total_amount', 'ยอดคืน', 'b.total_amount::float', 'money'),
      c('remaining_amount', 'คงเหลือ', 'b.remaining_amount::float', 'money'), c('cb_status', 'สถานะ', 'b.cb_status', 'status'),
      c('source', 'ที่มา', 'b.source'), c('created_at', 'ออกเมื่อ', 'b.created_at', 'datetime')],
    search: ['b.cb_number', 'o.order_number', 'b.invoice_number', 'co.name'], status: 'b.cb_status', order: 'b.created_at',
  },
  shipments: {
    title: 'Shipments', joshPage: 'orders/Shipments',
    from: 'shipments s JOIN orders o ON o.orders_id = s.order_id LEFT JOIN company co ON co.id = o.company_id',
    columns: [c('shipment_number', 'Shipment', 's.shipment_number', 'code'), c('order_number', 'Order', 'o.order_number', 'code'), COMPANY,
      c('status', 'สถานะ', 's.status::text', 'status'), c('erp_sync_status', 'ERP', 's.erp_sync_status', 'status'), c('fulfillment_type', 'ส่งแบบ', 's.fulfillment_type::text'),
      // date column as text: a pg Date would be Bangkok midnight and show the previous day.
      c('delivery_date', 'วันส่ง', 's.delivery_date::text', 'date'), c('total_inc_vat', 'ยอดรวม', 's.total_inc_vat::float', 'money'),
      c('three_pl_status', '3PL', 's.three_pl_status', 'status'), c('courier_name', 'คนส่ง', 's.courier_name'),
      c('shipped_at', 'ออกส่ง', 's.shipped_at', 'datetime'), c('delivered_at', 'ส่งถึง', 's.delivered_at', 'datetime'),
      c('cancelled_at', 'ยกเลิก', 's.cancelled_at', 'datetime'), c('created_at', 'สร้างเมื่อ', 's.created_at', 'datetime')],
    search: ['s.shipment_number', 'o.order_number', 'co.name'], status: 's.status::text', order: 's.created_at',
  },
  payments: {
    title: 'รายการชำระเงิน', joshPage: 'orders/PaymentTransactions',
    from: 'payment_transactions t LEFT JOIN orders o ON o.orders_id = t.order_id LEFT JOIN company co ON co.id = o.company_id',
    columns: [c('id', 'id', 't.id', 'code'), c('order_number', 'Order', 'o.order_number', 'code'), COMPANY,
      c('payment_method', 'วิธีจ่าย', 't.payment_method'), c('gateway_provider', 'ผู้ให้บริการ', 't.gateway_provider'),
      c('amount', 'ยอด', 't.amount::float', 'money'), c('currency', 'สกุล', 't.currency'), c('status', 'สถานะ', 't.status::text', 'status'),
      c('is_test', 'ทดสอบ', 't.is_test', 'bool'), c('gateway_charge_id', 'charge id', 't.gateway_charge_id', 'code'),
      c('paid_at', 'จ่ายเมื่อ', 't.paid_at', 'datetime'), c('created_at', 'สร้างเมื่อ', 't.created_at', 'datetime')],
    search: ['o.order_number', 't.gateway_charge_id', 'co.name'], status: 't.status::text', order: 't.created_at',
  },
  coupons: {
    title: 'Coupons', joshPage: 'coupon',
    from: 'coupons cp LEFT JOIN campaigns cg ON cg.id = cp.campaign_id',
    columns: [c('id', 'id', 'cp.id', 'code'), c('coupon_code', 'โค้ด', 'cp.coupon_code', 'code'), c('title', 'ชื่อ', 'cp.title'), c('campaign_name', 'แคมเปญ', 'cg.name'),
      c('coupon_type', 'ประเภท', 'cp.coupon_type'), c('distribution_type', 'แจกแบบ', 'cp.distribution_type'), c('discount_type', 'ลดแบบ', 'cp.discount_type'),
      c('discount_value', 'ส่วนลด', 'cp.discount_value::float', 'number'), c('minimum_order_amount', 'ขั้นต่ำ', 'cp.minimum_order_amount::float', 'money'),
      c('maximum_discount_amount', 'ลดสูงสุด', 'cp.maximum_discount_amount::float', 'money'), c('usage_type', 'ใช้ได้', 'cp.usage_type'),
      c('user_limit', 'ต่อคน', 'cp.user_limit', 'number'), c('global_limit', 'รวม', 'cp.global_limit', 'number'),
      c('global_used_count', 'ใช้ไป', 'cp.global_used_count', 'number'),
      c('used_count', 'ใช้จริง (order)', "(SELECT count(*)::int FROM coupon_usages u WHERE u.coupon_id = cp.id AND u.status = 'used')", 'number'),
      c('start_date', 'เริ่ม', 'cp.start_date', 'datetime'), c('end_date', 'สิ้นสุด', 'cp.end_date', 'datetime'),
      c('is_active', 'เปิด', 'cp.is_active', 'bool'), c('status', 'สถานะ', 'cp.status::text', 'status')],
    search: ['cp.coupon_code', 'cp.title', 'cg.name'], status: 'cp.status::text', order: 'cp.created_at',
  },
  campaigns: {
    title: 'Campaigns', joshPage: 'campaign/CampaignList',
    from: 'campaigns cg',
    columns: [c('id', 'id', 'cg.id', 'code'), c('name', 'ชื่อ', 'cg.name'), c('start_at', 'เริ่ม', 'cg.start_at', 'datetime'), c('end_at', 'สิ้นสุด', 'cg.end_at', 'datetime'),
      c('is_active', 'เปิด', 'cg.is_active', 'bool'), c('state', 'ตอนนี้', "CASE WHEN NOT cg.is_active THEN 'inactive' WHEN now() < cg.start_at THEN 'upcoming' WHEN now() > cg.end_at THEN 'ended' ELSE 'running' END", 'status'),
      c('coupon_count', 'คูปอง', '(SELECT count(*)::int FROM coupons x WHERE x.campaign_id = cg.id)', 'number'), c('created_at', 'สร้างเมื่อ', 'cg.created_at', 'datetime')],
    search: ['cg.name'], status: "CASE WHEN NOT cg.is_active THEN 'inactive' WHEN now() < cg.start_at THEN 'upcoming' WHEN now() > cg.end_at THEN 'ended' ELSE 'running' END", order: 'cg.start_at',
  },
  segments: {
    title: 'Segments', joshPage: 'segment/SegmentList',
    from: 'user_segments sg',
    columns: [c('slug', 'slug', 'sg.slug', 'code'), c('name', 'ชื่อ', 'sg.name'), c('rule_type', 'กฎ', 'sg.rule_type'), c('priority', 'ลำดับ', 'sg.priority', 'number'),
      c('is_active', 'เปิด', 'sg.is_active', 'bool'), c('member_count', 'สมาชิก', 'sg.member_count', 'number'),
      c('frozen_at', 'ตรึงรายชื่อเมื่อ', 'sg.frozen_at', 'datetime'), c('updated_at', 'แก้ไขล่าสุด', 'sg.updated_at', 'datetime')],
    search: ['sg.slug', 'sg.name'], status: "CASE WHEN sg.is_active THEN 'active' ELSE 'inactive' END", order: 'sg.updated_at',
  },
  suppliers: {
    title: 'Suppliers', joshPage: 'supplier/SupplierList',
    from: 'supplier sp',
    columns: [c('supplier_id', 'id', 'sp.supplier_id', 'code'), c('supplier_name', 'ชื่อ', 'sp.supplier_name'), c('contact_name', 'ผู้ติดต่อ', 'sp.contact_name'),
      c('phone', 'โทร', 'sp.phone', 'phone'), c('email', 'อีเมล', 'sp.email', 'email'), c('address', 'ที่อยู่', 'sp.address'),
      c('created_at', 'เพิ่มเมื่อ', 'sp.created_at', 'datetime')],
    search: ['sp.supplier_name'], order: 'sp.created_at',
  },
  internal_docs: {
    title: 'เอกสารภายใน (docs-web)', joshPage: 'internal-docs/library',
    from: 'uploaded_internal_docs d',
    columns: [c('id', 'id', 'd.id', 'code'), c('category', 'หมวด', 'd.category', 'status'), c('title', 'ชื่อ', 'd.title'),
      c('original_filename', 'ไฟล์', 'd.original_filename', 'code'), c('size', 'ขนาด (ตัวอักษร)', 'length(d.content)', 'number'),
      c('updated_at', 'แก้ล่าสุด', 'd.updated_at', 'datetime')],
    search: ['d.title', 'd.original_filename'], status: 'd.category', order: 'd.updated_at',
  },
  admin_access: {
    title: 'คำขอเข้า admin', joshPage: 'admin-access/AdminAccessQueue',
    from: 'admin_access_request r',
    // password_hash is never selected.
    columns: [c('id', 'id', 'r.id', 'code'), c('email', 'อีเมล', 'r.email', 'email'), c('first_name', 'ชื่อ', 'r.first_name'), c('last_name', 'นามสกุล', 'r.last_name'),
      c('mobile_phone', 'โทร', 'r.mobile_phone', 'phone'), c('status', 'สถานะ', 'r.status', 'status'), c('reject_reason', 'เหตุผลที่ไม่อนุมัติ', 'r.reject_reason'),
      c('reviewed_at', 'พิจารณาเมื่อ', 'r.reviewed_at', 'datetime'), c('created_at', 'ขอเมื่อ', 'r.created_at', 'datetime')],
    search: ['r.email', 'r.first_name', 'r.last_name'], status: 'r.status', order: 'r.created_at',
    mask: (row) => ({ ...row, ...maskPersonName(row.first_name as string, row.last_name as string) }),
  },
};

/** Masks by column kind, then the view's own masking. Exported for the spec. */
export function maskRow(view: View, row: Record<string, unknown>) {
  const out = { ...row };
  for (const col of view.columns) {
    if (col.kind === 'phone') out[col.key] = maskPhone(out[col.key] as string);
    if (col.kind === 'email') out[col.key] = maskEmail(out[col.key] as string);
  }
  return view.mask ? view.mask(out) : out;
}

export function backofficeQuery(view: View, f: { search?: string; status?: string }) {
  const params: unknown[] = [];
  const w: string[] = [];
  const s = f.search?.trim().slice(0, 100);
  if (s && view.search?.length) { params.push(`%${s}%`); w.push(`(${view.search.map((e) => `${e} ILIKE $1`).join(' OR ')})`); }
  if (f.status) {
    if (!view.status) throw new BadRequestException('this list has no status');
    if (!/^[A-Za-z_]{1,40}$/.test(f.status)) throw new BadRequestException('status must be a status name');
    params.push(f.status); w.push(`${view.status} = $${params.length}`);
  }
  return { where: w.length ? `WHERE ${w.join(' AND ')}` : '', params };
}

@Injectable()
export class JoshBackoffice {
  constructor(private readonly replica: JoshReplica) {}

  get available() { return this.replica.configured; }

  views() {
    return Object.entries(BACKOFFICE_VIEWS).map(([key, v]) => ({ key, title: v.title, joshPage: v.joshPage, hasStatus: !!v.status }));
  }

  private view(key: string) {
    const v = BACKOFFICE_VIEWS[key];
    if (!v) throw new NotFoundException(`unknown list "${key}" — one of: ${Object.keys(BACKOFFICE_VIEWS).join(', ')}`);
    return v;
  }

  /** Stable, read-only payment identity lookup. Replica freshness is not settlement evidence. */
  async paymentDetail(id: string) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new BadRequestException('invalid payment identifier');
    if (!this.available) throw new ServiceUnavailableException('Payment replica is unavailable.');
    const v = BACKOFFICE_VIEWS.payments;
    const select = v.columns.map(col => `${col.sql} AS "${col.key}"`).join(', ');
    let rows: Record<string, unknown>[];
    try {
      rows = await this.replica.query<Record<string, unknown>>(`SELECT ${select}, t.order_id AS "order_id" FROM ${v.from} WHERE t.id::text = $1 LIMIT 1`, [id]);
    } catch {
      throw new ServiceUnavailableException('Payment replica read failed.');
    }
    if (!rows.length) throw new NotFoundException('Payment record not found in the replica.');
    return { source: 'josh_replica', freshness: 'unavailable', capturedAt: new Date().toISOString(), record: { ...maskRow(v, rows[0]), customer_name: rows[0].company_name } };
  }

  async list(key: string, f: { search?: string; status?: string }, page = 1, limit = 50) {
    const v = this.view(key);
    const { where, params } = backofficeQuery(v, f);
    const n = params.length;
    const select = v.columns.map((col) => `${col.sql} AS "${col.key}"`).join(', ');
    const [rows, [{ total }], byStatus] = await Promise.all([
      this.replica.query<Record<string, unknown>>(`SELECT ${select} FROM ${v.from} ${where} ORDER BY ${v.order} DESC NULLS LAST LIMIT $${n + 1} OFFSET $${n + 2}`, [...params, limit, (page - 1) * limit]),
      this.replica.query<{ total: number }>(`SELECT count(*)::int AS total FROM ${v.from} ${where}`, params),
      // Status counts ignore the status filter itself, so the tabs keep showing every status.
      v.status ? (() => { const q = backofficeQuery(v, { search: f.search }); return this.replica.query(`SELECT ${v.status} AS status, count(*)::int AS n FROM ${v.from} ${q.where} GROUP BY 1 ORDER BY 2 DESC`, q.params); })() : Promise.resolve([]),
    ]);
    return {
      key, title: v.title, joshPage: v.joshPage,
      columns: v.columns.map(({ key: k, label, kind }) => ({ key: k, label, kind })),
      byStatus, items: rows.map((r) => maskRow(v, r)), total, page, limit,
    };
  }
}
