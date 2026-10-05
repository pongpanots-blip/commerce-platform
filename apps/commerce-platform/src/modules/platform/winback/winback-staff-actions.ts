import { ForbiddenException, Injectable, ParseUUIDPipe, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { IsOptional, IsUUID, validate, ValidateIf } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { JoshReplica } from '../../integration/connector/josh/josh-replica';
import { ActivityService } from './activity.service';
import { AnalyticsService } from './analytics.service';
import { MoveStageDto } from './dto/move-stage.dto';
import { UpsertTargetDto } from './dto/upsert-target.dto';
import { LeadService } from './lead.service';
import { isWinbackManager } from './winback-roles';

/** Assignment only — the commerce-admin side never edits a lead's details or PII (josh CommerceWinbackActionsController). */
class AssignLeadDto {
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsUUID() assigned_sales_user_id!: string | null;
}

async function toDto<T extends object>(cls: new () => T, value: unknown): Promise<T> {
  const dto = plainToInstance(cls, value ?? {});
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) throw new BadRequestException(errors.flatMap((e) => Object.values(e.constraints ?? {})));
  return dto;
}

/**
 * The commerce-admin winback buttons (assign, move stage, set target) once commerce runs winback:
 * josh's CommerceWinbackActionsController, here — the same services and rules, acting as the josh
 * staff user with the commerce staff member's email (active, internal role; read on the replica).
 */
@Injectable()
export class WinbackStaffActions {
  constructor(
    private readonly replica: JoshReplica,
    private readonly leads: LeadService,
    private readonly activities: ActivityService,
    private readonly analytics: AnalyticsService,
  ) {}

  async act(action: 'assign' | 'move_stage' | 'set_target', args: Record<string, unknown>, email: string) {
    const actor = await this.actor(email);
    const accountId = () => new ParseUUIDPipe().transform(String(args.accountId ?? ''), { type: 'body' });
    switch (action) {
      case 'assign': {
        const dto = await toDto(AssignLeadDto, { assigned_sales_user_id: args.assignedSalesUserId ?? null });
        return this.leads.update(await accountId(), dto as never, { salesUserId: actor.id, role: actor.role });
      }
      case 'move_stage': {
        const { accountId: _id, ...rest } = args;
        const dto = await toDto(MoveStageDto, rest);
        return this.activities.moveStage(await accountId(), actor.id, dto.stage, { note: dto.note, rejectReason: dto.reject_reason, rejectNote: dto.reject_note });
      }
      case 'set_target': {
        const dto = await toDto(UpsertTargetDto, args);
        return this.analytics.upsertTarget(dto, actor.id, isWinbackManager(actor.role));
      }
    }
  }

  private async actor(email: string): Promise<{ id: string; role: string }> {
    if (!this.replica.configured) throw new ServiceUnavailableException('josh replica is not configured (JOSH_DATABASE_URL)');
    const [user] = await this.replica.query<{ id: string; role: string }>(
      `SELECT u.id, u.role FROM users u JOIN app_roles r ON r.code = u.role AND r.user_type = 'internal'
        WHERE lower(u.email) = lower($1) AND u.is_active = true LIMIT 1`, [email]);
    if (!user) throw new ForbiddenException(`no active josh staff user with the email ${email}`);
    return user;
  }
}
