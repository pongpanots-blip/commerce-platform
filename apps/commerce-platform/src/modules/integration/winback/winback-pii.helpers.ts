import { BadRequestException } from '@nestjs/common';
import {
  maskEmail,
  maskIdCardNumber,
  maskPersonName,
  maskPhone,
  maskRegisterNumber,
} from './shared/pii.helper';
import { WinbackAccount } from './entities/winback-account.entity';

/** Account columns that are identity numbers — masked on every read, never accepted back masked. */
export const WINBACK_IDENTITY_NUMBER_FIELDS = [
  'company_registration_num',
  'register_number',
  'id_card_number',
] as const;

/**
 * Win-back sales are internal staff, never the data subject — every read of
 * an account row goes through here: phone, email and the three identity
 * numbers (juristic / tax id, national id) come back masked. Full values go
 * through the audited `POST /api/pii/reveal` (`subjectType: winback_account`).
 */
export function maskWinbackAccountPii<T extends Partial<WinbackAccount>>(account: T): T {
  return {
    ...account,
    phone: maskPhone(account.phone),
    email: maskEmail(account.email),
    company_registration_num: maskRegisterNumber(account.company_registration_num),
    register_number: maskRegisterNumber(account.register_number),
    id_card_number: maskIdCardNumber(account.id_card_number),
  };
}

/** Every masked field a client could echo back: account and contact writes. */
export const WINBACK_MASKED_WRITE_FIELDS = [
  ...WINBACK_IDENTITY_NUMBER_FIELDS,
  'phone',
  'email',
  'mobile',
] as const;

/**
 * A client whose edit form pre-fills from a masked read and submits every
 * field on save would overwrite the real value with its own mask
 * (`098-***6936`, `so***@gmail.com`, `541******4195`) — silently, and
 * indistinguishable afterwards from a merely masked record. Every mask this
 * module produces contains `*`, and no real phone, email or id number does,
 * so refuse any such value with a 400 naming the field. Applies to
 * `PATCH /account/:id` and `PATCH /contacts/:contactId`.
 */
export function rejectMaskedPiiValues(dto: Record<string, unknown>): void {
  const echoed = WINBACK_MASKED_WRITE_FIELDS.filter((key) => {
    const value = dto[key];
    return typeof value === 'string' && value.includes('*');
  });
  if (echoed.length) {
    throw new BadRequestException(
      `${echoed.join(', ')} เป็นค่าที่ถูก mask ไม่ใช่ข้อมูล — ส่งค่าเต็มมา หรือไม่ต้องส่ง field นี้`,
    );
  }
}

/**
 * `winback_contact.name` is stored as a single free-text field, not
 * first/last columns like `users`. Split on the last whitespace run so
 * `maskPersonName`'s existing rule (given name kept, family name reduced to
 * an initial) still applies: "สมชาย ใจดี" -> "สมชาย ใ.".
 * A one-word name has no family name to mask, so it passes through as-is —
 * consistent with maskPersonName never masking a lone given name.
 */
export function maskContactFullName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return trimmed || null;
  const parts = trimmed.split(/\s+/);
  const last = parts.length > 1 ? parts.pop()! : null;
  const first = parts.join(' ');
  const masked = maskPersonName(first, last);
  return [masked.first_name, masked.last_name].filter(Boolean).join(' ') || null;
}
