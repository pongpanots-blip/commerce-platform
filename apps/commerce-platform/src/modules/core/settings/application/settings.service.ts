import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Setting } from '../infrastructure/setting.entity';

/** Minimal read-side: org-scoped value first, global (null-org) fallback. */
@Injectable()
export class SettingsService {
  constructor(@InjectRepository(Setting) private readonly repo: Repository<Setting>) {}

  async get<T>(scope: string, key: string, orgId: string | null = null): Promise<T | null> {
    if (orgId) {
      const scoped = await this.repo.findOne({ where: { scope, key, organizationId: orgId } });
      if (scoped) return scoped.value as T;
    }
    const global = await this.repo.findOne({ where: { scope, key, organizationId: IsNull() } });
    return (global?.value as T) ?? null;
  }
}
