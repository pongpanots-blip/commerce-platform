import type { EventDefinition } from '@cp/marketing-workflow';
import { definitionIssues, isPiiKey, normalizeEvent } from './event-catalog';

const def: EventDefinition = {
  name: 'add_to_cart', label: 'ใส่ตะกร้า', description: null, evidence: 'browser', status: 'active', createdAt: '', updatedAt: '',
  attributes: [
    { key: 'item_id', type: 'string', label: '' }, { key: 'price', type: 'number', label: '' },
    { key: 'gift', type: 'boolean', label: '' }, { key: 'deliver_on', type: 'date', label: '' }, { key: 'old', type: 'string', label: '', archived: true },
  ],
};
const now = new Date('2026-10-10T10:00:00Z');

describe('event catalog', () => {
  it('rejects PII attribute names in any case or dash form', () => {
    expect(isPiiKey('Email')).toBe(true);
    expect(isPiiKey('first-name')).toBe(true);
    expect(isPiiKey('item_id')).toBe(false);
    expect(definitionIssues({ name: 'x_y', label: 'X', description: null, evidence: 'browser', attributes: [{ key: 'phone', type: 'string', label: '' }] }))
      .toEqual(['attribute "phone": ห้ามเก็บข้อมูลส่วนบุคคล']);
  });

  it('keeps name and attribute types fixed once created', () => {
    const issues = definitionIssues({ ...def, attributes: [{ key: 'item_id', type: 'number', label: '' }] }, def);
    expect(issues).toContain('เปลี่ยนชนิดของ "item_id" ไม่ได้');
    expect(issues).toContain('ลบ attribute "price" ไม่ได้ (archive แทน)');
  });

  it('keeps declared attributes, drops undeclared and archived ones, normalises dates', () => {
    const r = normalizeEvent(def, { occurredAt: '2026-10-10T16:59:00+07:00', attributes: { item_id: 'SKU-1', price: 199.5, gift: false, deliver_on: '2026-10-12', extra: 'x', old: 'y' } }, now);
    expect(r).toEqual({ ok: true, occurredAt: new Date('2026-10-10T09:59:00Z'),
      attributes: { item_id: 'SKU-1', price: 199.5, gift: false, deliver_on: '2026-10-12T00:00:00.000Z' } });
  });

  it.each([
    [{ price: '199' }, 'bad_attribute_type'],
    [{ price: { $gt: 1 } }, 'bad_attribute_type'],
    [{ item_id: "x'); DROP TABLE marketing_events;--".padEnd(501, 'x') }, 'bad_attribute_type'],
    [Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 1])), 'too_large'],
    [{ item_id: 'x'.repeat(2100) }, 'too_large'],
  ])('rejects %j as %s', (attributes, reason) => {
    expect(normalizeEvent(def, { occurredAt: now.toISOString(), attributes }, now)).toEqual({ ok: false, reason });
  });

  it('rejects unknown, archived, future and stale events', () => {
    expect(normalizeEvent(undefined, { occurredAt: now.toISOString() }, now)).toEqual({ ok: false, reason: 'unknown_event' });
    expect(normalizeEvent({ ...def, status: 'archived' }, { occurredAt: now.toISOString() }, now)).toEqual({ ok: false, reason: 'archived_event' });
    expect(normalizeEvent(def, { occurredAt: '2026-10-10T10:06:00Z' }, now)).toEqual({ ok: false, reason: 'in_future' });
    expect(normalizeEvent(def, { occurredAt: '2026-10-03T09:59:00Z' }, now)).toEqual({ ok: false, reason: 'too_old' });
  });
});
