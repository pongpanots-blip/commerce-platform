import { z } from 'zod';
import { scenarioSchema, uuid, type PromotionReceipt, sameScenario } from './promotion-contracts';
const jobSchema = z.object({ schemaVersion: z.literal(1), owner: z.string().min(1).max(128), requestId: uuid, draftId: uuid.nullable(), revision: z.number().int().positive().nullable(),
  scenario: scenarioSchema, createdAt: z.iso.datetime(), conflict: z.boolean() }).strict().superRefine((v, ctx) => {
    if ((v.draftId === null) !== (v.revision === null)) ctx.addIssue({ code: 'custom', message: 'Invalid operation' });
  });
export type PromotionSaveJob = z.infer<typeof jobSchema>;
const prefix = (owner: string) => `cp:promotion-request:v1:${encodeURIComponent(owner)}:`;
const key = (owner: string, id: string) => `${prefix(owner)}${id}`;
export function readPromotionJobs(owner: string): PromotionSaveJob[] {
  const jobs: PromotionSaveJob[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); if (!k?.startsWith(prefix(owner))) continue;
      try { const p = jobSchema.safeParse(JSON.parse(localStorage.getItem(k) ?? 'null'));
        if (p.success && p.data.owner === owner && k === key(owner, p.data.requestId)) jobs.push(p.data);
      } catch { /* One corrupt entry must not hide other recoverable requests. */ }
    }
  } catch { return jobs; }
  return jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export function storePromotionJob(job: PromotionSaveJob) {
  const valid = jobSchema.parse(job), k = key(job.owner, job.requestId);
  localStorage.setItem(k, JSON.stringify(valid));
  if (localStorage.getItem(k) !== JSON.stringify(valid)) throw new Error('Recovery request could not be retained');
  window.dispatchEvent(new Event('cp-promotion-journal'));
}
export function clearPromotionJob(owner: string, id: string) { localStorage.removeItem(key(owner, id)); window.dispatchEvent(new Event('cp-promotion-journal')); }
export const packetFor = (job: PromotionSaveJob) => ({ requestId: job.requestId, scenario: job.scenario, ...(job.revision === null ? {} : { revision: job.revision }) });
export function verifySavedJob(receipt: PromotionReceipt, job: PromotionSaveJob) {
  if (job.draftId !== null && receipt.id !== job.draftId || receipt.revision !== (job.revision === null ? 1 : job.revision + 1) || !sameScenario(receipt.scenario, job.scenario)) throw new Error('Saved operation could not be verified');
  return receipt;
}
