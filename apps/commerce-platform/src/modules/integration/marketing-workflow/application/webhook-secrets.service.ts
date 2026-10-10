import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { secretCipher } from '../../../../shared-kernel/infrastructure/secret-cipher';
import type { WebhookSecretItem } from '../domain/workflow.types';
import { MarketingWebhookSecret } from '../infrastructure/marketing-webhook-secret.entity';

const cipher = secretCipher('MARKETING_WEBHOOK_SECRETS_KEY', {
  missingKey: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า MARKETING_WEBHOOK_SECRETS_KEY จึงยังเก็บค่าลับของ webhook ไม่ได้ — แจ้งทีมระบบ',
  malformed: 'ค่าลับที่เก็บไว้อ่านไม่ได้ กรุณาบันทึกใหม่',
  wrongKey: 'ค่าลับที่เก็บไว้อ่านไม่ได้ (คีย์เปลี่ยน?) กรุณาบันทึกใหม่',
});
const item = (r: MarketingWebhookSecret): WebhookSecretItem =>
  ({ id: r.id, name: r.name, createdAt: new Date(r.createdAt).toISOString(), updatedAt: new Date(r.updatedAt).toISOString() });

/** Webhook header secrets (spec §4.6): write-only through the API; only the sender reads the plain value. */
@Injectable()
export class WebhookSecretsService {
  constructor(@InjectRepository(MarketingWebhookSecret) private readonly repo: Repository<MarketingWebhookSecret>) {}

  configured() { return cipher.configured(); }
  async list(): Promise<WebhookSecretItem[]> { return (await this.repo.find({ order: { name: 'ASC' } })).map(item); }
  async create(name: string, value: string, actor: string): Promise<WebhookSecretItem> {
    return item(await this.repo.save({ name, valueEncrypted: cipher.encrypt(value), createdBy: actor }));
  }
  async replace(id: string, value: string): Promise<WebhookSecretItem> {
    const row = await this.repo.findOneBy({ id });
    if (!row) throw new NotFoundException('ไม่พบค่าลับนี้');
    return item(await this.repo.save({ ...row, valueEncrypted: cipher.encrypt(value) }));
  }
  async remove(id: string): Promise<void> { await this.repo.delete({ id }); }

  /** Sender only. Ids that are gone or can't be decrypted are left out (→ secret_missing). */
  async resolve(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!ids.length) return out;
    for (const r of await this.repo.findBy({ id: In(ids) })) {
      try { out.set(r.id, cipher.decrypt(r.valueEncrypted)); } catch { /* left out */ }
    }
    return out;
  }
}
