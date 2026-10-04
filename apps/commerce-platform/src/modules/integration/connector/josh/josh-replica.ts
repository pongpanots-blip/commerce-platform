import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Read-only connection to josh's database (JOSH_DATABASE_URL — the read
 * replica / a SELECT-only user, never josh's primary). Shared by the jobs that
 * read josh's data so josh's primary never carries their load. Lazy; a failed
 * query drops the pool so the next run reconnects.
 */
@Injectable()
export class JoshReplica implements OnModuleDestroy {
  private josh: DataSource | null = null;

  get configured() { return !!process.env.JOSH_DATABASE_URL?.trim(); }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    try {
      if (!this.josh) {
        const josh = new DataSource({ type: 'postgres', url: process.env.JOSH_DATABASE_URL, entities: [],
          applicationName: 'commerce-josh-replica', extra: { max: 2, statement_timeout: 120_000, connectionTimeoutMillis: 5_000 } });
        await josh.initialize();
        this.josh = josh;
      }
      return await this.josh.query(sql, params);
    } catch (error) {
      await this.onModuleDestroy();
      throw error;
    }
  }

  async onModuleDestroy() {
    const josh = this.josh;
    this.josh = null;
    await josh?.destroy().catch(() => undefined);
  }
}
