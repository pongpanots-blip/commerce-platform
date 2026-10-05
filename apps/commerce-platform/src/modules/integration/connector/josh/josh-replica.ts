import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JOSH_WINBACK_TABLES } from './winback/josh-tables';
import { JOSH_PRICING_TABLES } from './pricing/josh-pricing-tables';
import { JOSH_REPLICA_TABLES } from '../../../platform/winback/josh-replica-tables';

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

  /** The replica connection. Knows josh's winback and price tables (read via copied josh code); never synchronizes or migrates. */
  async dataSource(): Promise<DataSource> {
    if (!this.josh) {
      const josh = new DataSource({ type: 'postgres', url: process.env.JOSH_DATABASE_URL, entities: [...JOSH_WINBACK_TABLES, ...JOSH_PRICING_TABLES, ...JOSH_REPLICA_TABLES],
        synchronize: false, migrationsRun: false,
        applicationName: 'commerce-josh-replica', extra: { max: 2, statement_timeout: 120_000, connectionTimeoutMillis: 5_000 } });
      await josh.initialize();
      this.josh = josh;
    }
    return this.josh;
  }

  /** The open replica connection, for repositories that must be resolved synchronously (winback). null until dataSource() has connected. */
  current(): DataSource | null { return this.josh; }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    try {
      return await (await this.dataSource()).query(sql, params);
    } catch (error) {
      await this.onModuleDestroy();
      throw error;
    }
  }

  /** Run copied josh code against the replica; a failure drops the pool so the next call reconnects. */
  async run<T>(fn: (ds: DataSource) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.dataSource());
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
