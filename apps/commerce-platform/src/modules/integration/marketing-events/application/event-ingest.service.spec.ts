import { HttpException, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import type { EventDefinition } from '@cp/marketing-workflow';
import { EventIngestService } from './event-ingest.service';

const def: EventDefinition = { name: 'add_to_cart', label: '', description: null, evidence: 'browser', status: 'active', createdAt: '', updatedAt: '',
  attributes: [{ key: 'price', type: 'number', label: '' }] };
const now = new Date('2026-10-10T10:00:00Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ev = (n: number, over: object = {}) => ({ eventId: id(n), name: 'add_to_cart', occurredAt: now.toISOString(), attributes: { price: 10 }, ...over });
const body = (events: object[], over: object = {}) => ({ schemaVersion: 1, deviceId: 'a'.repeat(32), platform: 'web', events, ...over });

function setup(already: string[] = []) {
  const stored = new Set(already);
  const store = { ingest: jest.fn(async (_d: unknown, events: { eventId: string }[]) => {
    const fresh = new Set<string>();
    for (const e of events) if (!stored.has(e.eventId)) { stored.add(e.eventId); fresh.add(e.eventId); }
    return fresh;
  }) };
  const catalog = { byName: jest.fn(async () => new Map([[def.name, def]])) };
  const emitter = { emit: jest.fn() };
  return { svc: new EventIngestService(store as never, catalog as never, emitter as never), store, emitter };
}

describe('EventIngestService', () => {
  beforeEach(() => { process.env.MARKETING_EVENTS_INGEST_ENABLED = 'true'; });
  afterAll(() => { delete process.env.MARKETING_EVENTS_INGEST_ENABLED; });

  it('answers per event in request order and signals only newly stored events', async () => {
    const s = setup([id(2)]);
    const r = await s.svc.ingest(body([ev(1), ev(2), ev(3, { name: 'nope' }), ev(4, { attributes: { price: 'x' } })]), now);
    expect(r.results).toEqual([
      { eventId: id(1), status: 'accepted' }, { eventId: id(2), status: 'duplicate' },
      { eventId: id(3), status: 'rejected', reason: 'unknown_event' }, { eventId: id(4), status: 'rejected', reason: 'bad_attribute_type' },
    ]);
    expect(s.emitter.emit).toHaveBeenCalledWith('marketing-trigger.events', { eventIds: [id(1)] });
  });

  it('posting the same batch twice stores it once and signals once', async () => {
    const s = setup();
    await s.svc.ingest(body([ev(1)]), now);
    const again = await s.svc.ingest(body([ev(1)]), now);
    expect(again.results).toEqual([{ eventId: id(1), status: 'duplicate' }]);
    expect(s.emitter.emit).toHaveBeenCalledTimes(1);
  });

  it('server sets source and environment; the client cannot', async () => {
    const s = setup();
    await expect(s.svc.ingest(body([ev(1)], { source: 'commerce_server' }), now)).rejects.toThrow();
    await s.svc.ingest(body([ev(1)], { platform: 'ios' }), now);
    expect(s.store.ingest.mock.calls[0][0]).toMatchObject({ source: 'mobile_app', platform: 'ios' });
  });

  it('is off unless enabled, refuses large bodies, bad device ids and too many events per device', async () => {
    const s = setup();
    delete process.env.MARKETING_EVENTS_INGEST_ENABLED;
    await expect(s.svc.ingest(body([ev(1)]), now)).rejects.toBeInstanceOf(ServiceUnavailableException);
    process.env.MARKETING_EVENTS_INGEST_ENABLED = 'true';
    await expect(s.svc.ingest(body([ev(1, { attributes: { price: 1, pad: 'x'.repeat(40_000) } })]), now)).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(s.svc.ingest(body([ev(1)], { deviceId: 'short' }), now)).rejects.toThrow();
    const batch = (start: number) => body(Array.from({ length: 20 }, (_, i) => ev(start + i)));
    await s.svc.ingest(batch(100), now); await s.svc.ingest(batch(200), now); await s.svc.ingest(batch(300), now);
    await expect(s.svc.ingest(batch(400), now)).rejects.toBeInstanceOf(HttpException);
    await expect(s.svc.ingest(batch(500), new Date(now.getTime() + 61_000))).resolves.toBeDefined();
  });
});
