import type { EventFilter } from '@cp/marketing-workflow';
import { filterIssues, matchesFilters, type Types } from './event-filter';

const types: Types = { item_id: 'string', price: 'number', gift: 'boolean', deliver_on: 'date', order_id: 'string' };
const now = new Date('2026-10-10T10:00:00Z');
const m = (attrs: Record<string, unknown>, filters: EventFilter[], trigger: Record<string, unknown> | null = null) => matchesFilters(attrs, filters, types, trigger, now);

describe('event filters', () => {
  it('compares by type and fails on a missing attribute', () => {
    expect(m({ price: 600 }, [{ key: 'price', op: 'gte', value: 500 }])).toBe(true);
    expect(m({ price: 400 }, [{ key: 'price', op: 'gte', value: 500 }])).toBe(false);
    expect(m({}, [{ key: 'price', op: 'neq', value: 500 }])).toBe(false);
    expect(m({ item_id: 'SKU-12' }, [{ key: 'item_id', op: 'contains', value: 'SKU' }])).toBe(true);
    expect(m({ item_id: 'B' }, [{ key: 'item_id', op: 'in', value: ['A', 'B'] }])).toBe(true);
    expect(m({ gift: true }, [{ key: 'gift', op: 'eq', value: true }])).toBe(true);
    expect(m({ deliver_on: '2026-10-08T00:00:00Z' }, [{ key: 'deliver_on', op: 'within_last_days', value: 3 }])).toBe(true);
    expect(m({ deliver_on: '2026-10-12T00:00:00Z' }, [{ key: 'deliver_on', op: 'within_next_days', value: 1 }])).toBe(false);
    expect(m({ deliver_on: '2026-10-01T00:00:00Z' }, [{ key: 'deliver_on', op: 'before', value: '2026-10-02' }])).toBe(true);
  });

  it('matches across events with fromTrigger, and fails when the trigger lacks the value', () => {
    const f: EventFilter[] = [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }];
    expect(m({ order_id: 'O1' }, f, { order_id: 'O1' })).toBe(true);
    expect(m({ order_id: 'O2' }, f, { order_id: 'O1' })).toBe(false);
    expect(m({ order_id: 'O1' }, f, {})).toBe(false);
    expect(m({ order_id: 'O1' }, f, null)).toBe(false);
  });

  it('validates keys, ops, values and fromTrigger use', () => {
    expect(filterIssues([{ key: 'nope', op: 'eq', value: 'x' }], types, null)).toEqual(['ไม่มี attribute "nope"']);
    expect(filterIssues([{ key: 'price', op: 'contains', value: 1 }], types, null)).toEqual(['"price" ใช้ contains ไม่ได้']);
    expect(filterIssues([{ key: 'price', op: 'gt', value: '1' }], types, null)).toEqual(['"price": ค่าไม่ถูกต้อง']);
    expect(filterIssues([{ key: 'deliver_on', op: 'before', value: '+010000-01-01' }], types, null)).toEqual(['"deliver_on": ค่าไม่ถูกต้อง']);
    expect(filterIssues([{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }], types, null))
      .toEqual(['"order_id": ค่าจาก event ที่ trigger ใช้ได้เฉพาะ workflow ที่เริ่มด้วย event']);
    expect(filterIssues([{ key: 'order_id', op: 'eq', value: { fromTrigger: 'price' } }], types, { price: 'number' }))
      .toEqual(['"order_id": attribute "price" ของ event ที่ trigger ไม่มีหรือชนิดไม่ตรง']);
    expect(filterIssues(Array.from({ length: 11 }, () => ({ key: 'gift', op: 'eq' as const, value: true })), types, null))
      .toEqual(['เงื่อนไข attribute ได้ไม่เกิน 10 ข้อ']);
  });
});
