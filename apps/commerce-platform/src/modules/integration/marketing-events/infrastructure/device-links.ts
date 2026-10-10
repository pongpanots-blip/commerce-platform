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
