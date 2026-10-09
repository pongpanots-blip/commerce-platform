import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebhookSubscription } from '../../modules/integration/webhook-subscription/infrastructure/webhook-subscription.entity';
import { WebhookDelivery } from '../../modules/integration/webhook-subscription/infrastructure/webhook-delivery.entity';
import { EVENT_CATALOG, PORTAL_EVENT_TYPES } from './event-catalog';

@Injectable()
export class PortalWebhooksService {
  constructor(
    @InjectRepository(WebhookSubscription) private readonly repo: Repository<WebhookSubscription>,
    @InjectRepository(WebhookDelivery) private readonly deliveriesRepo: Repository<WebhookDelivery>,
  ) {}

  async listForAccount(accountId: string): Promise<Omit<WebhookSubscription, 'secret'>[]> {
    const rows = await this.repo.find({ where: { accountId }, order: { createdAt: 'DESC' } });
    return rows.map((r) => this.stripSecret(r));
  }

  async recentDeliveriesForAccount(accountId: string, limit = 10): Promise<any[]> {
    // Get all subscriptions for this account
    const subs = await this.repo.find({ where: { accountId }, select: ['id'] });
    if (!subs.length) return [];
    const subIds = subs.map((s) => s.id);

    // Get recent deliveries for those subscriptions
    const deliveries = await this.deliveriesRepo
      .createQueryBuilder('d')
      .where('d.subscriptionId IN (:...subIds)', { subIds })
      .orderBy('d.createdAt', 'DESC')
      .limit(limit)
      .getMany();

    return deliveries.map((d) => ({
      id: d.id,
      webhookId: d.subscriptionId,
      eventType: d.eventType,
      url: d.targetUrl,
      status: d.status,
      statusCode: d.statusCode,
      attempts: d.attempts,
      createdAt: d.createdAt,
      error: d.error,
    }));
  }

  async createForAccount(accountId: string, dto: {
    name: string; targetUrl: string; eventTypes: string[]; secret?: string | null;
  }): Promise<Omit<WebhookSubscription, 'secret'>> {
    this.assertKnown(dto.eventTypes);
    this.assertSafeTargetUrl(dto.targetUrl);
    const saved = await this.repo.save(this.repo.create({
      accountId, name: dto.name, targetUrl: dto.targetUrl,
      eventTypes: dto.eventTypes, secret: dto.secret ?? null, active: true,
    }));
    return this.stripSecret(saved);
  }

  async updateForAccount(id: string, accountId: string, dto: {
    targetUrl?: string; eventTypes?: string[]; secret?: string | null; active?: boolean;
  }): Promise<Omit<WebhookSubscription, 'secret'>> {
    const existing = await this.repo.findOne({ where: { id, accountId } });
    if (!existing) throw new NotFoundException(`webhook ${id} not found`);
    if (dto.eventTypes) this.assertKnown(dto.eventTypes);
    if (dto.targetUrl !== undefined) this.assertSafeTargetUrl(dto.targetUrl);
    const saved = await this.repo.save({ ...existing, ...dto });
    return this.stripSecret(saved);
  }

  /** Fires the catalog example payload at the target URL right now. */
  async sendTest(id: string, accountId: string): Promise<{ ok: boolean; status: number | null; error?: string }> {
    const sub = await this.repo.findOne({ where: { id, accountId } });
    if (!sub) throw new NotFoundException(`webhook ${id} not found`);
    // Defense in depth: re-check rows that may predate the SSRF rule.
    this.assertSafeTargetUrl(sub.targetUrl);
    const type = sub.eventTypes[0] ?? 'order.confirmed';
    const example = EVENT_CATALOG.find((e) => e.type === type)?.example ?? { id: 'test' };
    try {
      const res = await fetch(sub.targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Test-Event': 'true' },
        body: JSON.stringify({ type, test: true, payload: example }),
      });
      return { ok: res.ok, status: res.status };
    } catch (error) {
      return { ok: false, status: null, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Portal subscriptions may only list catalog events ("*" is not accepted). */
  private assertKnown(types: string[]): void {
    for (const t of types) {
      if (!PORTAL_EVENT_TYPES.has(t)) {
        throw new BadRequestException(
          `event type "${t}" is not available to portal webhooks; see GET /v1/portal/events`,
        );
      }
    }
  }

  /**
   * SSRF guard on subscriber-supplied URLs. In production (unless
   * WEBHOOK_ALLOW_PRIVATE_TARGETS=1) private/loopback/link-local targets are
   * rejected so a portal account cannot point deliveries at internal services
   * or cloud metadata endpoints. Non-production stays permissive — local e2e
   * webhook sinks run on localhost.
   *
   * NOTE: this checks the hostname AS WRITTEN, not what it resolves to —
   * DNS-rebinding is NOT covered here. A resolver-level check belongs in the
   * delivery worker later.
   */
  private assertSafeTargetUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('invalid target URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('target URL must be http(s)');
    }
    if (process.env.NODE_ENV === 'production' && process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS !== '1') {
      if (this.isPrivateHostname(parsed.hostname)) {
        throw new BadRequestException('target URL not allowed');
      }
    }
  }

  private isPrivateHostname(hostname: string): boolean {
    const host = hostname.toLowerCase();
    if (host === 'localhost') return true;
    // URL.hostname keeps IPv6 brackets, e.g. "[::1]".
    const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
    if (bare === '::1') return true;
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127) return true; // 0.0.0.0/8, 10/8, 127/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 169 && b === 254) return true; // 169.254/16 (cloud metadata)
    return false;
  }

  private stripSecret(row: WebhookSubscription): Omit<WebhookSubscription, 'secret'> {
    const { secret: _secret, ...safe } = row;
    return safe;
  }
}
