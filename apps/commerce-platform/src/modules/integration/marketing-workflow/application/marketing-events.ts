import { DomainEvent } from '../../../../shared-kernel/domain/domain-event';
import type { NotifyChannel } from '../domain/workflow.types';

/** To josh: deliver a notify template; josh dedupes on dedupeKey. Aggregate = the josh user, or the enrollment for a guest (target). */
export interface MarketingNotifyPayload {
  userId: string | null; templateKey: string; channels: NotifyChannel[]; data: Record<string, unknown>; dedupeKey: string;
  target?: { kind: 'device'; subscriptionId: string; platform: string };
}
export class MarketingNotifyRequested extends DomainEvent<MarketingNotifyPayload> { readonly type = 'marketing.notify'; }

/** To josh: grant a coupon (idempotent per coupon + user in josh). */
export interface MarketingGrantCouponPayload { userId: string; couponId: string }
export class MarketingGrantCouponRequested extends DomainEvent<MarketingGrantCouponPayload> { readonly type = 'marketing.grant_coupon'; }
