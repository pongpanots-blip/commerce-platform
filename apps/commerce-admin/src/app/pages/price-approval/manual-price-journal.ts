import { z } from "zod";
import {
  manualPriceItemSchema,
  manualPricePacketSchema,
  manualPriceSelectionSchema,
  manualPriceReviewSchema,
  manualPricePatchSchema,
  verifyManualPriceReview,
  verifyManualPriceReceipt,
  type ManualPriceReceipt,
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
const fields = ["sellingUnitPrice", "orderingPrice", "moq"] as const;
export function initialManualPriceForm(
  item: ManualPriceForm["item"],
): ManualPriceForm {
  return {
    item,
    fields: {
      sellingUnitPrice: {
        mode: "keep",
        value: item.current.sellingUnitPrice ?? "",
      },
      orderingPrice: { mode: "keep", value: item.current.orderingPrice ?? "" },
      moq: {
        mode: "keep",
        value: item.current.moq == null ? "" : String(item.current.moq),
      },
    },
  };
}
/** Decimal text is checked before conversion, so extra decimals cannot round away. */
export function manualPatchFromForm(form: ManualPriceForm) {
  const valid = manualFormSchema.parse(form),
    raw: Record<string, number | null> = {};
  for (const key of fields) {
    const field = valid.fields[key],
      value = field.value.trim();
    if (field.mode === "clear") raw[key] = null;
    if (field.mode === "set") {
      const pattern = key === "moq" ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/;
      if (!pattern.test(value))
        throw new z.ZodError([
          {
            code: "custom",
            path: [key],
            message:
              "Enter a whole quantity or a price with at most two decimals",
          },
        ]);
      raw[key] = Number(value);
    }
  }
  return manualPricePatchSchema.parse(raw);
}
const prefix = (owner: string) =>
  `cp-manual-price-request:${encodeURIComponent(owner)}:`;
const jobKey = (owner: string, id: string) => prefix(owner) + id;
const draftKey = (owner: string, sku: string) =>
  `cp-manual-price-form:${encodeURIComponent(owner)}:${encodeURIComponent(sku)}`;
const reviewKey = (owner: string, sku: string) =>
  `cp-manual-price-review:${encodeURIComponent(owner)}:${encodeURIComponent(sku)}`;
const notify = () =>
  window.dispatchEvent(new Event("cp-price-approval-journal"));
const reviewedSelection = (packet: ManualPriceJob["packet"]) => ({
  sku: packet.sku,
  version: packet.version,
  patch: packet.patch,
});
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
  z.string().min(1).parse(owner);
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
  z.string().min(1).parse(owner);
  store(reviewKey(owner, selection.sku), selection, manualPriceSelectionSchema);
}
export function clearManualDraft(owner: string, receipt: ManualPriceReceipt) {
  const acknowledged = verifyManualPriceReceipt(receipt);
  if (acknowledged.updatedBy !== owner)
    throw Error("Outcome belongs to another actor");
  const { sku, version, patch } = acknowledged.packet,
    form = readManualForm(owner, sku),
    selection = readManualSelection(owner, sku);
  // Another tab may have prepared a different edit from the same baseline.
  // A committed receipt clears only the exact intent that it acknowledges.
  try {
    if (
      form?.item.version === version &&
      JSON.stringify(manualPatchFromForm(form)) === JSON.stringify(patch)
    )
      localStorage.removeItem(draftKey(owner, sku));
  } catch {
    /* Preserve a newer or invalid draft for its owner to inspect. */
  }
  if (
    selection?.version === version &&
    JSON.stringify(selection.patch) === JSON.stringify(patch)
  )
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
          verifyManualPriceReview(j.review, reviewedSelection(j.packet));
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
  verifyManualPriceReview(valid.review, reviewedSelection(valid.packet));
  const jobs = readManualJobs(job.owner),
    prior = jobs.find((j) => j.packet.requestId === job.packet.requestId);
  if (
    prior &&
    (JSON.stringify(prior.packet) !== JSON.stringify(valid.packet) ||
      JSON.stringify(prior.review) !== JSON.stringify(valid.review))
  )
    throw Error("Original edit and evidence must remain immutable");
  if (prior?.conflict && !valid.conflict)
    throw Error(
      "A conflicted edit must be checked and dismissed before starting again",
    );
  if (!prior && jobs.some((job) => job.packet.sku === valid.packet.sku))
    throw Error(
      "Check the original request for this SKU before starting another edit",
    );
  if (!prior && jobs.length >= 30)
    throw Error("Resolve earlier requests before confirming");
  store(jobKey(job.owner, valid.packet.requestId), valid, jobSchema);
  notify();
}
export function clearManualJob(owner: string, id: string) {
  localStorage.removeItem(jobKey(owner, id));
  notify();
}
