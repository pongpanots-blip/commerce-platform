import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DomainEvent } from '../../../../shared-kernel/domain/domain-event';
import { EVENT_BUS, IEventBus } from '../../../../shared-kernel/interfaces/event-bus.interface';

/** `winback.welcome_email` — josh sends its welcome-lead email (template + assets edited in josh admin › Welcome Lead Email). */
export class WinbackWelcomeEmailRequested extends DomainEvent<{ toEmail: string; locale: string | null }> {
  readonly type = 'winback.welcome_email';
}

/** josh BrevoEmailService.sendWelcomeLeadEmail for the intake form in commerce: through the outbox to josh, which owns the template and Brevo. */
@Injectable()
export class BrevoEmailService {
  constructor(@Inject(EVENT_BUS) private readonly eventBus: IEventBus) {}

  async sendWelcomeLeadEmail(params: { toEmail: string; locale?: string | null }): Promise<void> {
    const toEmail = params.toEmail.trim().toLowerCase();
    if (!toEmail) return;
    await this.eventBus.publish(new WinbackWelcomeEmailRequested(randomUUID(), { toEmail, locale: params.locale ?? null }));
  }
}
