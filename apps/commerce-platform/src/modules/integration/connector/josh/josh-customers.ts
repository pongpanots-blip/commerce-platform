import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JoshReplica } from './josh-replica';
import { maskEmail, maskPersonName, maskPhone, maskRegisterNumber } from './winback/pii.helper';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * KYC from josh `kyc_document`: per company, the latest decision per document type.
 * Undecided → pending, decided with a reason → rejected, decided → approved.
 */
const KYC = `LEFT JOIN LATERAL (
    SELECT count(*)::int AS docs,
           count(*) FILTER (WHERE k.decided_at IS NULL)::int AS pending,
           count(*) FILTER (WHERE k.decided_at IS NOT NULL AND k.rejection_reason IS NOT NULL)::int AS rejected,
           count(*) FILTER (WHERE k.decided_at IS NOT NULL AND k.rejection_reason IS NULL)::int AS approved
      FROM kyc_document k WHERE k.company_id = c.id
  ) kyc ON TRUE`;
const KYC_STATUS = `CASE WHEN kyc.docs = 0 THEN 'none' WHEN kyc.pending > 0 THEN 'pending' WHEN kyc.rejected > 0 THEN 'rejected' ELSE 'approved' END`;

export const COMPANY_ISSUES = {
  kyc_pending: 'kyc.pending > 0',
  kyc_none: 'kyc.docs = 0',
  over_credit: 'c.credit_limit > 0 AND c.credit_used > c.credit_limit',
  near_credit: 'c.credit_limit > 0 AND c.credit_used >= c.credit_limit * 0.9 AND c.credit_used <= c.credit_limit',
  no_erp_code: `COALESCE(c.erp_customer_code, '') = ''`,
  credit_application_pending: `EXISTS (SELECT 1 FROM credit_term_applications a WHERE a.company_id = c.id AND a.status::text IN ('PENDING','REVIEW','REQUEST_DOC'))`,
} as const;

export interface CompanyFilters { search?: string; issue?: string }

export function companyWhere(f: CompanyFilters): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const w: string[] = [];
  const s = f.search?.trim().slice(0, 100);
  if (s) { params.push(`%${s}%`); w.push(`(c.name ILIKE $1 OR c.erp_customer_code ILIKE $1)`); }
  if (f.issue) {
    if (!(f.issue in COMPANY_ISSUES)) throw new BadRequestException(`issue must be one of: ${Object.keys(COMPANY_ISSUES).join(', ')}`);
    w.push(COMPANY_ISSUES[f.issue as keyof typeof COMPANY_ISSUES]);
  }
  return { where: w.length ? `WHERE ${w.join(' AND ')}` : '', params };
}

/**
 * josh customers (companies, branches, people), READ-ONLY from josh's replica. Identity
 * numbers, phones, emails and family names are masked exactly like josh's winback screens;
 * full values only through josh's audited PII reveal, which stays in josh.
 */
@Injectable()
export class JoshCustomers {
  constructor(private readonly replica: JoshReplica) {}

  get available() { return this.replica.configured; }

  async summary() {
    const issues = Object.entries(COMPANY_ISSUES).map(([k, cond]) => `count(*) FILTER (WHERE ${cond})::int AS ${k}`).join(', ');
    const [row] = await this.replica.query(`SELECT count(*)::int AS total, ${issues},
        COALESCE(sum(c.credit_limit), 0)::float AS credit_limit_total, COALESCE(sum(c.credit_used), 0)::float AS credit_used_total
      FROM company c ${KYC}`);
    return row;
  }

