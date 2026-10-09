import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JoshUser as User } from './josh-copies.entity';
import { JoshOrder as Order } from './josh-copies.entity';
import { JoshCompany as Company } from './josh-copies.entity';
import {
  MatchResult,
  normalizeCustomerCode,
  normalizeRegisterNumber,
} from './winback.helpers';
import { JoshMatchSignalKey } from './josh-match.helpers';

const EMPTY_MATCH: MatchResult = { josh_user_id: null, josh_company_id: null, matchCount: 0 };

@Injectable()
export class MatchingService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
  ) {}

  /**
   * Resolve a normalized customer_code to a Josh user/company.
   * Precedence: users.custcode -> users.legacy_custcode -> orders.customer_code -> unlinked.
   * matchCount > 1 means the code maps to multiple distinct users (ambiguous).
   */
  async matchByCode(normalizedCode: string): Promise<MatchResult> {
    const code = normalizeCustomerCode(normalizedCode);
    if (!code) return { ...EMPTY_MATCH };

    const matched = await this.users
      .createQueryBuilder('u')
      .select(['u.id AS id', 'u.company_id AS company_id'])
      .where('UPPER(TRIM(u.custcode)) = :code', { code })
      .orWhere('UPPER(TRIM(u.legacy_custcode)) = :code', { code })
      .getRawMany<{ id: string; company_id: string | null }>();

    if (matched.length >= 1) {
      return {
        josh_user_id: matched.length === 1 ? matched[0].id : null,
        josh_company_id: matched.length === 1 ? matched[0].company_id : null,
        matchCount: matched.length,
      };
    }

    // No user row, but historical orders may exist for this code.
    const orderExists = await this.orders
      .createQueryBuilder('o')
      .where('UPPER(TRIM(o.customer_code)) = :code', { code })
      .getExists();

    return {
      josh_user_id: null,
      josh_company_id: null,
      matchCount: orderExists ? 1 : 0,
    };
  }

  /**
   * Match Thai tax / company registration number → Josh company → user.
   * Uses `company.register_number` (digits-only compare).
   */
  async matchByRegisterNumber(register: string): Promise<MatchResult> {
    const tax = normalizeRegisterNumber(register);
    if (!tax || tax.length < 10) return { ...EMPTY_MATCH };

    const companies = await this.companies
      .createQueryBuilder('c')
      .select(['c.id AS id'])
      .where('c.register_number IS NOT NULL')
      .andWhere("TRIM(c.register_number) <> ''")
      .andWhere(`regexp_replace(c.register_number, '[^0-9]', '', 'g') = :tax`, { tax })
      .getRawMany<{ id: string }>();

    if (companies.length === 0) return { ...EMPTY_MATCH };
    if (companies.length > 1) {
      return { josh_user_id: null, josh_company_id: null, matchCount: companies.length };
    }

    const companyId = companies[0].id;
    const users = await this.users
      .createQueryBuilder('u')
      .select(['u.id'])
      .where('u.company_id = :companyId', { companyId })
      .orderBy('u.created_at', 'ASC')
      .take(5)
      .getMany();

    // Unique company tax match = app registered; pick earliest user when present.
    return {
      josh_user_id: users[0]?.id ?? null,
      josh_company_id: companyId,
      matchCount: 1,
    };
  }
}

/** One hit of one signal: account → Josh customer (user and/or company). */
export type JoshMatchHit = {
  account_id: string;
  key: JoshMatchSignalKey;
  user_id: string | null;
  company_id: string | null;
};

/**
 * Company-name key, the same expression on both sides so they normalise identically:
 * lower-case, legal-form words dropped (บริษัท … จำกัด (มหาชน), Co., Ltd.), spaces and punctuation dropped.
 */
const NAME_KEY = (col: string) =>
  `regexp_replace(regexp_replace(lower(${col}), '(บริษัท|จำกัด|มหาชน|ห้างหุ้นส่วน|หจก)|\\m(co|ltd|limited|company|inc|corp)\\M', '', 'g'), '[[:space:][:punct:]]', '', 'g')`;

