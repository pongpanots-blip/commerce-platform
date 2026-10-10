import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScheduledInterval } from '../../../../shared-kernel/infrastructure/scheduled-task';

/** Per active subscription: the queue still waiting, and what was dead-lettered in the last window. */
export const SUBSCRIPTION_HEALTH_SQL = `
  SELECT s.name,
         COUNT(*) FILTER (WHERE d.status = 'pending')::int AS pending,
         COALESCE(EXTRACT(EPOCH FROM now() - MIN(d.created_at) FILTER (WHERE d.status = 'pending')), 0)::int AS oldest_pending_s,
         COUNT(*) FILTER (WHERE d.status = 'failed')::int AS failed,
         (array_agg(d.error ORDER BY d.updated_at DESC) FILTER (WHERE d.status = 'failed'))[1] AS last_error
    FROM webhook_subscriptions s
    LEFT JOIN webhook_deliveries d ON d.subscription_id = s.id
     AND (d.status = 'pending' OR (d.status = 'failed' AND d.updated_at > now() - make_interval(secs => $1)))
   WHERE s.active
   GROUP BY s.id, s.name`;

/** Events written but not yet handed to the dispatcher (relay stuck), and rows the relay gave up on. */
export const OUTBOX_HEALTH_SQL = `
  SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COALESCE(EXTRACT(EPOCH FROM now() - MIN(created_at) FILTER (WHERE status = 'pending')), 0)::int AS oldest_pending_s,
         COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > now() - make_interval(secs => $1))::int AS failed
    FROM outbox_messages
   WHERE status = 'pending' OR (status = 'failed' AND updated_at > now() - make_interval(secs => $1))`;

export interface SubscriptionHealth { name: string; pending: number; oldest_pending_s: number; failed: number; last_error: string | null }
export interface OutboxHealth { pending: number; oldest_pending_s: number; failed: number }
export interface Problem { key: string; kind: 'delivery-lag' | 'dead-letter' | 'outbox-stuck' | 'outbox-failed'; message: string }

/** Ongoing states that can recover; dead-letters are events that already happened (fixed by a retry, not by time). */
const RECOVERABLE: Problem['kind'][] = ['delivery-lag', 'outbox-stuck'];

export const DEFAULTS = {
  /** Normal delivery is ~20 ms; a minute of waiting means the platform (josh) is down or rejecting. */
  lagSeconds: 60,
  /** The relay is woken on commit; anything pending this long means it is not running. */
  outboxLagSeconds: 30,
  /** Dead-letters counted over this window. */
  windowSeconds: 15 * 60,
};

/** Pure: turns the two health reads into the problems worth waking someone for. */
export function detectProblems(subs: SubscriptionHealth[], outbox: OutboxHealth, t = DEFAULTS): Problem[] {
  const problems: Problem[] = [];
  for (const s of subs) {
    if (s.oldest_pending_s >= t.lagSeconds) {
      problems.push({ key: `lag:${s.name}`, kind: 'delivery-lag',
        message: `"${s.name}" is behind: ${s.pending} event(s) waiting, oldest ${s.oldest_pending_s}s — the platform may be down` });
    }
    if (s.failed > 0) {
      // count in the key: more dead-letters in the window = a new alert
      problems.push({ key: `dead:${s.name}:${s.failed}`, kind: 'dead-letter',
        message: `"${s.name}" dead-lettered ${s.failed} event(s) in the last ${Math.round(t.windowSeconds / 60)} min — last error: ${(s.last_error ?? '?').slice(0, 200)}. Retry from Webhooks → deliveries once fixed` });
    }
  }
  if (outbox.oldest_pending_s >= t.outboxLagSeconds) {
    problems.push({ key: 'outbox:stuck', kind: 'outbox-stuck',
      message: `Event relay is not running: ${outbox.pending} event(s) not dispatched, oldest ${outbox.oldest_pending_s}s` });
  }
  if (outbox.failed > 0) {
    problems.push({ key: `outbox-failed:${outbox.failed}`, kind: 'outbox-failed', message: `Event relay gave up on ${outbox.failed} event(s) in the last window — check the logs` });
  }
  return problems;
}

const MONITOR_LOCK_KEY = 7_340_002;
const REMIND_MS = 30 * 60_000;

/**
 * Watches deliveries to platforms (josh first) so a stuck queue or dead-letter
 * never goes unnoticed. Every 30 s, one instance (advisory lock) reads the
 * health, logs problems as errors, and posts to ALERT_WEBHOOK_URL (any webhook
 * that takes `{ "text": ... }` — Slack, Google Chat, Teams): once when a
 * problem starts, a reminder every 30 min while it lasts, and once when it
 * clears. GET /api/health/delivery serves the same check to uptime monitors.
 */
@Injectable()
export class DeliveryMonitor {
  private readonly logger = new Logger(DeliveryMonitor.name);
  /** key → last time we alerted. ponytail: in memory — a restart or lock hand-over re-alerts once. */
  private readonly open = new Map<string, { problem: Problem; alertedAt: number }>();

  constructor(private readonly dataSource: DataSource) {}

  private thresholds() {
    const n = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);
    return {
      lagSeconds: n(process.env.DELIVERY_ALERT_LAG_SECONDS, DEFAULTS.lagSeconds),
      outboxLagSeconds: n(process.env.OUTBOX_ALERT_LAG_SECONDS, DEFAULTS.outboxLagSeconds),
      windowSeconds: DEFAULTS.windowSeconds,
    };
  }

  /** Current problems (read-only); also used by the health endpoint. */
  async check(): Promise<Problem[]> {
    const t = this.thresholds();
    const [subs, [outbox]] = await Promise.all([
      this.dataSource.query(SUBSCRIPTION_HEALTH_SQL, [t.windowSeconds]) as Promise<SubscriptionHealth[]>,
      this.dataSource.query(OUTBOX_HEALTH_SQL, [t.windowSeconds]) as Promise<OutboxHealth[]>,
    ]);
    return detectProblems(subs, outbox, t);
  }

  @ScheduledInterval('webhook-delivery-monitor', 30_000)
  async tick(): Promise<void> {
    try {
      await this.dataSource.transaction(async (m) => {
        const [{ locked }] = await m.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [MONITOR_LOCK_KEY]);
        if (locked) await this.evaluate(await this.check());
      });
    } catch (error) {
      this.logger.error(`delivery monitor failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /** Decides what to send for this round's problems. Exposed for tests. */
  async evaluate(problems: Problem[], now = Date.now()): Promise<void> {
    const seen = new Set<string>();
    for (const p of problems) {
      seen.add(p.key);
      this.logger.error(p.message);
      const prev = this.open.get(p.key);
      if (!prev || now - prev.alertedAt >= REMIND_MS) {
        await this.post(`${prev ? '🔴 still' : '🔴'} commerce → platforms: ${p.message}`);
        this.open.set(p.key, { problem: p, alertedAt: now });
      }
    }
    for (const [key, prev] of this.open) {
      if (seen.has(key)) continue;
      this.open.delete(key);
      if (RECOVERABLE.includes(prev.problem.kind)) await this.post(`✅ recovered: ${prev.problem.message.split(':')[0]}`);
    }
  }

  private async post(text: string): Promise<void> {
    const url = process.env.ALERT_WEBHOOK_URL?.trim();
    if (!url) return;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(10_000) });
      if (!res.ok) this.logger.warn(`alert webhook answered ${res.status}`);
    } catch (error) {
      this.logger.warn(`alert webhook unreachable: ${error instanceof Error ? error.message : error}`);
    }
  }
}
