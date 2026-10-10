import { secretCipher } from '../../../../shared-kernel/infrastructure/secret-cipher';

/**
 * Site passwords at rest: AES-256-GCM, key = SCRAPING_CREDENTIALS_KEY (32 bytes, base64).
 * Stored as `v1:<iv>:<tag>:<ciphertext>` (base64 parts). Rotating the key means re-entering passwords. See secret-cipher.ts.
 */
const cipher = secretCipher('SCRAPING_CREDENTIALS_KEY', {
  missingKey: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า SCRAPING_CREDENTIALS_KEY จึงยังเก็บรหัสผ่านเว็บไม่ได้ — แจ้งทีมระบบ',
  malformed: 'รหัสผ่านเว็บที่เก็บไว้อ่านไม่ได้ กรุณาบันทึกใหม่',
  wrongKey: 'รหัสผ่านเว็บที่เก็บไว้อ่านไม่ได้ (คีย์เปลี่ยน?) กรุณาบันทึกใหม่',
});
export const encryptCredential = (plain: string): string => cipher.encrypt(plain);
export const decryptCredential = (stored: string): string => cipher.decrypt(stored);
