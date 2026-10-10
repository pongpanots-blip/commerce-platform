import type { DataSource } from 'typeorm';

const DAY = 86_400_000;
const NAME = /^marketing_events_(\d{4})_(\d{2})$/;
export const monthStart = (d: Date, add = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1));
export const partitionName = (start: Date) => `marketing_events_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, '0')}`;

/** Monthly partitions whose whole range is older than keepDays (spec §13). */
export function expiredPartitions(names: string[], now: Date, keepDays = 90): string[] {
  return names.filter((n) => {
    const m = NAME.exec(n);
    if (!m) return false;
    const end = Date.UTC(Number(m[1]), Number(m[2]), 1); // month index m[2] (1-based) = the next month 0-based
    return end <= now.getTime() - keepDays * DAY;
  });
}

/**
 * Creates the month's partition if missing. Rows that landed in the default partition for that month (a missed
 * nightly run) are moved in the same transaction — Postgres refuses to attach a range the default already holds.
 * Range literals come from Date arithmetic here, never from input.
 */
export async function ensurePartition(db: DataSource, start: Date): Promise<boolean> {
  const name = partitionName(start);
  if ((await db.query(`SELECT 1 FROM pg_class WHERE relname = $1`, [name])).length) return false;
  const from = start.toISOString(); const to = monthStart(start, 1).toISOString();
  await db.transaction(async (m) => {
    await m.query(`CREATE TEMP TABLE marketing_events_moving ON COMMIT DROP AS
      SELECT * FROM marketing_events_default WHERE occurred_at >= '${from}' AND occurred_at < '${to}'`);
    await m.query(`DELETE FROM marketing_events_default WHERE occurred_at >= '${from}' AND occurred_at < '${to}'`);
    await m.query(`CREATE TABLE ${name} PARTITION OF marketing_events FOR VALUES FROM ('${from}') TO ('${to}')`);
    await m.query(`INSERT INTO marketing_events SELECT * FROM marketing_events_moving`);
  });
  return true;
}

export async function dropExpiredPartitions(db: DataSource, now: Date): Promise<string[]> {
  const names = (await db.query(`SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'marketing_events'`)).map((r: { relname: string }) => r.relname);
  const expired = expiredPartitions(names, now);
  for (const n of expired) await db.query(`DROP TABLE ${n}`); // n matched NAME above
  await db.query(`DELETE FROM marketing_events_default WHERE occurred_at < $1`, [new Date(now.getTime() - 90 * DAY)]);
  return expired;
}

/**
 * For system health (spec §13). ponytail: exact count(*) is fine at this volume — switch to pg_class.reltuples
 * when the table passes a few million rows.
 */
export async function eventStoreHealth(db: DataSource): Promise<{ rows: number; totalBytes: number; oldestAt: string | null; defaultPartitionRows: number }> {
  const [r] = await db.query(`SELECT (SELECT count(*)::int FROM marketing_events) AS rows,
      (SELECT COALESCE(sum(pg_total_relation_size(i.inhrelid)), 0)::bigint FROM pg_inherits i JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'marketing_events') AS total_bytes,
      (SELECT min(occurred_at) FROM marketing_events) AS oldest_at, (SELECT count(*)::int FROM marketing_events_default) AS default_rows`);
  return { rows: r.rows, totalBytes: Number(r.total_bytes), oldestAt: r.oldest_at ? new Date(r.oldest_at).toISOString() : null, defaultPartitionRows: r.default_rows };
}
