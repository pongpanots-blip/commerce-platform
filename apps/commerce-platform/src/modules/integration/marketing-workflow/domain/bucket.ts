import { createHash } from 'node:crypto';
import type { SplitBranch } from './workflow.types';

/** Stable 0–99 from any key (sha256, first 4 bytes). */
export const bucket = (key: string): number => createHash('sha256').update(key).digest().readUInt32BE(0) % 100;

/** A/B split: the same enrollment + step always lands in the same branch. */
export function pickBranch(enrollmentId: string, stepId: string, branches: SplitBranch[]): SplitBranch | null {
  const b = bucket(`${enrollmentId}:${stepId}`);
  let acc = 0;
  for (const branch of branches) { acc += branch.percent; if (b < acc) return branch; }
  return branches[branches.length - 1] ?? null;
}
