import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  WINBACK_BUSINESS_SIZES,
  WINBACK_CUSTOMER_TYPES,
  WINBACK_LEAD_SOURCES,
} from '../winback.enums';
import { CreateContactDto } from './create-contact.dto';

export class CreateLeadDto {
  @IsString() @IsNotEmpty() @MaxLength(255) display_name: string;
  @IsString() @IsNotEmpty() @MaxLength(255) restaurant_name: string;
  @IsIn(WINBACK_CUSTOMER_TYPES) customer_type: string;

  @ValidateIf((o: CreateLeadDto) => o.customer_type === 'b2b_company')
  @IsString() @IsNotEmpty() @MaxLength(255)
  company_name?: string;

  @ValidateIf((o: CreateLeadDto) => o.customer_type === 'b2b_company')
  @IsString() @IsNotEmpty() @MaxLength(50)
  company_registration_num?: string;

  @ValidateIf((o: CreateLeadDto) => o.customer_type === 'b2b_individual')
  @IsString() @IsNotEmpty() @MaxLength(30)
  id_card_number?: string;

  @IsString() @IsNotEmpty() @MaxLength(4000) address: string;
  @IsString() @IsNotEmpty() @MaxLength(255) location: string;
  @Type(() => Number) @IsNumber() lat: number;
  @Type(() => Number) @IsNumber() lng: number;

  @IsString() @IsNotEmpty() cuisine_parent_id: string;
  @IsString() @IsNotEmpty() @MaxLength(100) cuisine_parent_name: string;
  @IsString() @IsNotEmpty() cuisine_id: string;
  @IsString() @IsNotEmpty() @MaxLength(100) cuisine_name: string;

  @IsIn(WINBACK_BUSINESS_SIZES) business_size: string;

  @ValidateIf((o: CreateLeadDto) => o.business_size === 'mini_chain')
  @Type(() => Number) @IsInt() @Min(2)
  branch_count?: number;

  @IsIn(WINBACK_LEAD_SOURCES) lead_source: string;
  @IsString() @IsNotEmpty() @MaxLength(50) phone: string;
  @IsOptional() @IsString() @MaxLength(255) email?: string;
  @IsOptional() @IsString() @MaxLength(100) line_id?: string;
  @IsOptional() @IsString() @MaxLength(50) whatsapp?: string;
  @IsOptional() @IsString() @MaxLength(500) wongnai_url?: string;
  /** Persist as `HH:mm-HH:mm` (e.g. 10:00-20:00). */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}-\d{2}:\d{2}$/, {
    message: 'operation_hours must be HH:mm-HH:mm',
  })
  @MaxLength(255)
  operation_hours: string;

  @IsOptional() @IsString() @MaxLength(50) customer_code?: string;
  @IsOptional() @IsString() @MaxLength(100) register_number?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateContactDto)
  contacts: CreateContactDto[];
}
