const THAI_MOBILE_REGEX = /^0[689]\d{8}$/;

export function normalizeThaiPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  // Some clients (and the ANTS callback) send E.164 Thai as 66xxxxxxxxx.
  // No real Thai number is 11 digits starting 66, so this cannot collide.
  if (/^66[689]\d{8}$/.test(digits)) return `0${digits.slice(2)}`;
  return digits;
}

export function isValidThaiPhone(value: string): boolean {
  const digits = normalizeThaiPhone(value);
  return THAI_MOBILE_REGEX.test(digits);
}

export function formatThaiPhone(value: string): string {
  const digits = normalizeThaiPhone(value);
  if (!THAI_MOBILE_REGEX.test(digits)) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

/** ANTS SMS OTP expects `66xxxxxxxxx` (no leading 0). */
export function toAntsMobile(value: string): string | null {
  const digits = normalizeThaiPhone(value);
  if (THAI_MOBILE_REGEX.test(digits)) {
    return `66${digits.slice(1)}`;
  }
  if (/^66[689]\d{8}$/.test(digits)) {
    return digits;
  }
  return null;
}

const JURISTIC_WEIGHTS = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizeJuristicNumber(value: string): string {
  return value.replace(/\D/g, '');
}

export function isValidThaiJuristicNumber(value: string): boolean {
  const digits = normalizeJuristicNumber(value);
  if (!/^\d{13}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(digits[i]) * JURISTIC_WEIGHTS[i];
  }

  const checkDigit = (11 - (sum % 11)) % 10;
  return checkDigit === Number(digits[12]);
}

export function formatThaiJuristicNumber(value: string): string {
  const digits = normalizeJuristicNumber(value);
  if (!/^\d{13}$/.test(digits)) return value.trim();
  return `${digits[0]}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits[12]}`;
}

export const THAI_PHONE_ERROR =
  'เบอร์โทรไม่ถูกต้อง ใช้รูปแบบ 098-5496936';

export const THAI_JURISTIC_ERROR =
  'เลขทะเบียนนิติบุคคลไม่ถูกต้อง ต้องเป็นตัวเลข 13 หลัก';
