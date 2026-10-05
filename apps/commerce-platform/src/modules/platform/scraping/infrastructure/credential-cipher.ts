import { BadRequestException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Site passwords at rest: AES-256-GCM, key = SCRAPING_CREDENTIALS_KEY (32 bytes, base64).
 * Stored as `v1:<iv>:<tag>:<ciphertext>` (base64 parts). Rotating the key means re-entering passwords.
 */
function key(): Buffer {
  const raw = process.env.SCRAPING_CREDENTIALS_KEY?.trim();
  const value = raw ? Buffer.from(raw, 'base64') : null;
  if (!value || value.length !== 32) throw new BadRequestException('เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า SCRAPING_CREDENTIALS_KEY จึงยังเก็บรหัสผ่านเว็บไม่ได้ — แจ้งทีมระบบ');
  return value;
}

export function encryptCredential(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decryptCredential(stored: string): string {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new BadRequestException('รหัสผ่านเว็บที่เก็บไว้อ่านไม่ได้ กรุณาบันทึกใหม่');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch { throw new BadRequestException('รหัสผ่านเว็บที่เก็บไว้อ่านไม่ได้ (คีย์เปลี่ยน?) กรุณาบันทึกใหม่'); }
}
