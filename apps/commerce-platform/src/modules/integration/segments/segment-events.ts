import { DomainEvent } from '../../../shared-kernel/domain/domain-event';
import { Segment } from './segment.entity';

/*
 * Segment events for platforms (docs/event-contract.md §3) — josh applies them to user_segments /
 * segment_membership_snapshots. Not snapshot events: every part must be delivered, in order.
 */
export interface SegmentPayload {
  id: string; slug: string; name: string; description: string | null; rule_type: string; rule_config: Record<string, unknown>;
  definition: Record<string, unknown> | null; priority: number; is_active: boolean; frozen_at: string | null; member_count: number | null;
}
export const toSegmentPayload = (s: Segment): SegmentPayload => ({
  id: s.id, slug: s.slug, name: s.name, description: s.description, rule_type: s.rule_type, rule_config: s.rule_config ?? {},
  definition: s.definition, priority: s.priority, is_active: s.is_active,
  frozen_at: s.frozen_at ? new Date(s.frozen_at).toISOString() : null, member_count: s.member_count,
});

export class SegmentUpserted extends DomainEvent<SegmentPayload> {
  readonly type = 'segment.upserted';
  constructor(payload: SegmentPayload) { super(payload.id, payload); }
}
export class SegmentDeleted extends DomainEvent<{ id: string }> {
  readonly type = 'segment.deleted';
  constructor(id: string) { super(id, { id }); }
}
/** One part of a frozen segment's members. frozenAt identifies the freeze, so parts apply in any order (retries). */
export interface SegmentMembersPayload { segmentId: string; frozenAt: string; part: number; parts: number; userIds: string[] }
export class SegmentMembers extends DomainEvent<SegmentMembersPayload> {
  readonly type = 'segment.members';
  constructor(payload: SegmentMembersPayload) { super(payload.segmentId, payload); }
}
