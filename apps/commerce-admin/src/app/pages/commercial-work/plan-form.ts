import { z } from "zod";
import {
  planScenarioSchema,
  planUuid,
  type PlanKind,
  type PlanScenario,
  type PlanReceipt,
} from "../../../../../commerce-platform/src/modules/integration/commercial-work/commercial-work";
import { commerceText as text } from "../../commerce-copy";
export const formSchema = z
  .object({
    kind: z.enum(["sales_work", "marketing_readiness"]),
    task: z.string(),
    name: z.string(),
    subjectId: z.string(),
    orderId: z.string(),
    note: z.string(),
    dueDate: z.string(),
    sourceFingerprint: z.string(),
    lines: z.array(z.object({ sku: z.string(), proposedQuantity: z.string() })),
  })
  .strict();
export type PlanForm = z.infer<typeof formSchema>;
export const blankPlanForm = (kind: PlanKind): PlanForm => ({
  kind,
  task: kind === "sales_work" ? "follow_up" : "campaign_brief",
  name: "",
  subjectId: "",
  orderId: "",
  note: "",
  dueDate: "",
  sourceFingerprint: "",
  lines: [],
});
export const formFromPlan = (s: PlanScenario): PlanForm => ({
  ...s,
  orderId: s.orderId ?? "",
  dueDate: s.dueDate ?? "",
});
export function buildPlanScenario(form: PlanForm) {
  const r = planScenarioSchema.safeParse({
    ...form,
    orderId: form.orderId || null,
    dueDate: form.dueDate || null,
  });
  const errors: Record<string, string> = {};
  if (!r.success)
    for (const i of r.error.issues)
      errors[i.path.join(".")] = text(
        "ตรวจค่านี้: ระบุชื่อ เหตุผล และแหล่งข้อมูลที่ถูกต้อง ปริมาณต้องเป็นบวก ทศนิยมไม่เกิน 3 ตำแหน่ง",
        "Check this value: enter a name, reason and valid source; quantities must be positive with at most 3 decimals.",
      );
  return { scenario: r.success ? r.data : null, errors };
}
const formKey = (owner: string, kind: PlanKind, id?: string) =>
  `cp:commercial-form:v1:${kind}:${encodeURIComponent(owner)}:${id ?? "new"}`;
export function readPlanForm(owner: string, kind: PlanKind, id?: string) {
  try {
    const b = z
      .object({
        revision: z.number().int().positive().nullable(),
        form: formSchema,
      })
      .parse(
        JSON.parse(sessionStorage.getItem(formKey(owner, kind, id)) ?? "null"),
      );
    return b.form.kind === kind ? b : null;
  } catch {
    return null;
  }
}
export function storePlanForm(
  owner: string,
  id: string | undefined,
  revision: number | null,
  form: PlanForm,
) {
  const raw = JSON.stringify({ revision, form: formSchema.parse(form) }),
    key = formKey(owner, form.kind, id);
  sessionStorage.setItem(key, raw);
  if (sessionStorage.getItem(key) !== raw)
    throw Error("Form backup unavailable");
}
export const clearPlanForm = (owner: string, kind: PlanKind, id?: string) =>
  sessionStorage.removeItem(formKey(owner, kind, id));
const jobSchema = z
  .object({
    schemaVersion: z.literal(1),
    owner: z.string().min(1).max(128),
    requestId: planUuid,
    draftId: planUuid.nullable(),
    revision: z.number().int().positive().nullable(),
    scenario: planScenarioSchema,
    createdAt: z.iso.datetime(),
    conflict: z.boolean(),
  })
  .strict()
  .superRefine((v, c) => {
    if ((v.draftId === null) !== (v.revision === null))
      c.addIssue({ code: "custom", message: "Invalid operation" });
  });
export type PlanSaveJob = z.infer<typeof jobSchema>;
const prefix = (owner: string, kind: PlanKind) =>
  `cp:commercial-request:v1:${kind}:${encodeURIComponent(owner)}:`;
const jobKey = (owner: string, kind: PlanKind, id: string) =>
  prefix(owner, kind) + id;
export function readPlanJobs(owner: string, kind: PlanKind): PlanSaveJob[] {
  const result: PlanSaveJob[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(prefix(owner, kind))) continue;
      try {
        const j = jobSchema.parse(
          JSON.parse(localStorage.getItem(k) ?? "null"),
        );
        if (
          j.owner === owner &&
          j.scenario.kind === kind &&
          k === jobKey(owner, kind, j.requestId)
        )
          result.push(j);
      } catch {}
    }
  } catch {}
  return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export function storePlanJob(job: PlanSaveJob) {
  const raw = JSON.stringify(jobSchema.parse(job)),
    k = jobKey(job.owner, job.scenario.kind, job.requestId);
  const previous = localStorage.getItem(k);
  if (previous) {
    const old = jobSchema.parse(JSON.parse(previous));
    if (
      JSON.stringify({ ...old, conflict: false }) !==
        JSON.stringify({ ...job, conflict: false }) ||
      (old.conflict && !job.conflict)
    )
      throw Error("Recovery request identity changed");
  }
  localStorage.setItem(k, raw);
  if (localStorage.getItem(k) !== raw)
    throw Error("Request backup unavailable");
  window.dispatchEvent(new Event("cp-commercial-journal"));
}
export function clearPlanJob(owner: string, kind: PlanKind, id: string) {
  localStorage.removeItem(jobKey(owner, kind, id));
  window.dispatchEvent(new Event("cp-commercial-journal"));
}
export const planPacket = (j: PlanSaveJob) => ({
  requestId: j.requestId,
  scenario: j.scenario,
  ...(j.revision === null ? {} : { revision: j.revision }),
});
export function verifyPlanJob(receipt: PlanReceipt, job: PlanSaveJob) {
  if (
    (job.draftId && receipt.id !== job.draftId) ||
    receipt.revision !== (job.revision === null ? 1 : job.revision + 1) ||
    JSON.stringify(receipt.scenario) !==
      JSON.stringify(planScenarioSchema.parse(job.scenario))
  )
    throw Error("Saved planning identity mismatch");
  return receipt;
}