/**
 * Batch evidence for `JoshMatchService`: every Josh customer each account's customer code,
 * tax / registration / ID-card number, e-mail (account + contacts) or company name points at.
 * Customers only — staff rows of the `josh_users` view are never candidates.
 */
@Injectable()
export class JoshMatchLookup {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async hits(accountIds: string[]): Promise<JoshMatchHit[]> {
    if (!accountIds.length) return [];
    const q = (sql: string) => this.users.manager.query(sql, [accountIds]) as Promise<Omit<JoshMatchHit, 'key'>[]>;
    const [byCode, byTax, byEmail, byName] = await Promise.all([
      q(`SELECT a.id AS account_id, jc.id AS user_id, NULLIF(jc.data->>'company_id', '') AS company_id
         FROM winback_account a
         JOIN josh_customers jc ON jc.deleted_at IS NULL
          AND UPPER(TRIM(a.customer_code)) IN (UPPER(TRIM(jc.data->>'custcode')), UPPER(TRIM(jc.data->>'legacy_custcode')))
         WHERE a.id = ANY($1::uuid[])`),
      q(`WITH t AS (
           SELECT DISTINCT a.id, regexp_replace(v, '\\D', '', 'g') AS tax
           FROM winback_account a, unnest(ARRAY[a.company_registration_num, a.register_number, a.id_card_number]) v
           WHERE a.id = ANY($1::uuid[]) AND v IS NOT NULL)
         SELECT t.id AS account_id, c.id::text AS company_id, jc.id AS user_id
         FROM t
         JOIN josh_companies c ON regexp_replace(c.register_number, '\\D', '', 'g') = t.tax
         LEFT JOIN josh_customers jc ON jc.deleted_at IS NULL AND jc.data->>'company_id' = c.id::text
         WHERE length(t.tax) >= 10`),
      q(`WITH e AS (
           SELECT id AS account_id, LOWER(TRIM(email)) AS email FROM winback_account WHERE id = ANY($1::uuid[]) AND email IS NOT NULL
           UNION
           SELECT account_id, LOWER(TRIM(email)) FROM winback_contact WHERE account_id = ANY($1::uuid[]) AND email IS NOT NULL)
         SELECT e.account_id, jc.id AS user_id, NULLIF(jc.data->>'company_id', '') AS company_id
         FROM e JOIN josh_customers jc ON jc.deleted_at IS NULL AND LOWER(TRIM(jc.data->>'email')) = e.email
         WHERE e.email LIKE '%_@_%'`),
      q(`WITH n AS (
           SELECT DISTINCT a.id, ${NAME_KEY('v')} AS k
           FROM winback_account a, unnest(ARRAY[a.company_name, a.restaurant_name, a.display_name]) v
           WHERE a.id = ANY($1::uuid[]) AND v IS NOT NULL),
         c AS (SELECT id, ${NAME_KEY('name')} AS k FROM josh_companies WHERE name IS NOT NULL)
         SELECT DISTINCT n.id AS account_id, c.id::text AS company_id, NULL::uuid AS user_id
         FROM n JOIN c ON c.k = n.k
         WHERE length(n.k) >= 3`),
    ]);
    const tag = (rows: Omit<JoshMatchHit, 'key'>[], key: JoshMatchSignalKey) => rows.map((r) => ({ ...r, key }));
    return [
      ...tag(byCode, 'customer_code'),
      ...tag(byTax, 'register_number'),
      ...tag(byEmail, 'email'),
      ...tag(byName, 'company_name'),
    ];
  }

  async companyNames(ids: string[]): Promise<Map<string, string | null>> {
    if (!ids.length) return new Map();
    const rows: { id: string; name: string | null }[] = await this.users.manager.query(
      `SELECT id::text AS id, name FROM josh_companies WHERE id::text = ANY($1::text[])`,
      [ids],
    );
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
