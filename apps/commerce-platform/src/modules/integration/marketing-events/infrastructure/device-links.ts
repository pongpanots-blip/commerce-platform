import type { EntityManager } from 'typeorm';
import type { DeviceLink } from '../domain/attribution';

/** A device's links, oldest first (spec §5). */
export async function linksOf(m: EntityManager, deviceId: string): Promise<DeviceLink[]> {
  const rows = await m.query(`SELECT user_id, linked_at, is_staff FROM marketing_device_links WHERE device_id = $1 ORDER BY linked_at`, [deviceId]);
  return rows.map((r: Record<string, unknown>) => ({ userId: r.user_id as string, linkedAt: new Date(r.linked_at as string), isStaff: !!r.is_staff }));
}

/** Customers whose events may be used: signup consent given, not PDPA-deleted (spec §5.1). */
export async function usableUsers(m: EntityManager, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await m.query(`SELECT id FROM josh_customers WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
    AND (data->>'pdpa_consent')::boolean IS TRUE`, [ids]);
  return new Set(rows.map((r: { id: string }) => r.id));
}


const RECENT_MS = 60 * 60_000; // = TRIGGER_RECENT_MINUTES

/**
 * A josh device link (spec §5). Inserts the link, then re-attributes only the device's events in the range this link
 * covers ([its time, next link) — from -∞ when it is the first link). Fact columns are never written. Returns the
 * re-attributed events of the last hour (to re-check triggers) and whether the user is usable.
 */
export async function linkDevice(m: EntityManager, l: { deviceId: string; userId: string; platform: string; linkedAt: Date }): Promise<{ recentEventIds: string[]; usable: boolean }> {
  const [prev] = await m.query(`SELECT user_id FROM marketing_device_links WHERE device_id = $1 AND linked_at <= $2 ORDER BY linked_at DESC LIMIT 1`, [l.deviceId, l.linkedAt]);
  if (prev?.user_id === l.userId) return { recentEventIds: [], usable: false };
  const [staff] = await m.query(`SELECT EXISTS (SELECT 1 FROM josh_staff WHERE id = $1 AND user_type IS DISTINCT FROM 'customer') AS hit`, [l.userId]);
  const isStaff = !!staff?.hit;
  await m.query(`INSERT INTO marketing_device_links (device_id, user_id, platform, linked_at, is_staff) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (device_id, linked_at) DO NOTHING`, [l.deviceId, l.userId, l.platform, l.linkedAt, isStaff]);
  const links = await linksOf(m, l.deviceId);
  const i = links.findIndex((x) => x.linkedAt.getTime() === l.linkedAt.getTime() && x.userId === l.userId);
  if (i < 0) return { recentEventIds: [], usable: false };
  const usable = !isStaff && (await usableUsers(m, [l.userId])).has(l.userId);
  const [userId, attribution] = isStaff ? [null, 'staff'] : usable ? [l.userId, 'device_link'] : [null, 'no_consent'];
  // TypeORM (postgres) resolves UPDATE … RETURNING to [rows, affectedCount].
  const [rows] = (await m.query(`UPDATE marketing_events SET attributed_user_id = $2, attribution = $3
    WHERE device_id = $1 AND ($4::timestamptz IS NULL OR occurred_at >= $4) AND ($5::timestamptz IS NULL OR occurred_at < $5)
    RETURNING event_id, occurred_at`, [l.deviceId, userId, attribution, i === 0 ? null : links[i].linkedAt, links[i + 1]?.linkedAt ?? null])) as [{ event_id: string; occurred_at: Date }[], number];
  const since = Date.now() - RECENT_MS;
  return { usable, recentEventIds: userId ? rows.filter((r) => new Date(r.occurred_at).getTime() >= since).map((r) => r.event_id) : [] };
}

/** Consent withdrawn (spec §5.1): the customer's attributed events go; later events from their devices stay unattributed. */
export async function withdrawConsent(m: EntityManager, userId: string): Promise<void> {
  await m.query(`DELETE FROM marketing_events WHERE attributed_user_id = $1`, [userId]);
}

/** PDPA delete (spec §17): events, links, devices the customer used and their guest push log. */
export async function deleteMarketingEventsForCustomer(m: EntityManager, userId: string): Promise<void> {
  await m.query(`DELETE FROM marketing_events WHERE attributed_user_id = $1`, [userId]);
  await m.query(`DELETE FROM marketing_guest_push_log WHERE device_id IN (SELECT device_id FROM marketing_device_links WHERE user_id = $1)`, [userId]);
  await m.query(`DELETE FROM marketing_devices WHERE device_id IN (SELECT device_id FROM marketing_device_links WHERE user_id = $1)`, [userId]);
  await m.query(`DELETE FROM marketing_device_links WHERE user_id = $1`, [userId]);
}
