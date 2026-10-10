import { BadRequestException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SecretCipher { encrypt(plain: string): string; decrypt(stored: string): string; configured(): boolean }

/**
 * AES-256-GCM for small secrets at rest, key = env `envName` (32 bytes, base64). Stored as `v1:<iv>:<tag>:<ciphertext>`
 * (base64 parts). Rotating the key means re-entering the secrets. Used by scraping (site passwords) and marketing
 * webhooks (header secrets).
 */
export function secretCipher(envName: string, messages: { missingKey: string; malformed: string; wrongKey: string }): SecretCipher {
  const key = (): Buffer => {
    const raw = process.env[envName]?.trim();
    const value = raw ? Buffer.from(raw, 'base64') : null;
    if (!value || value.length !== 32) throw new BadRequestException(messages.missingKey);
    return value;
  };
  return {
    configured() { try { key(); return true; } catch { return false; } },
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key(), iv);
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
    },
    decrypt(stored) {
      const [version, iv, tag, data] = stored.split(':');
      if (version !== 'v1' || !iv || !tag || !data) throw new BadRequestException(messages.malformed);
      const k = key();
      try {
        const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
      } catch {
        throw new BadRequestException(messages.wrongKey);
      }
    },
  };
}
