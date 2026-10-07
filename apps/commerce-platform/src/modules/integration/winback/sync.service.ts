// apps/backend/src/app/winback/sync.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackStageHistory } from './entities/winback-stage-history.entity';
import { SYNC_STAGE_ACTOR } from './meeting-prep.helpers';
import { JoshErpSalesHistory as ErpSalesHistory } from './josh-copies.entity';
import { JoshUser as User } from './josh-copies.entity';
import { MatchingService } from './matching.service';
import {
  buildUserIndex,
  normalizeCustomerCode,
  UserCodeRow,
  UserIndex,
} from './winback.helpers';
import { WinbackHealth, WinbackSource, WinbackStage } from './winback.enums';
import { lifecycleAtCapture, promoteIfRegistered } from './lifecycle.helpers';
import {
  buildCustomerBaselines,
  needsAttention,
  CustomerBaseline,
  LastOrderRow,
  OrderRow,
  WINBACK_BASELINE_EXTENDED_DAYS,
  WINBACK_INACTIVE_THRESHOLD_DAYS,
} from './reorder-baseline.helpers';

export { WINBACK_INACTIVE_THRESHOLD_DAYS };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Past this, the export is old enough that the signals need saying so out loud. */
const STALE_EXPORT_WARNING_DAYS = 30;

