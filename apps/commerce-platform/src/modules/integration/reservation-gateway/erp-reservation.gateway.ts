import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConnectorRegistry } from '../connector/connector-registry';
import { Integration } from '../integration/infrastructure/integration.entity';
import {
  GatewayResult, ReservationGateway, ReserveLineInput, ReserveLineResult,
} from '../../commerce/reservation/domain/reservation-gateway.port';

/**
 * The one place that talks to the external reservation authority. Guards the
 * ERP with a hard timeout and a circuit breaker so checkout can never hammer
 * or hang on a sick ERP — it degrades to per-line erp_unavailable failures.
 */
@Injectable()
export class ErpReservationGateway implements ReservationGateway {
  private readonly logger = new Logger(ErpReservationGateway.name);
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(
    private readonly registry: ConnectorRegistry,
    @InjectRepository(Integration) private readonly integrations: Repository<Integration>,
  ) {}

  private get connectorType(): string {
    return process.env.COMMERCE_RESERVATION_CONNECTOR || 'erp-stub';
  }
  private get timeoutMs(): number {
    return Number(process.env.RESERVATION_TIMEOUT_MS || 5000);
  }
  private get breakerThreshold(): number {
    return Number(process.env.RESERVATION_BREAKER_THRESHOLD || 5);
  }
  private get breakerCooldownMs(): number {
    return Number(process.env.RESERVATION_BREAKER_COOLDOWN_MS || 30000);
  }

  private async activeIntegration(): Promise<Integration | null> {
    return this.integrations.findOne({
      where: { type: this.connectorType, status: 'active' },
    });
  }

  async integrationId(): Promise<string | null> {
    return (await this.activeIntegration())?.id ?? null;
  }

  async reserve(lines: ReserveLineInput[]): Promise<ReserveLineResult[]> {
    const unavailable = (error: string): ReserveLineResult[] =>
      lines.map(() => ({ ok: false, code: 'erp_unavailable' as const, error }));

    if (Date.now() < this.openUntil) return unavailable('circuit breaker open');

    const integration = await this.activeIntegration();
    if (!integration) return unavailable(`no active ${this.connectorType} integration`);

    const adapter = this.registry.resolve(integration.type);
    const ctx = { integrationId: integration.id, config: integration.config };

    // Bounded retry on transient (thrown/timed-out) errors — SAFE because the
    // idempotency keys make a duplicate reserve a no-op at the connector.
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const results = await this.withTimeout(adapter.reserveStock(lines, ctx));
        this.consecutiveFailures = 0;
        return results;
      } catch (error) {
        lastError = error;
        this.logger.warn(`reserve attempt ${attempt + 1}/2 failed: ${error}`);
      }
    }
    this.recordFailure(lastError);
    return unavailable(lastError instanceof Error ? lastError.message : String(lastError));
  }

  async confirm(refs: string[]): Promise<GatewayResult> {
    return this.simpleOp((a, ctx) => a.confirmReservation(refs, ctx));
  }

  async release(refs: string[]): Promise<GatewayResult> {
    return this.simpleOp((a, ctx) => a.releaseReservation(refs, ctx));
  }

  /**
   * Breaker asymmetry is DELIBERATE (final review): confirm/release are
   * post-money operations (payment already succeeded or failed) that must
   * always attempt delivery to the ERP — they feed the breaker's failure
   * count on error, but unlike reserve() above they are never gated by
   * `openUntil`. Skipping them while the breaker is open would silently
   * strand reservations in their current state instead of surfacing a
   * gateway failure that flips the row to 'reconcile' for retry.
   */
  private async simpleOp(
    op: (adapter: ReturnType<ConnectorRegistry['resolve']>, ctx: { integrationId: string; config: unknown }) => Promise<{ ok: boolean; error?: string }>,
  ): Promise<GatewayResult> {
    const integration = await this.activeIntegration();
    if (!integration) return { ok: false, error: `no active ${this.connectorType} integration` };
    try {
      const adapter = this.registry.resolve(integration.type);
      const res = await this.withTimeout(
        op(adapter, { integrationId: integration.id, config: integration.config }),
      );
      return { ok: res.ok, error: res.error };
    } catch (error) {
      this.recordFailure(error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    return Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('reservation call timed out')), this.timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  private recordFailure(error: unknown): void {
    this.consecutiveFailures += 1;
    this.logger.warn(`reservation call failed (${this.consecutiveFailures}): ${error}`);
    if (this.consecutiveFailures >= this.breakerThreshold) {
      this.openUntil = Date.now() + this.breakerCooldownMs;
      this.consecutiveFailures = 0;
      this.logger.error(`circuit breaker OPEN for ${this.breakerCooldownMs}ms`);
    }
  }
}
