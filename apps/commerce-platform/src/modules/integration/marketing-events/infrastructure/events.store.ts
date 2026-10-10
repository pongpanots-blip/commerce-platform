import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { EventCoverage, EventDailyRow, MarketingEventRow } from '@cp/marketing-workflow';
import { attributeEvent, linkAt } from '../domain/attribution';
import { linksOf, usableUsers } from './device-links';

export interface IngestDevice { deviceId: string; platform: string; pushSubscriptionId: string | null; source: string; environment: string; schemaVersion: number }
export interface AcceptedEvent {
  eventId: string; name: string; occurredAt: Date; attributes: Record<string, unknown>;
  companyId: string | null; branchId: string | null; actorKind: string | null;
}
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const toRow = (r: Record<string, unknown>): MarketingEventRow => ({
  eventId: r.event_id as string, deviceId: r.device_id as string, platform: r.platform as string, source: r.source as string, name: r.name as string,
  attributes: (r.attributes as Record<string, unknown>) ?? {}, companyId: (r.company_id as string) ?? null, branchId: (r.branch_id as string) ?? null,
  actorKind: (r.actor_kind as string) ?? null, occurredAt: iso(r.occurred_at)!, receivedAt: iso(r.received_at)!,
  attributedUserId: (r.attributed_user_id as string) ?? null, attribution: (r.attribution as string) ?? null,
});

/** Every SQL over marketing_events / devices / coverage outside the device-link and retention paths. */
@Injectable()
export class EventsStore {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** One transaction: device row, coverage, events (dedupe on event id). Returns the event ids actually stored. */
  ingest(d: IngestDevice, events: AcceptedEvent[], now: Date): Promise<Set<string>> {
    return this.db.transaction(async (m) => {
      await m.query(`INSERT INTO marketing_devices (device_id, platform, push_subscription_id, first_seen_at, last_seen_at) VALUES ($1, $2, $3, $4, $4)
        ON CONFLICT (device_id) DO UPDATE SET platform = EXCLUDED.platform,
          push_subscription_id = COALESCE(EXCLUDED.push_subscription_id, marketing_devices.push_subscription_id), last_seen_at = EXCLUDED.last_seen_at
        WHERE marketing_devices.platform IS DISTINCT FROM EXCLUDED.platform
          OR (EXCLUDED.push_subscription_id IS NOT NULL AND marketing_devices.push_subscription_id IS DISTINCT FROM EXCLUDED.push_subscription_id)
          OR marketing_devices.last_seen_at < EXCLUDED.last_seen_at - interval '1 hour'`, [d.deviceId, d.platform, d.pushSubscriptionId, now]);
      await m.query(`INSERT INTO marketing_event_coverage (platform, collecting_since) VALUES ($1, $2) ON CONFLICT (platform) DO NOTHING`, [d.platform, now]);
      const links = await linksOf(m, d.deviceId);
      const usable = await usableUsers(m, [...new Set(links.filter((l) => !l.isStaff).map((l) => l.userId))]);
      const stored = new Set<string>();
      for (const e of events) {
        const a = attributeEvent(linkAt(links, e.occurredAt), (u) => usable.has(u), e.actorKind);
        const rows = await m.query(`INSERT INTO marketing_events (schema_version, event_id, device_id, platform, source, environment, name, attributes,
            company_id, branch_id, actor_kind, occurred_at, attributed_user_id, attribution)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (event_id, occurred_at) DO NOTHING RETURNING event_id`,
          [d.schemaVersion, e.eventId, d.deviceId, d.platform, d.source, d.environment, e.name, JSON.stringify(e.attributes),
            e.companyId, e.branchId, e.actorKind, e.occurredAt, a.userId, a.attribution]);
        if (rows.length) stored.add(e.eventId);
      }
      return stored;
    });
  }

  async byIds(ids: string[]): Promise<MarketingEventRow[]> {
    if (!ids.length) return [];
    // occurred_at bound keeps partition pruning to the last 8 days (ingest refuses older events).
    return (await this.db.query(`SELECT * FROM marketing_events WHERE event_id = ANY($1::uuid[]) AND occurred_at >= now() - interval '8 days'`, [ids])).map(toRow);
  }

  async list(q: { deviceId?: string; userId?: string; name?: string; page: number }): Promise<{ rows: MarketingEventRow[]; total: number }> {
    const rows = await this.db.query(`SELECT *, count(*) OVER ()::int AS total FROM marketing_events
      WHERE ($1::text IS NULL OR device_id = $1) AND ($2::uuid IS NULL OR attributed_user_id = $2) AND ($3::text IS NULL OR name = $3)
      ORDER BY occurred_at DESC LIMIT 50 OFFSET $4`, [q.deviceId ?? null, q.userId ?? null, q.name ?? null, (q.page - 1) * 50]);
    return { total: rows[0]?.total ?? 0, rows: rows.map(toRow) };
  }

  async daily(from: string, to: string): Promise<EventDailyRow[]> {
    return (await this.db.query(`SELECT to_char(date, 'YYYY-MM-DD') AS date, name, platform, events, users, devices FROM marketing_event_daily
      WHERE date BETWEEN $1::date AND $2::date ORDER BY date, name, platform`, [from, to])) as EventDailyRow[];
  }

  async coverage(): Promise<EventCoverage[]> {
    return (await this.db.query(`SELECT platform, collecting_since FROM marketing_event_coverage ORDER BY platform`))
      .map((r: { platform: string; collecting_since: Date }) => ({ platform: r.platform, collectingSince: new Date(r.collecting_since).toISOString() }));
  }

  /** Coverage start for rules (spec §11): the earliest platform. null = nothing collected yet. */
  async coverageStart(): Promise<Date | null> {
    const [r] = await this.db.query(`SELECT min(collecting_since) AS at FROM marketing_event_coverage`);
    return r?.at ? new Date(r.at) : null;
  }
}
