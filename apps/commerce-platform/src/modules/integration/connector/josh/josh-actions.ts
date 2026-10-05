import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuditLog } from '../../../core/audit/infrastructure/audit-log.entity';

export type JoshActionTarget = 'winback' | 'push-campaigns' | 'credit-applications' | 'admin-access' | 'coupons' | 'customer-prices' | 'contract-prices' | 'products' | 'promotions' | 'suppliers' | 'internal-docs';
export interface JoshActionActor { userId: string; email: string }

/**
 * Staff actions commerce asks josh to do (josh `POST /api/internal/commerce/{winback,push-campaigns}`).
 * josh's own services do the work, so josh stays the only writer and sender. The whole envelope —
 * action, args, who, when, nonce — is HMAC-signed with JOSH_EVENTS_SECRET (= josh's
 * COMMERCE_EVENTS_SECRET); josh acts as the josh staff user with the same email. Every call is
 * audited here, success or not.
 */
@Injectable()
export class JoshActions {
  constructor(private readonly db: DataSource) {}

  get configured() { return !!process.env.JOSH_API_URL?.trim() && !!process.env.JOSH_EVENTS_SECRET?.trim(); }

  async run<T = unknown>(target: JoshActionTarget, action: string, args: Record<string, unknown>, actor: JoshActionActor, via: string): Promise<T> {
    if (!this.configured) throw new ServiceUnavailableException('josh is not connected on this server (JOSH_API_URL / JOSH_EVENTS_SECRET).');
    const body = { action, args, actorEmail: actor.email, at: new Date().toISOString(), nonce: randomUUID() };
    const text = JSON.stringify(body);
    let status = 0;
    let answer: unknown = null;
    try {
      const res = await fetch(`${process.env.JOSH_API_URL!.trim().replace(/\/$/, '')}/internal/commerce/${target}`, {
        method: 'POST', body: text, signal: AbortSignal.timeout(60_000),
        headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', process.env.JOSH_EVENTS_SECRET!.trim()).update(text).digest('hex') },
      });
      status = res.status;
      const raw = await res.text();
      try { answer = raw ? JSON.parse(raw) : null; } catch { answer = raw; }
      if (!res.ok) throw joshError(status, answer);
      return answer as T;
    } finally {
      await this.db.getRepository(AuditLog).insert({
        actorId: actor.userId, action: `josh.${target}.${action}`, entityType: 'josh_action', entityId: null,
        after: args as object, context: { via, email: actor.email, joshStatus: status },
      });
    }
  }
}

/** josh's answer → the same kind of error here, with josh's message (Thai text included). */
function joshError(status: number, answer: unknown) {
  const m = (answer as { message?: unknown; error?: { message?: unknown } })?.message ?? (answer as { error?: { message?: unknown } })?.error?.message;
  const message = `josh: ${Array.isArray(m) ? m.join(', ') : String(m ?? status)}`;
  if (status === 400) return new BadRequestException(message);
  if (status === 403) return new ForbiddenException(message);
  if (status === 404) return new NotFoundException(`${message} (or commerce actions are off on josh: COMMERCE_ACTIONS_ENABLED)`);
  return new BadGatewayException(message);
}
