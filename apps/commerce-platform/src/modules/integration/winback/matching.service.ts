import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JoshUser as User } from './josh-replica-tables';
import { JoshOrder as Order } from './josh-replica-tables';
import { JoshCompany as Company } from './josh-replica-tables';
import {
  MatchResult,
  normalizeCustomerCode,
  normalizeRegisterNumber,
} from './winback.helpers';

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
