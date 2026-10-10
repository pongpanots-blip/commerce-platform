import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { DomainEvent } from '../../../shared-kernel/domain/domain-event';
import { EVENT_BUS, IEventBus } from '../../../shared-kernel/interfaces/event-bus.interface';
import { JoshReplica } from '../../integration/connector/josh/josh-replica';
import { winbackOwnedByCommerce } from './shared/winback.config';
import { ScheduledCron } from '../../../shared-kernel/infrastructure/scheduled-task';

/** The six winback tables, parents first (deletes run in reverse), then the app records (winback_app_record). */
export const WINBACK_TABLES = ['winback_account', 'winback_contact', 'winback_activity', 'winback_stage_history', 'winback_sales_target', 'winback_meeting_ack', 'winback_app_record'] as const;
/** Added after the switch was built: skipped (not an error) while either side has not migrated it yet. */
export const WINBACK_OPTIONAL_TABLES: ReadonlySet<string> = new Set(['winback_app_record']);
export type WinbackTable = (typeof WINBACK_TABLES)[number];

const CHUNK = 500;
/** A row commerce already published to josh with this content is not published again for this long (josh / its replica catching up). */
const REPUBLISH_AFTER_MS = 30 * 60_000;
const cronOn = ['true', '1', 'on'].includes((process.env.CRON_WINBACK_MIRROR_ENABLED ?? '').trim().toLowerCase());

/** `winback.row` — one winback row as commerce now has it (`row: null` = deleted). josh upserts it into its own copy. Latest wins. */
export class WinbackRowChanged extends DomainEvent<{ table: WinbackTable; id: string; row: Record<string, unknown> | null }> {
  readonly type = 'winback.row';
  constructor(table: WinbackTable, id: string, row: Record<string, unknown> | null) {
    super(id, { table, id, row }, { snapshot: true });
  }
}

type Hashes = Map<string, string>;

/**
 * Keeps josh's and commerce's winback tables the same, from whichever side owns winback
 * (WINBACK_OWNER). Each run compares a hash of every row on both sides (columns both have, times
 * in UTC) and copies only what differs:
 *  - josh owns (before the switch): josh replica → commerce tables, written directly (inserts,
 *    updates, deletes), so commerce's copy is minutes old and ready to take over;
 *  - commerce owns (after the switch): commerce → josh as `winback.row` outbox events, so josh's
 *    own readers (restaurant-place links, PII reveal, reports on the replica) keep working.
 * No change log needed: the diff finds every change however it was written (josh raw SQL included).
 * Opt-in: CRON_WINBACK_MIRROR_ENABLED=true (every 5 minutes, CRON_WINBACK_MIRROR).
 */
@Injectable()
export class WinbackMirror {
  private readonly logger = new Logger(WinbackMirror.name);
  private readonly published = new Map<string, { hash: string; at: number }>();
  private running = false;

