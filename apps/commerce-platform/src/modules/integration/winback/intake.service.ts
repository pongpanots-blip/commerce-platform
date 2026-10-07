import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackContact } from './entities/winback-contact.entity';
import { BrevoEmailService } from './shared/brevo-email.service';
import { IntakeLeadDto } from './dto/intake-lead.dto';
import {
  WinbackContactTeam,
  WinbackCustomerType,
  WinbackHealth,
  WinbackLeadSource,
  WinbackLifecycle,
  WinbackSource,
  WinbackStage,
} from './winback.enums';

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Unique code for an intake row: `TMP-<base36 ms><4 random>`.
 *
 * customer_code is uniquely indexed (uq_winback_customer_code) and intake never
 * dedupes, so LeadService's `LEAD-<phone>` scheme cannot be reused — it would
 * collide on the second submission from the same number.
 */
export function generateTmpCustomerCode(now: Date = new Date()): string {
  const stamp = now.getTime().toString(36).toUpperCase();
  let suffix = '';
  for (let i = 0; i < 4; i += 1) {
    suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `TMP-${stamp}${suffix}`;
}

type CuisineRow = { id: string; parent_id: string | null; cuisine_name: string };

type ResolvedCuisine = {
  cuisine_id: string | null;
  cuisine_name: string | null;
  cuisine_parent_id: string | null;
  cuisine_parent_name: string | null;
};

export interface IntakeLeadResult {
  id: string;
  customer_code: string;
  lifecycle: string;
  stage: string;
}

/** Creates tmp leads pushed in by external systems (public signup forms). */
@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    @InjectRepository(WinbackAccount)
    private readonly accounts: Repository<WinbackAccount>,
    @InjectRepository(WinbackContact)
    private readonly contacts: Repository<WinbackContact>,
    // commerce: cuisine is a josh table — read on commerce's copy (josh_cuisines).
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly brevoEmail: BrevoEmailService,
  ) {}

  async createTmpLead(dto: IntakeLeadDto): Promise<IntakeLeadResult> {
    const cuisine = await this.resolveCuisine(dto);

    const account = await this.accounts.save(
      this.accounts.create({
        customer_code: generateTmpCustomerCode(),
        display_name: dto.restaurant_name || dto.display_name,
        phone: dto.phone,
        source: WinbackSource.MANUAL,
        health: WinbackHealth.DORMANT,
        stage: WinbackStage.PROSPECT,
        lifecycle: WinbackLifecycle.TMP,
        assigned_sales_user_id: null,
        // Forms that don't ask (landing's contact form) are companies — it asks
        // for a company name and nothing else on the page suggests a walk-in.
        customer_type: dto.customer_type ?? WinbackCustomerType.B2B_COMPANY,
        lead_source: dto.lead_source ?? WinbackLeadSource.WEBSITE,
        company_name: dto.company_name ?? null,
        restaurant_name: dto.restaurant_name ?? null,
        address: dto.address ?? null,
        // Stamped here, never taken from the payload — a form can't decide when
        // it was agreed to.
        consent_at: dto.consent ? new Date() : null,
        email: dto.email ?? null,
        line_id: dto.line_id ?? null,
        ...cuisine,
      }),
    );

    // The account's display_name may be overwritten by restaurant_name above, so the
    // contact's name (the actual person submitting the form) has to be persisted
    // separately or it's lost entirely — see finding #2 of the intake code review.
    await this.contacts.save(
      this.contacts.create({
        account_id: account.id,
        team: WinbackContactTeam.OTHER,
        name: dto.display_name,
        mobile: dto.phone,
        email: dto.email ?? null,
        line_id: dto.line_id ?? null,
      }),
    );

    await this.sendWelcomeEmailSafe(dto);

    return {
      id: account.id,
      customer_code: account.customer_code,
      lifecycle: account.lifecycle,
      stage: account.stage,
    };
  }

  /** Welcome mail is best-effort — never fail intake because Brevo is down. */
  private async sendWelcomeEmailSafe(dto: IntakeLeadDto): Promise<void> {
    const email = dto.email?.trim();
    if (!email) return;

    try {
      await this.brevoEmail.sendWelcomeLeadEmail({
        toEmail: email,
        locale: dto.locale,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Welcome lead email failed for ${email}: ${message}`);
    }
  }

  /**
   * `cuisine` has no TypeORM entity — CuisineService reads it with raw SQL and
   * so do we. An explicit id wins over the free-text name.
   */
  private async resolveCuisine(dto: IntakeLeadDto): Promise<ResolvedCuisine> {
    if (!dto.cuisine_id) {
      return {
        cuisine_id: null,
        cuisine_name: dto.cuisine_name ?? null,
        cuisine_parent_id: null,
        cuisine_parent_name: null,
      };
    }

    const rows = (await this.dataSource.query(
      'SELECT id, parent_id, cuisine_name FROM josh_cuisines WHERE id = $1 AND is_active = TRUE LIMIT 1',
      [dto.cuisine_id],
    )) as CuisineRow[];
    const row = rows[0];
    if (!row) throw new BadRequestException('ไม่พบ cuisine_id นี้ในระบบ');

    let parentName: string | null = null;
    if (row.parent_id) {
      const parents = (await this.dataSource.query(
        'SELECT id, parent_id, cuisine_name FROM josh_cuisines WHERE id = $1 LIMIT 1',
        [row.parent_id],
      )) as CuisineRow[];
      parentName = parents[0]?.cuisine_name ?? null;
    }

    return {
      cuisine_id: row.id,
      cuisine_name: row.cuisine_name,
      cuisine_parent_id: row.parent_id,
      cuisine_parent_name: parentName,
    };
  }
}
