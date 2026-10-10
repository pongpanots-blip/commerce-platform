export interface DeviceLink { userId: string; linkedAt: Date; isStaff: boolean }
export type Attribution = { userId: string | null; attribution: 'device_link' | 'staff' | 'no_consent' | null };

/**
 * The link in force when an event happened (spec §5): the latest at or before it; before the device's first link →
 * the first link (guest browsing belongs to whoever logs in first). `links` sorted by linkedAt ascending.
 */
export function linkAt(links: DeviceLink[], at: Date): DeviceLink | null {
  let found: DeviceLink | null = null;
  for (const l of links) {
    if (l.linkedAt.getTime() <= at.getTime()) found = l;
    else break;
  }
  return found ?? links[0] ?? null;
}

/** Staff are never a customer; a user without consent is stored but not attributed (spec §5, §5.1). */
export function attributeEvent(link: DeviceLink | null, usable: (userId: string) => boolean, actorKind?: string | null): Attribution {
  if (actorKind === 'staff' || link?.isStaff) return { userId: null, attribution: 'staff' };
  if (!link) return { userId: null, attribution: null };
  return usable(link.userId) ? { userId: link.userId, attribution: 'device_link' } : { userId: null, attribution: 'no_consent' };
}