  constructor(
    private readonly db: DataSource,
    private readonly replica: JoshReplica,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  @ScheduledCron('winback-mirror', process.env.CRON_WINBACK_MIRROR?.trim() || '*/5 * * * *', { disabled: !cronOn })
  async tick() {
    if (this.running || !this.replica.configured) return;
    this.running = true;
    try {
      const result = await this.run();
      if (result.some((r) => r.changed || r.deleted)) this.logger.log(`winback mirror (${winbackOwnedByCommerce() ? 'commerce → josh' : 'josh → commerce'}): ${JSON.stringify(result)}`);
    } catch (error) {
      this.logger.error(`winback mirror failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.running = false;
    }
  }

  /** One full pass over the six tables in the current direction. */
  async run() {
    const toJosh = winbackOwnedByCommerce();
    const out: { table: WinbackTable; changed: number; deleted: number }[] = [];
    for (const table of WINBACK_TABLES) {
      const columns = await this.sharedColumns(table);
      if (!columns.length) continue;
      const [here, there] = await Promise.all([
        this.utc(this.db, (m) => this.hashes(m, table, columns)),
        this.replica.run((ds) => this.utc(ds, (m) => this.hashes(m, table, columns))),
      ]);
      const [owner, copy] = toJosh ? [here, there] : [there, here];
      const changed = [...owner].filter(([id, h]) => copy.get(id) !== h).map(([id]) => id);
      const deleted = [...copy.keys()].filter((id) => !owner.has(id));
      if (toJosh) await this.publish(table, columns, changed, deleted, owner);
      else await this.pull(table, columns, changed, deleted);
      out.push({ table, changed: changed.length, deleted: deleted.length });
    }
    return out;
  }

  /** josh → commerce: copy the changed rows from the replica, delete the ones josh no longer has. */
  private async pull(table: WinbackTable, columns: string[], changed: string[], deleted: string[]) {
    const cols = columns.map((c) => `"${c}"`).join(', ');
    const set = columns.filter((c) => c !== 'id').map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
    for (let i = 0; i < changed.length; i += CHUNK) {
      const ids = changed.slice(i, i + CHUNK);
      const rows = await this.replica.run((ds) => this.utc(ds, (m) => this.rows(m, table, columns, ids)));
      await this.utc(this.db, (m) => m.query(
        `INSERT INTO ${table} (${cols}) SELECT ${cols} FROM json_populate_recordset(NULL::${table}, $1::json)
         ON CONFLICT (id) DO UPDATE SET ${set}`, [JSON.stringify(rows)]));
    }
    for (let i = 0; i < deleted.length; i += CHUNK) {
      await this.db.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [deleted.slice(i, i + CHUNK)]);
    }
  }

  /** commerce → josh: one latest-wins outbox event per changed / deleted row. */
  private async publish(table: WinbackTable, columns: string[], changed: string[], deleted: string[], hashes: Hashes) {
    const now = Date.now();
    const due = (id: string, hash: string) => {
      const last = this.published.get(`${table}:${id}`);
      return !last || last.hash !== hash || now - last.at > REPUBLISH_AFTER_MS;
    };
    const send = changed.filter((id) => due(id, hashes.get(id)!));
    for (let i = 0; i < send.length; i += CHUNK) {
      const ids = send.slice(i, i + CHUNK);
      await this.utc(this.db, async (m) => {
        const rows = await this.rows(m, table, columns, ids);
        for (const row of rows) await this.eventBus.publish(new WinbackRowChanged(table, String(row.id), row), m);
      });
      for (const id of ids) this.published.set(`${table}:${id}`, { hash: hashes.get(id)!, at: now });
    }
    for (const id of deleted.filter((id) => due(id, 'deleted'))) {
      await this.eventBus.publish(new WinbackRowChanged(table, id, null));
      this.published.set(`${table}:${id}`, { hash: 'deleted', at: now });
    }
  }

  /** Columns commerce's table has that josh's has too (a column josh adds later is ignored until commerce migrates it). */
  private async sharedColumns(table: WinbackTable): Promise<string[]> {
    const sql = `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`;
    const [mine, josh] = await Promise.all([this.db.query(sql, [table]), this.replica.query<{ column_name: string }>(sql, [table])]);
    const theirs = new Set(josh.map((r: { column_name: string }) => r.column_name));
    const cols = (mine as { column_name: string }[]).map((r) => r.column_name).filter((c) => theirs.has(c));
    if (!cols.includes('id') && WINBACK_OPTIONAL_TABLES.has(table)) return [];
    if (!cols.includes('id')) throw new Error(`${table}: no shared id column (is the commerce migration run?)`);
    return cols;
  }

  private async hashes(m: EntityManager, table: WinbackTable, columns: string[]): Promise<Hashes> {
    const rows: { id: string; h: string }[] = await m.query(`SELECT id::text AS id, md5(row(${columns.map((c) => `t."${c}"`).join(', ')})::text) AS h FROM ${table} t`);
    return new Map(rows.map((r) => [r.id, r.h]));
  }

  private async rows(m: EntityManager, table: WinbackTable, columns: string[], ids: string[]): Promise<Record<string, unknown>[]> {
    const picked: { r: Record<string, unknown> }[] = await m.query(
      `SELECT row_to_json(x) AS r FROM (SELECT ${columns.map((c) => `t."${c}"`).join(', ')} FROM ${table} t WHERE t.id = ANY($1::uuid[])) x`, [ids]);
    return picked.map((p) => p.r);
  }

  /** Text of timestamptz depends on the session time zone: both sides hash and copy in UTC. */
  private utc<T>(ds: DataSource, fn: (m: EntityManager) => Promise<T>): Promise<T> {
    return ds.transaction(async (m) => {
      await m.query(`SET LOCAL TimeZone = 'UTC'`);
      return fn(m);
    });
  }
}
