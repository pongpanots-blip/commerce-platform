import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackContact } from './entities/winback-contact.entity';
import { JoshMatchLookup } from './matching.service';
import {
  JOSH_MATCH_STATUSES,
  JoshMatchSignal,
  JoshMatchSignalKey,
  JoshMatchStatus,
  JoshMatchVerdict,
  judgeJoshMatch,
} from './josh-match.helpers';
import { maskEmail, maskIdCardNumber, maskRegisterNumber } from './shared/pii.helper';

export type JoshMatchReport = JoshMatchVerdict & {
  account_id: string;
  customer_code: string;
  display_name: string | null;
  restaurant_place_id: string | null;
  lifecycle: string;
  assigned_sales_user_id: string | null;
  /** Names of every Josh company the report mentions, so a rep can recognise them. */
  company_names: Record<string, string | null>;
};

/** Enough rows for every lead captured from Market Explorer; beyond it the report says it is truncated. */
const ENRICH_REPORT_CAP = 5000;

type AccountRow = Pick<
  WinbackAccount,
  | 'id'
  | 'customer_code'
  | 'display_name'
  | 'restaurant_name'
  | 'company_name'
  | 'company_registration_num'
  | 'register_number'
  | 'id_card_number'
  | 'email'
  | 'josh_user_id'
  | 'josh_company_id'
  | 'restaurant_place_id'
  | 'lifecycle'
  | 'assigned_sales_user_id'
  | 'create_date'
>;

const ACCOUNT_COLUMNS: (keyof AccountRow)[] = [
  'id',
  'customer_code',
  'display_name',
  'restaurant_name',
  'company_name',
  'company_registration_num',
  'register_number',
  'id_card_number',
  'email',
  'josh_user_id',
  'josh_company_id',
  'restaurant_place_id',
  'lifecycle',
  'assigned_sales_user_id',
  'create_date',
];

/**
 * Checks whether a winback account — above all a lead captured from an enriched
 * Market Explorer place — is a real Josh customer, and whether its link agrees with
 * the evidence. Read-only: it never links or unlinks; a person acts on `found_not_linked`
 * / `mismatch` / `name_only`.
 */
@Injectable()
export class JoshMatchService {
  constructor(
    @InjectRepository(WinbackAccount) private readonly accounts: Repository<WinbackAccount>,
    @InjectRepository(WinbackContact) private readonly contacts: Repository<WinbackContact>,
    private readonly lookup: JoshMatchLookup,
  ) {}

  async checkAccount(id: string): Promise<JoshMatchReport> {
    const account = await this.accounts.findOne({ where: { id }, select: ACCOUNT_COLUMNS });
    if (!account) throw new NotFoundException('winback account not found');
    const [report] = await this.reports([account]);
    return report;
  }

  /**
   * Every account created from an enriched place (`restaurant_place_id` set), newest
   * first: counts per status over all of them, then one page of rows (optionally one status).
   */
  async enrichReport(q: { status?: JoshMatchStatus; limit?: number; offset?: number }) {
    const rows = await this.accounts.find({
      where: { restaurant_place_id: Not(IsNull()) },
      select: ACCOUNT_COLUMNS,
      order: { create_date: 'DESC', id: 'DESC' },
      take: ENRICH_REPORT_CAP + 1,
    });
    const truncated = rows.length > ENRICH_REPORT_CAP;
    const reports = await this.reports(rows.slice(0, ENRICH_REPORT_CAP));

    const counts = Object.fromEntries(JOSH_MATCH_STATUSES.map((s) => [s, 0])) as Record<JoshMatchStatus, number>;
    for (const r of reports) counts[r.status] += 1;

    const filtered = q.status ? reports.filter((r) => r.status === q.status) : reports;
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const offset = Math.max(q.offset ?? 0, 0);
    return {
      data: filtered.slice(offset, offset + limit),
      meta: { total: filtered.length, checked: reports.length, truncated, limit, offset, counts },
    };
  }

  private async reports(accounts: AccountRow[]): Promise<JoshMatchReport[]> {
    if (!accounts.length) return [];
    const ids = accounts.map((a) => a.id);
    const [hits, contactRows] = await Promise.all([
      this.lookup.hits(ids),
      this.contacts.find({ where: { account_id: In(ids), email: Not(IsNull()) }, select: ['account_id', 'email'] }),
    ]);
    const emailsByAccount = new Map<string, string[]>();
    for (const c of contactRows) {
      if (c.email?.trim()) emailsByAccount.set(c.account_id, [...(emailsByAccount.get(c.account_id) ?? []), c.email]);
    }

    const companyIds = new Set<string>();
    hits.forEach((h) => h.company_id && companyIds.add(h.company_id));
    accounts.forEach((a) => a.josh_company_id && companyIds.add(a.josh_company_id));
    const names = await this.lookup.companyNames([...companyIds]);

    return accounts.map((account) => {
      const mine = hits.filter((h) => h.account_id === account.id);
      const signals = SIGNAL_KEYS.flatMap((key): JoshMatchSignal[] => {
        const value = signalValue(key, account, emailsByAccount.get(account.id) ?? []);
        const of = mine.filter((h) => h.key === key);
        if (!value && !of.length) return [];
        return [
          {
            key,
            value,
            user_ids: unique(of.map((h) => h.user_id)),
            company_ids: unique(of.map((h) => h.company_id)),
          },
        ];
      });
      const verdict = judgeJoshMatch(
        { josh_user_id: account.josh_user_id, josh_company_id: account.josh_company_id },
        signals,
      );
      const mentioned = unique([
        account.josh_company_id,
        verdict.candidate?.josh_company_id ?? null,
        ...signals.flatMap((s) => s.company_ids),
      ]);
      return {
        account_id: account.id,
        customer_code: account.customer_code,
        display_name: account.display_name,
        restaurant_place_id: account.restaurant_place_id,
        lifecycle: account.lifecycle,
        assigned_sales_user_id: account.assigned_sales_user_id,
        ...verdict,
        company_names: Object.fromEntries(mentioned.map((id) => [id, names.get(id) ?? null])),
      };
    });
  }
}

const SIGNAL_KEYS: JoshMatchSignalKey[] = ['customer_code', 'register_number', 'email', 'company_name'];

function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

/** What the account offered for this signal, masked where it is PII. Empty = the signal was not tried. */
function signalValue(key: JoshMatchSignalKey, a: AccountRow, contactEmails: string[]): string {
  switch (key) {
    case 'customer_code':
      return a.customer_code ?? '';
    case 'register_number':
      return unique([
        maskRegisterNumber(a.company_registration_num),
        maskRegisterNumber(a.register_number),
        maskIdCardNumber(a.id_card_number),
      ]).join(', ');
    case 'email':
      return unique([a.email, ...contactEmails].map((e) => maskEmail(e))).join(', ');
    case 'company_name':
      return unique([a.company_name, a.restaurant_name, a.display_name].map((n) => n?.trim())).join(' / ');
  }
}
