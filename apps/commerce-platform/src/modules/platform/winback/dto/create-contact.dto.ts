import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { WINBACK_CONTACT_TEAMS } from '../winback.enums';

export class CreateContactDto {
  @IsIn(WINBACK_CONTACT_TEAMS) team: string;
  @IsString() @IsNotEmpty() @MaxLength(255) name: string;
  @IsString() @IsNotEmpty() @MaxLength(100) role_label: string;
  @IsString() @IsNotEmpty() @MaxLength(50) mobile: string;
  @IsString() @IsNotEmpty() @MaxLength(255) email: string;
  @IsString() @IsNotEmpty() @MaxLength(100) line_id: string;
  @IsOptional() @IsString() @MaxLength(50) whatsapp?: string;
}
