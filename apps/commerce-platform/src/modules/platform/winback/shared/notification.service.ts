import { Inject, Injectable } from '@nestjs/common';
import { DomainEvent } from '../../../../shared-kernel/domain/domain-event';
import { EVENT_BUS, IEventBus } from '../../../../shared-kernel/interfaces/event-bus.interface';

/** josh NotificationService.dispatch input (the part winback uses). */
export interface DispatchInput {
  userId: string;
  type: string;
  category: string;
  data?: Record<string, unknown>;
  dedupeKey?: string | null;
}

/** `winback.notify` — josh's NotificationService delivers it (inbox, push to the device josh registered, email, the rep's own preferences). */
export class WinbackNotifyRequested extends DomainEvent<DispatchInput> {
  readonly type = 'winback.notify';
}

/**
 * josh's NotificationService for the winback module in commerce. Commerce decides WHEN (assignment,
 * appointment due, aging lead, daily digest); josh still DELIVERS, because the saleactivity app
 * registers its push device and reads its inbox at josh (`/api/auth/device`, `/api/notifications`).
 * Goes through the outbox: josh down → the notification waits and is delivered later, not lost;
 * josh dedupes on `dedupeKey` exactly as it does today.
 */
@Injectable()
export class NotificationService {
  constructor(@Inject(EVENT_BUS) private readonly eventBus: IEventBus) {}

  async dispatch(input: DispatchInput): Promise<void> {
    if (input.category !== 'winback' || !input.type.startsWith('winback_')) throw new Error(`winback dispatches winback notifications only (${input.type})`);
    await this.eventBus.publish(new WinbackNotifyRequested(input.userId, {
      userId: input.userId, type: input.type, category: input.category, data: input.data ?? {}, dedupeKey: input.dedupeKey ?? null,
    }));
  }
}
