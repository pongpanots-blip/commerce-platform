/**
 * Field-visit GPS: how far a rep stood from the customer when they checked in / out.
 *
 * Judged at read time from the activity's GPS and the account's lat/lng, so it also
 * covers visits mirrored from josh (which only carry check-in lat/lng) and follows a
 * rep correcting a wrong shop pin afterwards.
 */

export type VisitGpsStatus = 'on_site' | 'off_site' | 'no_gps' | 'no_customer_location';

export const DEFAULT_VISIT_RADIUS_M = 200;

/** WINBACK_VISIT_RADIUS_M — how close (metres) a check-in must be to count as at the customer. */
export function visitRadiusM(): number {
  const n = Number(process.env.WINBACK_VISIT_RADIUS_M);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_VISIT_RADIUS_M;
}

type LatLng = { lat: unknown; lng: unknown };

function coord(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Both coordinates present and inside the earth's range; (0,0) is a "no fix" placeholder, not a place. */
export function toPoint(p: LatLng | null | undefined): { lat: number; lng: number } | null {
  if (!p) return null;
  const lat = coord(p.lat);
  const lng = coord(p.lng);
  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/** Great-circle distance in whole metres (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * On site when the distance is within the radius. A reported GPS accuracy widens the
 * radius (a 60 m fix 230 m away may still have been at the door) but never by more than
 * the radius itself, so a 5 km fix cannot pass as on site.
 */
export function judgeVisitGps(
  rep: LatLng | null | undefined,
  customer: LatLng | null | undefined,
  opts: { accuracyM?: unknown; radiusM?: number } = {},
): { status: VisitGpsStatus; distance_m: number | null } {
  const at = toPoint(rep);
  if (!at) return { status: 'no_gps', distance_m: null };
  const shop = toPoint(customer);
  if (!shop) return { status: 'no_customer_location', distance_m: null };
  const radius = opts.radiusM ?? visitRadiusM();
  const accuracy = Math.max(0, coord(opts.accuracyM) ?? 0);
  const d = distanceM(at, shop);
  return { status: d <= radius + Math.min(accuracy, radius) ? 'on_site' : 'off_site', distance_m: d };
}

export type VisitGpsRow = {
  sales_user_id: string;
  checkin: { status: VisitGpsStatus };
};

/** Per-rep counts and on-site rate. The rate is over visits that could be judged (GPS + shop pin both known). */
export function summarizeVisitGps(rows: VisitGpsRow[]) {
  const byRep = new Map<
    string,
    { sales_user_id: string; visits: number; on_site: number; off_site: number; no_gps: number; no_customer_location: number }
  >();
  for (const row of rows) {
    const rep = byRep.get(row.sales_user_id) ?? {
      sales_user_id: row.sales_user_id,
      visits: 0,
      on_site: 0,
      off_site: 0,
      no_gps: 0,
      no_customer_location: 0,
    };
    rep.visits += 1;
    rep[row.checkin.status] += 1;
    byRep.set(row.sales_user_id, rep);
  }
  return [...byRep.values()].map((rep) => {
    const judged = rep.on_site + rep.off_site;
    return { ...rep, on_site_rate: judged ? Math.round((rep.on_site / judged) * 1000) / 10 : null };
  });
}
