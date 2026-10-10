import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { dropExpiredPartitions, ensurePartition, eventStoreHealth, monthStart } from '../infrastructure/event-partitions';

/** Same switch as the workflow sweep: off only with CRON_MARKETING_WORKFLOW_ENABLED=false|0. */
const enabled = () => !['false', '0'].includes((process.env.CRON_MARKETING_WORKFLOW_ENABLED ?? '').trim().toLowerCase());
const LOCK = `hashtext('marketing-event-retention')`;

/** Nightly (spec §13): partitions ahead, yesterday's rollup, expired partitions, old action / guest-push logs. Every step is repeatable. */
@Injectable()
export class EventRetention {
  private readonly logger = new Logger(EventRetention.name);
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  @Cron('0 3 * * *', { timeZone: 'Asia/Bangkok' })
  async nightly(): Promise<void> {
    if (!enabled()) return;
    try { await this.run(); } catch (e) { this.logger.error(`marketing event retention: ${e instanceof Error ? e.stack : e}`); }
  }

  async run(now = new Date()): Promise<void> {
    const lock = this.db.createQueryRunner();
    await lock.connect();
    try {
      const [{ locked }] = await lock.query(`SELECT pg_try_advisory_lock(${LOCK}) AS locked`);
      if (!locked) return; // another instance is running it
      try {
        const created: string[] = [];
        for (let i = 0; i < 3; i++) if (await ensurePartition(this.db, monthStart(now, i))) created.push(String(i));
        const yesterday = new Date(now.getTime() + 7 * 3600_000 - 86_400_000).toISOString().slice(0, 10); // Bangkok date (UTC+7, no DST)
        await this.db.query(`INSERT INTO marketing_event_daily (date, name, platform, events, users, devices)
          SELECT $1::date, name, platform, count(*)::int, count(DISTINCT attributed_user_id)::int, count(DISTINCT device_id)::int FROM marketing_events
          WHERE occurred_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Bangkok') AND occurred_at < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
          GROUP BY name, platform
          ON CONFLICT (date, name, platform) DO UPDATE SET events = EXCLUDED.events, users = EXCLUDED.users, devices = EXCLUDED.devices`, [yesterday]);
        const dropped = await dropExpiredPartitions(this.db, now);
        const logs = await this.deleteBatched(`DELETE FROM marketing_workflow_action_logs WHERE id IN (SELECT id FROM marketing_workflow_action_logs
          WHERE created_at < now() - interval '180 days' LIMIT 5000)`);
        await this.db.query(`DELETE FROM marketing_guest_push_log WHERE sent_at < now() - interval '7 days'`);
        const health = await eventStoreHealth(this.db);
        this.logger.log(`marketing events: created ${created.length} partition(s), dropped ${dropped.join(', ') || 'none'}, action logs deleted ${logs}, ${JSON.stringify(health)}`);
      } finally {
        await lock.query(`SELECT pg_advisory_unlock(${LOCK})`);
      }
    } finally {
      await lock.release();
    }
  }

  private async deleteBatched(sql: string): Promise<number> {
    let total = 0;
    for (;;) {
      const [, affected] = (await this.db.query(sql)) as [unknown, number];
      total += affected ?? 0;
      if (!affected || affected < 5000) return total;
    }
  }
}
