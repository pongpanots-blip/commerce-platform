import { z } from 'zod';
import { goalScenarioSchema, goalUuid, type GoalScenario, type GoalReceipt } from '../../../../../commerce-platform/src/modules/integration/financial-goals/financial-goals';
import { commerceText as text } from '../../commerce-copy';
const formSchema = z.object({ name: z.string(), period: z.string(), metric: z.string(), target: z.string(), sourceFingerprint: z.string(), hypotheticalEnabled: z.boolean(), netSalesExVat: z.string(), internalCostExVat: z.string(), operatingExpensesExVat: z.string(), assumption: z.string() });
export type GoalForm = z.infer<typeof formSchema>;
export const blankGoalForm = (): GoalForm => ({ name: '', period: new Date().toISOString().slice(0, 7), metric: 'gross_profit_ex_vat', target: '', sourceFingerprint: '', hypotheticalEnabled: false, netSalesExVat: '', internalCostExVat: '', operatingExpensesExVat: '0', assumption: '' });
export const formFromGoal = (s: GoalScenario): GoalForm => ({ name: s.name, period: s.period, metric: s.metric, target: s.target, sourceFingerprint: s.sourceFingerprint, hypotheticalEnabled: !!s.hypothetical, netSalesExVat: s.hypothetical?.netSalesExVat ?? '', internalCostExVat: s.hypothetical?.internalCostExVat ?? '', operatingExpensesExVat: s.hypothetical?.operatingExpensesExVat ?? '0', assumption: s.hypothetical?.assumption ?? '' });
export function buildGoalScenario(form: GoalForm) {
  const parsed = goalScenarioSchema.safeParse({ kind: 'financial_goal', name: form.name, period: form.period, metric: form.metric, target: form.target, sourceFingerprint: form.sourceFingerprint,
    hypothetical: form.hypotheticalEnabled ? { netSalesExVat: form.netSalesExVat, internalCostExVat: form.internalCostExVat, operatingExpensesExVat: form.operatingExpensesExVat, assumption: form.assumption } : null });
  const errors: Record<string, string> = {};
  if (!parsed.success) for (const issue of parsed.error.issues) errors[issue.path.join('.').replace('hypothetical.', '')] = text('ตรวจค่านี้: ระบุชื่อและสมมติฐาน ใช้เดือนที่ถูกต้อง เงินทศนิยมไม่เกิน 2 ตำแหน่ง เปอร์เซ็นต์ไม่เกิน 100', 'Check this value: names and assumptions are required; use a valid month, money with at most 2 decimals, or a percentage up to 100.');
  return { scenario: parsed.success ? parsed.data : null, errors };
}
const backupKey = (owner: string, id?: string) => `cp:financial-goal-form:v1:${encodeURIComponent(owner)}:${id ?? 'new'}`;
export function readGoalForm(owner: string, id?: string) { try { return z.object({ revision: z.number().int().positive().nullable(), form: formSchema }).parse(JSON.parse(sessionStorage.getItem(backupKey(owner, id)) ?? 'null')); } catch { return null; } }
export function storeGoalForm(owner: string, id: string | undefined, revision: number | null, form: GoalForm) { const raw = JSON.stringify({ revision, form: formSchema.parse(form) }); sessionStorage.setItem(backupKey(owner, id), raw); if (sessionStorage.getItem(backupKey(owner, id)) !== raw) throw Error('Form backup unavailable'); }
export const clearGoalForm = (owner: string, id?: string) => sessionStorage.removeItem(backupKey(owner, id));
const jobSchema = z.object({ schemaVersion: z.literal(1), owner: z.string().min(1).max(128), requestId: goalUuid, draftId: goalUuid.nullable(), revision: z.number().int().positive().nullable(), scenario: goalScenarioSchema, createdAt: z.iso.datetime(), conflict: z.boolean() }).strict().superRefine((v, c) => { if ((v.draftId === null) !== (v.revision === null)) c.addIssue({ code: 'custom', message: 'Invalid operation' }); });
export type GoalSaveJob = z.infer<typeof jobSchema>;
const prefix = (owner: string) => `cp:financial-goal-request:v1:${encodeURIComponent(owner)}:`;
const jobKey = (owner: string, id: string) => prefix(owner) + id;
export function readGoalJobs(owner: string): GoalSaveJob[] {
  const result: GoalSaveJob[] = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!k?.startsWith(prefix(owner))) continue; try { const j = jobSchema.parse(JSON.parse(localStorage.getItem(k) ?? 'null')); if (j.owner === owner && k === jobKey(owner, j.requestId)) result.push(j); } catch { /* Keep other valid requests. */ } } } catch { /* Storage failure never establishes persistence. */ }
  return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export function storeGoalJob(job: GoalSaveJob) { const raw = JSON.stringify(jobSchema.parse(job)), k = jobKey(job.owner, job.requestId); localStorage.setItem(k, raw); if (localStorage.getItem(k) !== raw) throw Error('Request backup unavailable'); window.dispatchEvent(new Event('cp-financial-goal-journal')); }
export function clearGoalJob(owner: string, id: string) { localStorage.removeItem(jobKey(owner, id)); window.dispatchEvent(new Event('cp-financial-goal-journal')); }
export const goalPacket = (j: GoalSaveJob) => ({ requestId: j.requestId, scenario: j.scenario, ...(j.revision === null ? {} : { revision: j.revision }) });
export function verifyGoalJob(receipt: GoalReceipt, job: GoalSaveJob) { if (job.draftId && receipt.id !== job.draftId || receipt.revision !== (job.revision === null ? 1 : job.revision + 1) || JSON.stringify(receipt.scenario) !== JSON.stringify(goalScenarioSchema.parse(job.scenario))) throw Error('Saved goal identity mismatch'); return receipt; }
