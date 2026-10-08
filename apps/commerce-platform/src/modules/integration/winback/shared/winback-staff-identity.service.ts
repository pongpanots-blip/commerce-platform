import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** Mapping only is cached, including misses. Link changes take effect within 60 seconds. */
@Injectable()
export class WinbackStaffIdentityService {
  private readonly cache = new Map<string, { at: number; value: { id: string; joshId?: string } }>();
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async resolve(source: 'commerce' | 'josh', subject: string): Promise<{ id: string; joshId?: string }> {
    const sub = subject.trim().toLowerCase();
    const key = `${source}:${sub}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    const [link]: { commerce_user_id: string; josh_user_id: string }[] = await this.db.query(
      `SELECT commerce_user_id, josh_user_id FROM winback_staff_links WHERE ${source === 'commerce' ? 'commerce_user_id' : 'josh_user_id'} = $1`, [sub]);
    const value = { id: source === 'josh' ? link?.commerce_user_id ?? sub : sub,
      ...(link?.josh_user_id ? { joshId: link.josh_user_id } : source === 'josh' ? { joshId: sub } : {}) };
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}
