import { z } from "zod";
import {
  manualPriceItemSchema,
  manualPricePacketSchema,
  manualPriceSelectionSchema,
  manualPriceReviewSchema,
  verifyManualPriceReview,
  type ManualPriceSelection,
} from "../../../../../commerce-platform/src/modules/commerce/product-prices/manual-price-contracts";
const field = z.strictObject({
  mode: z.enum(["keep", "set", "clear"]),
  value: z.string(),
});
export const manualFormSchema = z.strictObject({
  item: manualPriceItemSchema,
  fields: z.strictObject({
    sellingUnitPrice: field,
    orderingPrice: field,
    moq: field,
  }),
});
const jobSchema = z.strictObject({
  owner: z.string().min(1),
  packet: manualPricePacketSchema,
  review: manualPriceReviewSchema,
  conflict: z.boolean(),
});
export type ManualPriceJob = z.infer<typeof jobSchema>;
export type ManualPriceForm = z.infer<typeof manualFormSchema>;
const prefix = (owner: string) =>
  `cp-manual-price-request:${encodeURIComponent(owner)}:`;
const jobKey = (owner: string, id: string) => prefix(owner) + id;
const draftKey = (owner: string, sku: string) =>
  `cp-manual-price-form:${encodeURIComponent(owner)}:${encodeURIComponent(sku)}`;
const reviewKey = (owner: string, sku: string) =>
  `cp-manual-price-review:${encodeURIComponent(owner)}:${encodeURIComponent(sku)}`;
const notify = () =>
  window.dispatchEvent(new Event("cp-price-approval-journal"));
function read<T>(
  key: string,
  schema: { safeParse(raw: unknown): { success: boolean; data?: T } },
): T | null {
  try {
    const result = schema.safeParse(
      JSON.parse(localStorage.getItem(key) ?? "null"),
    );
    return result.success ? (result.data ?? null) : null;
  } catch {
    return null;
  }
}
function store<T>(key: string, value: T, schema: { parse(raw: unknown): T }) {
  const valid = schema.parse(value);
  localStorage.setItem(key, JSON.stringify(valid));
  if (
    JSON.stringify(
      read(key, {
        safeParse: (raw) => {
          try {
            return { success: true, data: schema.parse(raw) };
          } catch {
            return { success: false };
          }
        },
      }),
    ) !== JSON.stringify(valid)
  )
    throw Error("Recovery storage unavailable. No change was sent.");
}
export function readManualForm(owner: string, sku: string) {
  const v = read(draftKey(owner, sku), manualFormSchema);
  return v?.item.sku === sku ? v : null;
}
export function storeManualForm(owner: string, form: ManualPriceForm) {
  store(draftKey(owner, form.item.sku), form, manualFormSchema);
}
export function readManualSelection(owner: string, sku: string) {
  const v = read(reviewKey(owner, sku), manualPriceSelectionSchema);
  return v?.sku === sku ? v : null;
}
export function storeManualSelection(
  owner: string,
  selection: ManualPriceSelection,
) {
  store(reviewKey(owner, selection.sku), selection, manualPriceSelectionSchema);
}
export function clearManualDraft(owner: string, sku: string, version: string) {
  if (readManualForm(owner, sku)?.item.version === version)
    localStorage.removeItem(draftKey(owner, sku));
  if (readManualSelection(owner, sku)?.version === version)
    localStorage.removeItem(reviewKey(owner, sku));
}
export function readManualJobs(owner: string): ManualPriceJob[] {
  try {
    return Array.from({ length: localStorage.length }, (_, n) =>
      localStorage.key(n),
    )
      .filter((k): k is string => !!k && k.startsWith(prefix(owner)))
      .sort()
      .flatMap((k) => {
        const j = read(k, jobSchema);
        if (!j || j.owner !== owner || k !== jobKey(owner, j.packet.requestId))
          return [];
        try {
          verifyManualPriceReview(j.review, j.packet);
          return [j];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
export function storeManualJob(job: ManualPriceJob) {
  const valid = jobSchema.parse(job);
  verifyManualPriceReview(valid.review, valid.packet);
  const jobs = readManualJobs(job.owner),
    prior = jobs.find((j) => j.packet.requestId === job.packet.requestId);
  if (
    prior &&
    (JSON.stringify(prior.packet) !== JSON.stringify(valid.packet) ||
      JSON.stringify(prior.review) !== JSON.stringify(valid.review))
  )
    throw Error("Original edit and evidence must remain immutable");
  if (!prior && jobs.length >= 30)
    throw Error("Resolve earlier requests before confirming");
  store(jobKey(job.owner, valid.packet.requestId), valid, jobSchema);
  notify();
}
export function clearManualJob(owner: string, id: string) {
  localStorage.removeItem(jobKey(owner, id));
  notify();
}
