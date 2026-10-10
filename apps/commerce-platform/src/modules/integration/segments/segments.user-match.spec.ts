import { SegmentsService } from './segments.service';
import { UserSegmentRuleType } from './rule-type.enum';

const U = '11111111-1111-4111-8111-111111111111';
function setup(segment: Record<string, unknown> | null, rows: unknown[] = [{ ok: 1 }]) {
  const calls: [string, unknown[]][] = [];
  const m = {
    getRepository: () => ({ findOneBy: jest.fn(async () => segment) }),
    query: jest.fn(async (sql: string, params: unknown[]) => { calls.push([sql, params]); return rows; }),
  };
  const compiler = { compile: jest.fn(() => ({ where: 'm.order_count >= $1', params: [3] })) };
  const svc = new SegmentsService({ manager: m } as never, {} as never, compiler as never);
  return { svc, m, calls };
}
const seg = (over: object) => ({ id: 's1', is_active: true, frozen_at: null, definition: null, rule_type: UserSegmentRuleType.MANUAL_USER_LIST, rule_config: {}, ...over });

describe('SegmentsService.userMatchesSegment', () => {
  it('checks frozen members', async () => {
    const { svc, calls } = setup(seg({ frozen_at: new Date(), definition: { any: 1 } }));
    await expect(svc.userMatchesSegment('s1', U)).resolves.toBe(true);
    expect(calls[0][0]).toContain('segment_members');
  });
  it('compiles a live definition and pins the user as the last parameter', async () => {
    const { svc, calls } = setup(seg({ definition: { any: 1 } }));
    await svc.userMatchesSegment('s1', U);
    expect(calls[0][0]).toContain('AND u.id = $2');
    expect(calls[0][1]).toEqual([3, U]);
  });
  it('is false for rules commerce cannot evaluate, inactive or missing segments', async () => {
    await expect(setup(seg({ rule_type: UserSegmentRuleType.GUEST })).svc.userMatchesSegment('s1', U)).resolves.toBe(false);
    await expect(setup(seg({ is_active: false, definition: {} })).svc.userMatchesSegment('s1', U)).resolves.toBe(false);
    await expect(setup(null).svc.userMatchesSegment('s1', U)).resolves.toBe(false);
  });
  it('matches a manual list only for customers that exist', async () => {
    const { svc } = setup(seg({ rule_config: { user_ids: [U] } }), [{ ok: 1 }]);
    await expect(svc.userMatchesSegment('s1', U)).resolves.toBe(true);
    await expect(setup(seg({ rule_config: { user_ids: [] } })).svc.userMatchesSegment('s1', U)).resolves.toBe(false);
  });
});