  async list(f: CompanyFilters, page = 1, limit = 50) {
    const { where, params } = companyWhere(f);
    const n = params.length;
    const [rows, [{ total }]] = await Promise.all([
      this.replica.query<Record<string, unknown>>(`SELECT c.id, c.name, c.erp_customer_code, c.register_number, c.business_type,
          c.credit_limit::float AS credit_limit, c.credit_used::float AS credit_used, c.credit_term_days, c.created_at,
          (SELECT count(*)::int FROM branch b WHERE b.company_id = c.id) AS branch_count,
          (SELECT count(*)::int FROM users u WHERE u.company_id = c.id AND u.is_active) AS user_count,
          ${KYC_STATUS} AS kyc_status, kyc.docs AS kyc_docs,
          (SELECT max(o.create_date) FROM orders o WHERE o.company_id = c.id) AS last_order_at
        FROM company c ${KYC} ${where} ORDER BY c.name LIMIT $${n + 1} OFFSET $${n + 2}`, [...params, limit, (page - 1) * limit]),
      this.replica.query(`SELECT count(*)::int AS total FROM company c ${KYC} ${where}`, params),
    ]);
    return { items: rows.map((r) => ({ ...r, register_number: maskRegisterNumber(r.register_number as string) })), total, page, limit };
  }

  async detail(id: string) {
    if (!UUID.test(id)) throw new BadRequestException('id must be a uuid');
    const [company] = await this.replica.query<Record<string, unknown>>(`SELECT c.id, c.name, c.erp_customer_code, c.register_number, c.business_type, c.phone,
        c.credit_limit::float AS credit_limit, c.credit_used::float AS credit_used, c.credit_term_days, c.credit_term_renews_at, c.document_language, c.created_at,
        ${KYC_STATUS} AS kyc_status FROM company c ${KYC} WHERE c.id = $1`, [id]);
    if (!company) throw new NotFoundException(`company ${id} not found in josh`);
    const [branches, users, kycDocs, credit, orders] = await Promise.all([
      this.replica.query<Record<string, unknown>>(`SELECT id, name, type::text AS type, erp_branch_code, erp_sync_status, is_default_delivery, is_out_of_area,
          delivery_days, credit_term, phone, tax_id FROM branch WHERE company_id = $1 ORDER BY is_default_delivery DESC NULLS LAST, name`, [id]),
      this.replica.query<Record<string, unknown>>(`SELECT id, first_name, last_name, email, mobile_phone, role, is_active, onboarding_completed, last_app_login_at, created_at
        FROM users WHERE company_id = $1 ORDER BY is_active DESC, created_at`, [id]),
      this.replica.query(`SELECT document_type::text AS document_type, created_at, decided_at, rejection_reason,
          CASE WHEN decided_at IS NULL THEN 'pending' WHEN rejection_reason IS NOT NULL THEN 'rejected' ELSE 'approved' END AS status
        FROM kyc_document WHERE company_id = $1 ORDER BY created_at DESC`, [id]),
      this.replica.query(`SELECT application_type::text AS application_type, status::text AS status, requested_credit_limit::float AS requested_credit_limit,
          requested_term_days, approved_credit_limit::float AS approved_credit_limit, approved_term_days, reject_reason, created_at, reviewed_at
        FROM credit_term_applications WHERE company_id = $1 ORDER BY created_at DESC LIMIT 10`, [id]),
      this.replica.query(`SELECT count(*)::int AS orders, COALESCE(sum(total_price) FILTER (WHERE status::text IN ('paid','preparing','shipped','delivered')), 0)::float AS paid_value,
          max(create_date) AS last_order_at FROM orders WHERE company_id = $1`, [id]),
    ]);
    return {
      ...company,
      register_number: maskRegisterNumber(company.register_number as string),
      phone: maskPhone(company.phone as string),
      branches: branches.map((b) => ({ ...b, phone: maskPhone(b.phone as string), tax_id: maskRegisterNumber(b.tax_id as string) })),
      users: users.map(({ first_name, last_name, email, mobile_phone, ...u }) => ({
        ...u, ...maskPersonName(first_name as string, last_name as string), email: maskEmail(email as string), mobile_phone: maskPhone(mobile_phone as string),
      })),
      kycDocuments: kycDocs, creditApplications: credit, orders: orders[0],
    };
  }
}
