import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { EventCatalogService } from './event-catalog.service';

const row = { name: 'add_to_cart', label: 'ใส่ตะกร้า', description: null, evidence: 'browser', status: 'active',
  attributes: [{ key: 'price', type: 'number', label: '' }, { key: 'item_id', type: 'string', label: '' }], createdAt: new Date(), updatedAt: new Date() };

function setup(activeSteps: unknown[] = [], segmentRules: unknown[] = []) {
  const rows = { find: jest.fn(async () => [row]), findOneBy: jest.fn(async () => ({ ...row })), save: jest.fn(async (r: object) => ({ ...row, ...r })) };
  const db = { query: jest.fn(async (sql: string) => {
    if (sql.includes('FROM marketing_workflows')) return activeSteps.map((steps, i) => ({ id: `w${i}`, name: `W${i}`, trigger_config: {}, exit_on_goal: null, steps }));
    if (sql.includes('FROM marketing_dynamic_segments')) return segmentRules.map((rule, i) => ({ id: `s${i}`, name: `S${i}`, rule }));
    return [];
  }) };
  return new EventCatalogService(rows as never, db as never);
}

describe('EventCatalogService', () => {
  it('refuses to archive an event an active workflow waits for', async () => {
    const svc = setup([[{ type: 'wait_event', eventName: 'add_to_cart', filters: [] }]]);
    await expect(svc.archive('add_to_cart')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to archive an attribute a dynamic segment sums', async () => {
    const svc = setup([], [{ kind: 'event', name: 'add_to_cart', measure: { sum: 'price' }, op: 'gte', value: 1, window: { lastDays: 7 }, filters: [] }]);
    const next = { ...row, attributes: [{ ...row.attributes[0], archived: true }, row.attributes[1]] };
    await expect(svc.update('add_to_cart', next as never)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects PII attributes and type changes', async () => {
    const svc = setup();
    await expect(svc.update('add_to_cart', { ...row, attributes: [...row.attributes, { key: 'email', type: 'string', label: '' }] } as never))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(svc.update('add_to_cart', { ...row, attributes: [{ key: 'price', type: 'string', label: '' }, row.attributes[1]] } as never))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
