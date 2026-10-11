import { describe, expect, it } from 'vitest';
import type { EventDefinition } from '@cp/marketing-workflow';
import { defaultFilter, describeRule, newEventLeaf } from './rule-helpers';

const cart: EventDefinition = { name: 'add_to_cart', label: 'ใส่ตะกร้า', description: null, evidence: 'browser', status: 'active', createdAt: '', updatedAt: '',
  attributes: [{ key: 'old', type: 'string', label: '', archived: true }, { key: 'price', type: 'number', label: 'ราคา' }] };

describe('rule helpers', () => {
  it('starts filters on the first live attribute with a value of its type', () => {
    expect(defaultFilter(cart)).toEqual({ key: 'price', op: 'gte', value: 0 });
    expect(defaultFilter({ ...cart, attributes: [] })).toBeNull();
  });
  it('a new leaf counts the event at least once in 7 days', () => {
    expect(newEventLeaf(cart)).toEqual({ kind: 'event', name: 'add_to_cart', measure: 'count', op: 'gte', value: 1, window: { lastDays: 7 }, filters: [] });
  });
  it('describes rules in one line', () => {
    const names = new Map([['add_to_cart', 'ใส่ตะกร้า']]);
    expect(describeRule({ op: 'OR', children: [newEventLeaf(cart), { kind: 'event', name: 'add_to_cart', measure: { sum: 'price' }, op: 'gte', value: 500, window: { lastDays: 30 }, filters: [] }] }, names))
      .toBe('(ใส่ตะกร้า ≥ 1 ครั้ง / 7 วัน หรือ ใส่ตะกร้า ผลรวมของ price ≥ 500 / 30 วัน)');
    expect(describeRule({ op: 'AND', children: [newEventLeaf(cart), { kind: 'segment', segmentId: 'seg-1' }] }, new Map([...names, ['seg-1', 'ลูกค้าประจำ']])))
      .toBe('(ใส่ตะกร้า ≥ 1 ครั้ง / 7 วัน และ กลุ่มลูกค้า ลูกค้าประจำ)');
  });
});
