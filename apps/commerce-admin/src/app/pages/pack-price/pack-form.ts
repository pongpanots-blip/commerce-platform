import { z } from 'zod';
import { packScenarioSchema, uuid, type PackInputs, type PackReceipt, type PackScenario } from '../../../../../commerce-platform/src/modules/integration/pack-price-planning/pack-price';
import { commerceText as text } from '../../commerce-copy';

const formPack = z.object({ unit: z.string(), quantity: z.string(), count: z.string() });
const formProposal = z.object({ label: z.string(), pack: formPack, salePriceIncVat: z.string(), additionalCostExVat: z.string(), assumption: z.string() });
const formSchema = z.object({ name: z.string(), sku: z.string(), confirmedSku: z.string(), sourceFingerprint: z.string(), observationIds: z.array(z.string()).max(20), proposals: z.array(formProposal).max(6) });
export type PackForm = z.infer<typeof formSchema>;
export const blankProposal = (index: number, inputs?: PackInputs) => ({ label: `${text('แบบที่', 'Option')} ${index}`, pack: { unit: inputs?.product.basis?.unit ?? 'kg', quantity: inputs?.product.basis?.quantity ?? '1', count: String(inputs?.product.basis?.count ?? 1) }, salePriceIncVat: inputs?.product.currentPriceIncVat ?? '', additionalCostExVat: '0', assumption: '' });
export const blankPackForm = (): PackForm => ({ name: '', sku: '', confirmedSku: '', sourceFingerprint: '', observationIds: [], proposals: [blankProposal(1)] });
export function formFromPack(scenario: PackScenario): PackForm {
  return { name: scenario.name, sku: scenario.sku, confirmedSku: scenario.sku, sourceFingerprint: scenario.sourceFingerprint, observationIds: [...scenario.observationIds], proposals: scenario.proposals.map(p => ({ ...p, pack: { ...p.pack, count: String(p.pack.count) } })) };
}
export function buildPackScenario(form: PackForm) {
  const parsed = packScenarioSchema.safeParse({ kind: 'pack_price', name: form.name, sku: form.confirmedSku, sourceFingerprint: form.sourceFingerprint, observationIds: form.observationIds,
    proposals: form.proposals.map(p => ({ ...p, pack: { ...p.pack, count: /^\d+$/.test(p.pack.count) ? Number(p.pack.count) : NaN } })) });
  const errors: Record<string, string> = {};
  if (!parsed.success) for (const issue of parsed.error.issues) errors[issue.path.join('.')] = issue.message === 'Option names must differ' ? text('ใช้ชื่อแบบที่ไม่ซ้ำกัน', 'Use a distinct option name.') : text('ตรวจค่านี้: จำนวนและราคาต้องเป็นทศนิยมที่ถูกต้อง ชิ้นต้องเป็นจำนวนเต็ม และค่าเพิ่มต้องระบุสมมติฐาน', 'Check this value: use valid decimal quantities/prices, whole pieces, and a label for additional-cost assumptions.');
  return { scenario: parsed.success ? parsed.data : null, errors };
}
const backupKey = (owner: string, id?: string) => `cp:pack-price-form:v1:${encodeURIComponent(owner)}:${id ?? 'new'}`;
export function readPackForm(owner: string, id?: string) {
  try { return z.object({ revision: z.number().int().positive().nullable(), form: formSchema }).parse(JSON.parse(sessionStorage.getItem(backupKey(owner, id)) ?? 'null')); } catch { return null; }
}
export function storePackForm(owner: string, id: string | undefined, revision: number | null, form: PackForm) {
  const value = JSON.stringify({ revision, form: formSchema.parse(form) }); sessionStorage.setItem(backupKey(owner, id), value);
  if (sessionStorage.getItem(backupKey(owner, id)) !== value) throw Error('Form backup unavailable');
}
export const clearPackForm = (owner: string, id?: string) => sessionStorage.removeItem(backupKey(owner, id));
const jobSchema = z.object({ schemaVersion: z.literal(1), owner: z.string().min(1).max(128), requestId: uuid, draftId: uuid.nullable(), revision: z.number().int().positive().nullable(), scenario: packScenarioSchema, createdAt: z.iso.datetime(), conflict: z.boolean() }).strict().superRefine((v, c) => {
  if ((v.draftId === null) !== (v.revision === null)) c.addIssue({ code: 'custom', message: 'Invalid operation' });
});
export type PackSaveJob = z.infer<typeof jobSchema>;
const prefix = (owner: string) => `cp:pack-price-request:v1:${encodeURIComponent(owner)}:`;
const key = (owner: string, id: string) => prefix(owner) + id;
export function readPackJobs(owner: string): PackSaveJob[] {
  const jobs: PackSaveJob[] = [];
  try { for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i); if (!k?.startsWith(prefix(owner))) continue;
    try { const value = jobSchema.parse(JSON.parse(localStorage.getItem(k) ?? 'null')); if (value.owner === owner && k === key(owner, value.requestId)) jobs.push(value); } catch { /* Other valid requests remain recoverable. */ }
  } } catch { /* Storage access unavailable; never treat this as a saved draft. */ }
  return jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export function storePackJob(job: PackSaveJob) {
  const value = JSON.stringify(jobSchema.parse(job)), k = key(job.owner, job.requestId); localStorage.setItem(k, value);
  if (localStorage.getItem(k) !== value) throw Error('Recovery request unavailable'); window.dispatchEvent(new Event('cp-pack-price-journal'));
}
export function clearPackJob(owner: string, id: string) { localStorage.removeItem(key(owner, id)); window.dispatchEvent(new Event('cp-pack-price-journal')); }
export const packPacket = (job: PackSaveJob) => ({ requestId: job.requestId, scenario: job.scenario, ...(job.revision === null ? {} : { revision: job.revision }) });
export function verifyPackJob(receipt: PackReceipt, job: PackSaveJob) {
  if (job.draftId && receipt.id !== job.draftId || receipt.revision !== (job.revision === null ? 1 : job.revision + 1) || JSON.stringify(receipt.scenario) !== JSON.stringify(packScenarioSchema.parse(job.scenario))) throw Error('Saved operation identity mismatch');
  return receipt;
}