/** Rows per INSERT/UPDATE batch. Keeps one sync off thousands of round trips. */
const SAVE_CHUNK = 500;

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectRepository(WinbackAccount)
    private readonly accounts: Repository<WinbackAccount>,
    @InjectRepository(WinbackStageHistory)
    private readonly stageHistory: Repository<WinbackStageHistory>,
    @InjectRepository(ErpSalesHistory)
    private readonly erpSales: Repository<ErpSalesHistory>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly matching: MatchingService,
  ) {}

  /**
   * Refresh every customer's reorder baseline and pull the ones that are
   * slipping into the winback pool.
   *
   * Dormancy is relative to each customer's own cycle — a shop ordering every
   * 14 days is dormant at ~42, not at 180. `days` is only the fallback for
   * customers with too little history to have a cycle at all.
   *
   * Reads `erp_sales_history`, the real sales history (~554K invoice lines,
   * 9.5K customers). The `orders` table is Josh app orders — a few hundred rows
   * with mostly empty `customer_code`, which matched none of the winback pool.
   *
   * Every customer in the history is scored and pooled — nothing is filtered out
   * on the customer's behalf. Long-quiet shops rank lower and carry a
   * "low odds" line in their reasons, and the rep decides from there; they know
   * things the order table does not. Accounts already in the pool are never
   * removed.
   */
  async syncFromJosh(days = WINBACK_INACTIVE_THRESHOLD_DAYS): Promise<{
    scanned: number;
    created: number;
    updated: number;
    reactivated: number;
    data_as_of: string | null;
    data_age_days: number | null;
    /**
     * Customers quiet for longer than the eligibility window. They are scored
     * and pooled like everyone else — this is how many carry the low-odds hint.
     */
    not_winnable: number;
  }> {
    // `erp_sales_history` is a static export, not a live feed. Measuring
    // dormancy against the wall clock would add the export's age to every
    // customer uniformly — a 14-day cycle looks 5 cycles overdue from staleness
    // alone. Anchoring to the newest invoice keeps the reading to what the data
    // can actually support; `data_age_days` says how stale that is.
    const dataAsOf = await this.latestInvoiceDate();
    const wallClock = new Date();
    const now = dataAsOf ?? wallClock;
    const dataAgeDays = dataAsOf
      ? Math.floor((wallClock.getTime() - dataAsOf.getTime()) / MS_PER_DAY)
      : null;
    if (dataAgeDays != null && dataAgeDays > STALE_EXPORT_WARNING_DAYS) {
      this.logger.warn(
        `erp_sales_history is ${dataAgeDays} days old (newest invoice ` +
          `${dataAsOf!.toISOString().slice(0, 10)}). Signals are as of that date, ` +
          `not today — re-import before trusting the pool.`,
      );
    }

    // Two reads, both whole-table: the latest order per customer comes from ALL
    // history (a customer silent for 400 days has no rows in the baseline
    // window, and is exactly who this job is looking for), while the baseline
    // itself is built from the recent window only.
    const [lastOrders, windowRows] = await Promise.all([
      this.erpSales
        .createQueryBuilder('e')
        .select('UPPER(TRIM(e.cust_code))', 'customer_code')
        .addSelect('MAX(e.inv_date)', 'last_order_at')
        .addSelect('SUM(e.total)', 'lifetime_spend')
        // Province as of the LATEST invoice, not the most common one: a customer
        // that moved should show where they are now, not where they used to be.
        .addSelect(
          '(array_agg(e.del_province ORDER BY e.inv_date DESC) ' +
            'FILTER (WHERE e.del_province IS NOT NULL))[1]',
          'province',
        )
        .where("TRIM(e.cust_code) <> ''")
        .groupBy('UPPER(TRIM(e.cust_code))')
        .getRawMany<LastOrderRow>(),
      // Collapse invoice LINES to one row per customer per day before they ever
      // reach the baseline: a single order can be eighty lines, and counting
      // lines would turn every reorder interval into zero.
      this.erpSales
        .createQueryBuilder('e')
        .select('UPPER(TRIM(e.cust_code))', 'customer_code')
        .addSelect('e.inv_date', 'create_date')
        .addSelect('SUM(e.total)', 'total_price')
        .where("TRIM(e.cust_code) <> ''")
        .andWhere('e.inv_date >= :cutoff', {
          cutoff: this.isoDate(
            new Date(now.getTime() - WINBACK_BASELINE_EXTENDED_DAYS * MS_PER_DAY),
          ),
        })
        .groupBy('UPPER(TRIM(e.cust_code)), e.inv_date')
        .getRawMany<OrderRow>(),
    ]);

    const baselines = buildCustomerBaselines(windowRows, lastOrders, now, {
      fallbackDormantDays: days,
    });

    const notWinnable = [...baselines.values()].filter((b) => !b.winnable).length;

    // One read of the pool, keyed by code. The previous version ran a
    // MAX(create_date) query per account inside a loop.
    const existingByCode = new Map<string, WinbackAccount>();
    for (const account of await this.accounts.find()) {
      existingByCode.set(normalizeCustomerCode(account.customer_code), account);
    }

    // The ERP history holds ~9.5K customers, so anything per-account becomes
    // thousands of round trips. The users table is small enough to index once.
    const users = await this.userIndex();

    const toCreate: WinbackAccount[] = [];
    const toUpdate: WinbackAccount[] = [];
    const stageChanges: WinbackStageHistory[] = [];
    let reactivated = 0;

    for (const [code, baseline] of baselines) {
      const existing = existingByCode.get(code);

      if (!existing) {
        // Only at-risk and dormant customers belong in the pool. Healthy ones
        // are not winback's problem and would bury the ones that are.
        if (!needsAttention(baseline.health)) continue;
        toCreate.push(this.accounts.create(this.newAccount(code, baseline, users)));
        continue;
      }

      const wasSlipping =
        existing.health === WinbackHealth.WATCH || existing.health === WinbackHealth.DORMANT;

      this.applyBaseline(existing, baseline);
      await this.relink(existing, users);

      if (baseline.health) {
        // Genuinely at risk or dormant again — this must overwrite ACTIVE_AGAIN,
        // otherwise a customer we won back and then lost never returns to the pool.
        existing.health = baseline.health;
      } else if (wasSlipping) {
        // Back on cycle after having slipped: a reactivation, measured from real
        // orders rather than from a stage the rep moved by hand.
        const fromStage = existing.stage;
        existing.health = WinbackHealth.ACTIVE_AGAIN;
        existing.stage = WinbackStage.ORDERING_AGAIN;
        existing.reactivated_at = now;
        if (fromStage !== existing.stage) {
          stageChanges.push(
            this.stageHistory.create({
              account_id: existing.id,
              from_stage: fromStage,
              to_stage: existing.stage,
              changed_by: this.stageActor(existing),
              changed_at: now,
              note: 'Josh sync: customer reactivated',
            }),
          );
        }
        reactivated++;
      }
      // else: healthy and was healthy — leave health untouched, including a
      // previously recorded ACTIVE_AGAIN win.

      toUpdate.push(existing);
    }

    await this.accounts.save(toCreate, { chunk: SAVE_CHUNK });
    await this.accounts.save(toUpdate, { chunk: SAVE_CHUNK });
    if (stageChanges.length) {
      await this.stageHistory.save(stageChanges, { chunk: SAVE_CHUNK });
    }

    const created = toCreate.length;
    const updated = toUpdate.length;

    return {
      scanned: baselines.size,
      created,
      updated,
      reactivated,
      data_as_of: dataAsOf ? this.isoDate(dataAsOf) : null,
      data_age_days: dataAgeDays,
      not_winnable: notWinnable,
    };
  }

  /** Copy the computed order behaviour onto an account. Never touches health. */
  private applyBaseline(account: WinbackAccount, baseline: CustomerBaseline): void {
    account.last_order_at = baseline.last_order_at;
    account.inactive_days = baseline.inactive_days;
    account.lifetime_spend_hint = baseline.lifetime_spend_hint;
    account.median_reorder_interval_days = baseline.median_reorder_interval_days;
    account.delay_ratio = baseline.delay_ratio;
    account.order_count_365d = baseline.order_count_365d;
    account.avg_monthly_revenue = baseline.avg_monthly_revenue;
    // Only ever fills a gap: a rep may have corrected this by hand.
    account.province = account.province ?? baseline.province;
  }

  private newAccount(
    code: string,
    baseline: CustomerBaseline,
    users: UserIndex,
  ): Partial<WinbackAccount> {
    const link = users.matchByCode(code);
    return {
      customer_code: code,
      source: WinbackSource.JOSH,
      josh_user_id: link.josh_user_id,
      josh_company_id: link.josh_company_id,
      last_order_at: baseline.last_order_at,
      lifetime_spend_hint: baseline.lifetime_spend_hint,
      inactive_days: baseline.inactive_days,
      median_reorder_interval_days: baseline.median_reorder_interval_days,
      delay_ratio: baseline.delay_ratio,
      order_count_365d: baseline.order_count_365d,
      avg_monthly_revenue: baseline.avg_monthly_revenue,
      province: baseline.province,
      health: baseline.health ?? WinbackHealth.DORMANT,
      stage: WinbackStage.INACTIVE_POOL,
      lifecycle: lifecycleAtCapture(),
      promoted_to_lead_at: null,
    };
  }

  /** Re-attach Josh identities and re-check app registration. Unchanged behaviour. */
  private async relink(account: WinbackAccount, users: UserIndex): Promise<void> {
    const link = users.matchByCode(account.customer_code);
    account.josh_user_id = link.josh_user_id ?? account.josh_user_id;
    account.josh_company_id = link.josh_company_id ?? account.josh_company_id;
    if (!account.josh_user_id && !account.josh_company_id && account.register_number) {
      const byTax = await this.matching.matchByRegisterNumber(account.register_number);
      account.josh_user_id = byTax.josh_user_id ?? account.josh_user_id;
      account.josh_company_id = byTax.josh_company_id ?? account.josh_company_id;
    }
    account.source =
      account.source === WinbackSource.IMPORT ? WinbackSource.BOTH : account.source;

    promoteIfRegistered(account, {
      lastAppLoginAt: account.josh_user_id
        ? users.lastAppLoginAt(account.josh_user_id)
        : null,
    });
  }

  /** One pass over the users table; see `buildUserIndex`. */
  private async userIndex(): Promise<UserIndex> {
    return buildUserIndex(
      await this.users
        .createQueryBuilder('u')
        .select([
          'u.id AS id',
          'u.company_id AS company_id',
          'u.custcode AS custcode',
          'u.legacy_custcode AS legacy_custcode',
          'u.last_app_login_at AS last_app_login_at',
        ])
        .getRawMany<UserCodeRow>(),
    );
  }

  /** Newest invoice in the export — the clock every signal is measured against. */
  private async latestInvoiceDate(): Promise<Date | null> {
    const row = await this.erpSales
      .createQueryBuilder('e')
      .select('MAX(e.inv_date)', 'max')
      .getRawOne<{ max: string | null }>();
    if (!row?.max) return null;
    const date = new Date(row.max);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /** `inv_date` is a SQL `date`; compare against `YYYY-MM-DD`, not a timestamp. */
  private isoDate(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private stageActor(account: WinbackAccount): string {
    return (
      account.assigned_sales_user_id ??
      account.created_by_sales_user_id ??
      SYNC_STAGE_ACTOR
    );
  }
}
