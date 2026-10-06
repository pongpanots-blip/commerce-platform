// apps/backend/src/app/winback/import.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { JoshUser as User } from './josh-replica-tables';
import { MatchingService } from './matching.service';
import {
  classifyImportRow,
  MatchResult,
  normalizeCustomerCode,
  parseImportCsv,
  ParsedImportRow,
} from './winback.helpers';
import { WinbackHealth, WinbackSource, WinbackStage } from './winback.enums';
import { lifecycleAtCapture, promoteIfRegistered } from './lifecycle.helpers';

export interface PreviewRow extends ParsedImportRow, MatchResult {
  normalized_code: string;
  bucket: 'matched' | 'ambiguous' | 'new';
}

export interface CommitRow {
  customer_code: string;
  display_name?: string | null;
  phone?: string | null;
  register_number?: string | null;
  lifetime_spend_hint?: number | null;
  josh_user_id?: string | null;
  josh_company_id?: string | null;
}

@Injectable()
export class ImportService {
  constructor(
    @InjectRepository(WinbackAccount)
    private readonly accounts: Repository<WinbackAccount>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly matching: MatchingService,
  ) {}

  async preview(csv: string): Promise<{
    matched: PreviewRow[];
    ambiguous: PreviewRow[];
    new: PreviewRow[];
    errors: { line: number; message: string }[];
  }> {
    const { rows, errors } = parseImportCsv(csv);
    const out = { matched: [] as PreviewRow[], ambiguous: [] as PreviewRow[], new: [] as PreviewRow[], errors };

    for (const row of rows) {
      const normalized = normalizeCustomerCode(row.customer_code);
      let match = await this.matching.matchByCode(normalized);
      let byRegisterOnly = false;
      if (match.matchCount === 0 && row.register_number) {
        const reg = await this.matching.matchByRegisterNumber(row.register_number);
        if (reg.matchCount > 0) {
          match = reg;
          byRegisterOnly = true;
        }
      }
      const bucket = classifyImportRow(match, byRegisterOnly);
      const previewRow: PreviewRow = { ...row, ...match, normalized_code: normalized, bucket };
      out[bucket].push(previewRow);
    }
    return out;
  }

  async commit(rows: CommitRow[]): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    for (const row of rows) {
      const code = normalizeCustomerCode(row.customer_code);
      if (!code) continue;
      const existing = await this.accounts.findOne({ where: { customer_code: code } });
      if (existing) {
        existing.display_name = row.display_name ?? existing.display_name;
        existing.phone = row.phone ?? existing.phone;
        existing.register_number = row.register_number ?? existing.register_number;
        existing.lifetime_spend_hint = row.lifetime_spend_hint ?? existing.lifetime_spend_hint;
        existing.josh_user_id = row.josh_user_id ?? existing.josh_user_id;
        existing.josh_company_id = row.josh_company_id ?? existing.josh_company_id;
        existing.source =
          existing.source === WinbackSource.JOSH ? WinbackSource.BOTH : existing.source;
        const user = existing.josh_user_id
          ? await this.users.findOne({
              where: { id: existing.josh_user_id },
              select: ['id', 'last_app_login_at'],
            })
          : null;
        promoteIfRegistered(existing, { lastAppLoginAt: user?.last_app_login_at ?? null });
        await this.accounts.save(existing);
        updated++;
      } else {
        const joshUserId = row.josh_user_id ?? null;
        await this.accounts.save(
          this.accounts.create({
            customer_code: code,
            display_name: row.display_name ?? null,
            phone: row.phone ?? null,
            register_number: row.register_number ?? null,
            lifetime_spend_hint: row.lifetime_spend_hint ?? null,
            josh_user_id: joshUserId,
            josh_company_id: row.josh_company_id ?? null,
            source: WinbackSource.IMPORT,
            health: WinbackHealth.DORMANT,
            stage: WinbackStage.INACTIVE_POOL,
            lifecycle: lifecycleAtCapture(),
            promoted_to_lead_at: null,
            inactive_days: 0,
          }),
        );
        created++;
      }
    }
    return { created, updated };
  }
}
