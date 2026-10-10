import { DomainEvent } from '../../../../shared-kernel/domain/domain-event';
import type { NotifyChannel } from '../domain/workflow.types';

/** To josh (`internal/erp-events`): deliver a notify template; josh dedupes on dedupeKey. Aggregate = the josh user. */
export interface MarketingNotifyPayload { userId: string; templateKey: string; channels: NotifyChannel[]; data: Record<string, unknown>; dedupeKey: string }
export class MarketingNotifyRequested extends DomainEvent<MarketingNotifyPayload> { readonly type = 'marketing.notify'; }

/** To josh: grant a coupon (idempotent per coupon + user in josh). */
export interface MarketingGrantCouponPayload { userId: string; couponId: string }
export class MarketingGrantCouponRequested extends DomainEvent<MarketingGrantCouponPayload> { readonly type = 'marketing.grant_coupon'; }
