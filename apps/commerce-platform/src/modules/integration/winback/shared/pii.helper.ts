import { normalizeJuristicNumber, normalizeThaiPhone } from './thai-validation.helper';

/**
 * Mask a Thai juristic / tax ID for shop responses (PDPA).
 * 13 digits → first 3 + last 4, e.g. 5412430744195 → 541******4195
 */
export function maskRegisterNumber(value: string | null | undefined): string | null {
  if (value == null) return null;
  const digits = normalizeJuristicNumber(value);
  if (!digits) return null;
  if (digits.length < 5) return '*'.repeat(digits.length);

  const keepStart = Math.min(3, digits.length - 4);
  const keepEnd = 4;
  const maskedLen = digits.length - keepStart - keepEnd;
  return `${digits.slice(0, keepStart)}${'*'.repeat(maskedLen)}${digits.slice(-keepEnd)}`;
}

/**
 * Mask a Thai national id number (13 digits) the same way as a juristic id:
 * 1100000000123 → 110******0123. Same helper, named for the field so call
 * sites read as what they mask.
 */
export function maskIdCardNumber(value: string | null | undefined): string | null {
  return maskRegisterNumber(value);
}

/**
 * Mask a phone for anyone who is not the data subject (PDPA).
 * Keeps the first 3 and last 4 digits: 0985496936 -> 098-***6936
 */
export function maskPhone(value: string | null | undefined): string | null {
  if (value == null) return null;
  const digits = normalizeThaiPhone(value);
  if (!digits) return null;
  if (digits.length < 8) return '*'.repeat(digits.length);
  return `${digits.slice(0, 3)}-***${digits.slice(-4)}`;
}

/**
 * Mask an email local part, keeping the domain so support can still tell
 * a gmail address from a corporate one: somchai@gmail.com -> so***@gmail.com
 */
export function maskEmail(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const keep = local.length > 2 ? local.slice(0, 2) : '';
  return `${keep}***@${domain}`;
}

/**
 * Given names are NOT masked: CS has to address the customer by name on a
 * call, and a given name alone does not identify a person. The family name
 * is reduced to its first character.
 */
export function maskPersonName(
  first: string | null | undefined,
  last: string | null | undefined,
): { first_name: string | null; last_name: string | null } {
  const firstOut = first?.trim() || null;
  const lastTrimmed = last?.trim();
  return {
    first_name: firstOut,
    last_name: lastTrimmed ? `${[...lastTrimmed][0]}.` : null,
  };
}
