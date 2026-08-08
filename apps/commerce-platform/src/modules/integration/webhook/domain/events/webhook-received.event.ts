import { DomainEvent } from '../../../../../shared-kernel/domain/domain-event';

/**
 * Generic event published when a verified webhook is processed. Concrete
 * connectors translate this (or subscribe) into specific canonical domain
 * events; the foundation ships no ERP-specific translation.
 */
export class WebhookReceivedEvent extends DomainEvent<{
  webhookEventId: string;
  payload: unknown;
}> {
  readonly type = 'integration.webhook.received';
}
