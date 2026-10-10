import { HttpException, HttpStatus, Injectable, Logger, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { parse } from '../../growth/growth.validation';
import { normalizeEvent, type Rejection } from '../domain/event-catalog';
import { EventsStore, type AcceptedEvent } from '../infrastructure/events.store';
import { ingestSchema } from '../presentation/events.schemas';
import { EventCatalogService } from './event-catalog.service';

export type IngestResult = { eventId: string; status: 'accepted' | 'duplicate' } | { eventId: string; status: 'rejected'; reason: Rejection };
const MAX_BODY_BYTES = 32 * 1024;
const DEVICE_EVENTS_PER_MINUTE = 60;
const enabled = () => process.env.MARKETING_EVENTS_INGEST_ENABLED === 'true';

/**
 * Fixed one-minute window per device. ponytail: per process — move to a Redis counter if commerce-platform runs more
 * than one instance.
 */
class DeviceLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  take(deviceId: string, n: number, now: number): boolean {
    if (this.windows.size > 10_000) for (const [k, w] of this.windows) if (now - w.start >= 60_000) this.windows.delete(k);
    const w = this.windows.get(deviceId);
    if (!w || now - w.start >= 60_000) { this.windows.set(deviceId, { start: now, count: n }); return n <= DEVICE_EVENTS_PER_MINUTE; }
    if (w.count + n > DEVICE_EVENTS_PER_MINUTE) return false;
    w.count += n;
    return true;
  }
}

/** POST /api/events (spec §3): validate, store once per event id, signal workflows after commit. No per-request logs. */
@Injectable()
export class EventIngestService {
  private readonly logger = new Logger(EventIngestService.name);
  private readonly limiter = new DeviceLimiter();
  private counts: Record<string, number> = {};
  private countsSince = Date.now();

  constructor(private readonly store: EventsStore, private readonly catalog: EventCatalogService, private readonly emitter: EventEmitter2) {}

  async ingest(raw: unknown, now = new Date()): Promise<{ results: IngestResult[] }> {
    if (!enabled()) throw new ServiceUnavailableException({ code: 'ingest_disabled' });
    if (Buffer.byteLength(JSON.stringify(raw ?? null), 'utf8') > MAX_BODY_BYTES) throw new PayloadTooLargeException('too_large');
    const body = parse(ingestSchema, raw);
    if (!this.limiter.take(body.deviceId, body.events.length, now.getTime())) throw new HttpException('Too many events', HttpStatus.TOO_MANY_REQUESTS);
    const catalog = await this.catalog.byName();
    const results = new Map<string, IngestResult>();
    const accepted: AcceptedEvent[] = [];
    for (const e of body.events) {
      const n = normalizeEvent(catalog.get(e.name), e, now);
      if ('reason' in n) { results.set(e.eventId, { eventId: e.eventId, status: 'rejected', reason: n.reason }); continue; }
      accepted.push({ eventId: e.eventId, name: e.name, occurredAt: n.occurredAt, attributes: n.attributes,
        companyId: e.context?.companyId ?? null, branchId: e.context?.branchId ?? null, actorKind: e.context?.actorKind ?? null });
    }
    const stored = accepted.length ? await this.store.ingest({
      deviceId: body.deviceId, platform: body.platform, pushSubscriptionId: body.pushSubscriptionId ?? null, schemaVersion: body.schemaVersion,
      source: body.platform === 'web' ? 'shop_browser' : 'mobile_app', environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    }, accepted, now) : new Set<string>();
    for (const e of accepted) results.set(e.eventId, { eventId: e.eventId, status: stored.has(e.eventId) ? 'accepted' : 'duplicate' });
    const ordered = body.events.map((e) => results.get(e.eventId)!);
    this.count(ordered, now.getTime());
    if (stored.size) this.emitter.emit('marketing-trigger.events', { eventIds: [...stored] });
    return { results: ordered };
  }

  /** One log line per 5 minutes with totals (spec §3: no per-request logs). */
  private count(results: IngestResult[], now: number) {
    for (const r of results) { const k = r.status === 'rejected' ? `rejected:${r.reason}` : r.status; this.counts[k] = (this.counts[k] ?? 0) + 1; }
    if (now - this.countsSince < 5 * 60_000) return;
    this.logger.log(`events ingest ${JSON.stringify(this.counts)}`);
    this.counts = {}; this.countsSince = now;
  }
}
