import { ConflictException } from '@nestjs/common';
import { DynamicSegmentsService } from './dynamic-segments.service';

const S = '5e000000-0000-4000-8000-000000000001';
const rule = { kind: 'event', name: 'add_to_cart', measure: 'count', op: 'gte', value: 1, window: { lastDays: 7 }, filters: [] };

function setup(activeAudience: unknown[] = []) {
  const rows = { find: jest.fn(async () => []), findOneBy: jest.fn(async () => ({ id: S, name: 'Cart', description: null, rule, createdBy: null, createdAt: new Date(), updatedAt: new Date() })),
    save: jest.fn(async (r: object) => ({ id: S, createdAt: new Date(), updatedAt: new Date(), ...r })), delete: jest.fn() };
  const db = { query: jest.fn(async () => activeAudience.map((steps, i) => ({ id: `w${i}`, name: `W${i}`, steps }))) };
  const rules = { context: jest.fn(async () => ({ catalog: new Map(), coverageStart: null, segmentIds: null, now: new Date() })), count: jest.fn(async () => 3) };
  return { svc: new DynamicSegmentsService(rows as never, db as never, rules as never), rows };
}

describe('DynamicSegmentsService', () => {
  it('saves a draft rule with its issues (catalog empty → reported, not thrown)', async () => {
    const { svc } = setup();
    const saved = await svc.create({ name: 'Cart', description: null, rule: rule as never }, 'm@x');
    expect(saved.issues).toEqual(['ไม่มี event "add_to_cart" ใน catalog']);
  });

  it('cannot be deleted while an active workflow uses it', async () => {
    const { svc, rows } = setup([[{ type: 'audience', dynamicSegmentIds: [S] }]]);
    await expect(svc.remove(S)).rejects.toBeInstanceOf(ConflictException);
    expect(rows.delete).not.toHaveBeenCalled();
  });

  it('an edit that leaves issues is refused while an active workflow uses the segment (rules are evaluated live)', async () => {
    const { svc, rows } = setup([[{ type: 'audience', dynamicSegmentIds: [S] }]]);
    await expect(svc.update(S, { name: 'Cart', description: null, rule: rule as never })).rejects.toBeInstanceOf(ConflictException);
    expect(rows.save).not.toHaveBeenCalled();
    const unused = setup([]);
    await expect(unused.svc.update(S, { name: 'Cart', description: null, rule: rule as never })).resolves.toMatchObject({ issues: ['ไม่มี event "add_to_cart" ใน catalog'] });
  });
});
