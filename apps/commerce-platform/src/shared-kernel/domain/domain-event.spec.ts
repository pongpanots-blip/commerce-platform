import { DomainEvent } from './domain-event';
import { ok, err } from './result';

class ThingHappened extends DomainEvent<{ n: number }> {
  readonly type = 'thing.happened';
}

describe('DomainEvent', () => {
  it('assigns a distinct eventId to each instance', () => {
    const a = new ThingHappened('agg-1', { n: 1 });
    const b = new ThingHappened('agg-1', { n: 2 });
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.eventId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('exposes its type, aggregateId, and payload', () => {
    const e = new ThingHappened('agg-9', { n: 42 }, { source: 'test' });
    expect(e.type).toBe('thing.happened');
    expect(e.aggregateId).toBe('agg-9');
    expect(e.payload).toEqual({ n: 42 });
    expect(e.metadata).toEqual({ source: 'test' });
    expect(e.occurredAt).toBeInstanceOf(Date);
  });
});

describe('Result', () => {
  it('ok/err construct discriminated results', () => {
    const good = ok(5);
    const bad = err(new Error('nope'));
    expect(good).toEqual({ ok: true, value: 5 });
    expect(bad.ok).toBe(false);
  });
});
