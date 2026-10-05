import type { ResolvedSegmentUser } from '@josh/shared-api';

export type { ResolvedSegmentUser };

/** Merge newly resolved users into the existing list, dedup by id (latest wins, order preserved). */
export function mergeResolvedUsers(
  existing: ResolvedSegmentUser[],
  incoming: ResolvedSegmentUser[],
): ResolvedSegmentUser[] {
  const byId = new Map(existing.map((user) => [user.id, user]));
  incoming.forEach((user) => byId.set(user.id, user));
  return [...byId.values()];
}
