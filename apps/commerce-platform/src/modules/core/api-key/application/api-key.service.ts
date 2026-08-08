import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { ApiKey } from '../infrastructure/api-key.entity';

/** Keys are secrets: only SHA-256 hash + display prefix persist; full key returns once. */
@Injectable()
export class ApiKeyService {
  constructor(@InjectRepository(ApiKey) private readonly repo: Repository<ApiKey>) {}

  async createKey(accountId: string, name: string) {
    const fullKey = `ck_live_${randomBytes(16).toString('hex')}`;
    const keyPrefix = fullKey.slice(0, 16); // 'ck_live_' + first 8 hex chars
    const saved = await this.repo.save(this.repo.create({
      accountId, name, keyPrefix,
      keyHash: this.hash(fullKey),
      scope: 'storefront', active: true,
    }));
    return { id: saved.id, name: saved.name, keyPrefix, scope: saved.scope, fullKey };
  }

  listForAccount(accountId: string): Promise<ApiKey[]> {
    return this.repo.find({
      where: { accountId },
      select: ['id', 'name', 'keyPrefix', 'scope', 'active', 'lastUsedAt', 'revokedAt', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
  }

  async revoke(id: string, accountId: string): Promise<void> {
    const existing = await this.repo.findOne({ where: { id, accountId } });
    if (!existing) throw new NotFoundException(`api key ${id} not found`);
    await this.repo.update({ id, accountId }, { active: false, revokedAt: new Date() });
  }

  async validate(fullKey: string): Promise<ApiKey | null> {
    const row = await this.repo.findOne({ where: { keyHash: this.hash(fullKey) } });
    return row && row.active && !row.revokedAt ? row : null;
  }

  /**
   * Fail-closed invariant: ANY key row ever issued — active, revoked, or
   * inactive — re-closes the keyless bootstrap path in non-production. An
   * all-revoked table must NOT re-open it, so this counts every row, not
   * just active ones.
   */
  async hasAnyKeys(): Promise<boolean> {
    return (await this.repo.count()) > 0;
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.repo.update({ id }, { lastUsedAt: new Date() });
  }

  private hash(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }
}
