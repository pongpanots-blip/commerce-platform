import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  Matches,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  WinbackCustomerType,
  WINBACK_CUSTOMER_TYPES,
  WINBACK_LEAD_SOURCES,
} from '../winback.enums';

/**
 * Payload from the external signup form.
 *
 * b2b_company = ผู้ประกอบการ, b2b_individual = ลูกค้าทั่วไป.
 * Intentionally NOT CreateLeadDto — that one requires lat/lng, business_size,
 * operation_hours and contacts[], none of which this form collects.
 *
 * A name, a phone number, a cuisine and one written channel (email or line_id)
 * are the minimum — sales can chase the rest. `customer_type` is the exception
 * and is optional, because a marketing form has no sensible way to ask it.
 */
export class IntakeLeadDto {
  /** Defaults to b2b_company when the form doesn't ask (landing's contact form). */
  @IsOptional() @IsIn(WINBACK_CUSTOMER_TYPES) customer_type?: string;

  @IsString() @IsNotEmpty() @MaxLength(255) display_name: string;

  /**
   * Bare digits, nine or ten — a Thai landline is 9 (`021234567`), a mobile 10
   * (`0812345678`). Separators are the caller's to strip (landing's route does
   * it before posting): a CRM full of `081-234-5678`, `081 234 5678` and
   * `0812345678` is three formats nobody can dial from or dedupe on.
   */
  @IsString()
  @Matches(/^\d{9,10}$/, {
    message: 'phone ต้องเป็นตัวเลขล้วน 9-10 หลัก (เบอร์บ้าน 9, มือถือ 10)',
  })
  phone: string;

  /** email หรือ line_id ต้องมีอย่างน้อยหนึ่งอย่าง */
  @ValidateIf((o: IntakeLeadDto) => !o.line_id)
  @IsString() @IsNotEmpty() @MaxLength(255) @IsEmail()
  email?: string;

  @ValidateIf((o: IntakeLeadDto) => !o.email)
  @IsString() @IsNotEmpty() @MaxLength(100)
  line_id?: string;

  @ValidateIf((o: IntakeLeadDto) => o.customer_type === WinbackCustomerType.B2B_COMPANY)
  @IsString() @IsNotEmpty() @MaxLength(255)
  company_name?: string;

  @IsOptional() @IsString() @MaxLength(255) restaurant_name?: string;

  /** cuisine_id หรือ cuisine_name ต้องมีอย่างน้อยหนึ่งอย่าง */
  @ValidateIf((o: IntakeLeadDto) => !o.cuisine_name)
  @IsUUID()
  cuisine_id?: string;

  @ValidateIf((o: IntakeLeadDto) => !o.cuisine_id)
  @IsString() @IsNotEmpty() @MaxLength(100)
  cuisine_name?: string;

  @IsOptional() @IsString() @MaxLength(4000) address?: string;

  @IsOptional() @IsIn(WINBACK_LEAD_SOURCES) lead_source?: string;

  /**
   * Landing locale for the welcome email (`en` | `th`). Optional — defaults to
   * English when omitted or unknown. Not persisted on the account.
   */
  @IsOptional() @IsIn(['en', 'th']) locale?: string;

  /**
   * Agreed to the Privacy Policy. Stamped as `consent_at` server-side, so the
   * lead carries *when* rather than just *whether* — the form can't backdate it.
   * Optional because a lead entered by sales has its consent captured
   * off-system; a public form must send `true`.
   */
  @IsOptional() @IsBoolean() consent?: boolean;
}
