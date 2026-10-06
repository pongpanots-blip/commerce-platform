import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { WinbackMeetingSignal } from '../winback.enums';

export class CreateMeetingAckDto {
  @IsUUID() account_id: string;

  /** Unknown values are rejected, not stored, so a client typo fails loudly. */
  @IsEnum(WinbackMeetingSignal) signal: WinbackMeetingSignal;

  /**
   * The appointment's activity id for `appointment_unlogged`, the stage name
   * for `stage_stalled`, omitted for lead-level signals. Whether it is required
   * depends on `signal`; that cross-field rule is enforced in the service.
   */
  @IsOptional() @IsString() @MaxLength(64) subject_id?: string | null;

  @IsISO8601() discussed_at: string;
}

export class MeetingAckQueryDto {
  /** Defaults to 8 weeks ago — the only window the meeting screen reads. */
  @IsOptional() @IsISO8601() since?: string;
}
