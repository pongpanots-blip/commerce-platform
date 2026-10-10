import { randomUUID } from 'node:crypto';
import { bucket, pickBranch } from './bucket';

const branches = [{ id: 'a', label: 'A', percent: 20, nextId: null }, { id: 'b', label: 'B', percent: 30, nextId: null }, { id: 'c', label: 'C', percent: 50, nextId: null }];

describe('bucket / pickBranch', () => {
  it('is deterministic', () => {
    const e = randomUUID();
    expect(bucket(e)).toBe(bucket(e));
    expect(pickBranch(e, 's1', branches)).toBe(pickBranch(e, 's1', branches));
  });
  it('splits 10,000 enrollments close to the percents (±2 points)', () => {
    const hits: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 10_000; i++) hits[pickBranch(randomUUID(), 's1', branches)!.id]++;
    expect(Math.abs(hits.a / 100 - 20)).toBeLessThanOrEqual(2);
    expect(Math.abs(hits.b / 100 - 30)).toBeLessThanOrEqual(2);
    expect(Math.abs(hits.c / 100 - 50)).toBeLessThanOrEqual(2);
  });
  it('returns null with no branches', () => expect(pickBranch('e', 's', [])).toBeNull());
});
