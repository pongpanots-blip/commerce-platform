import { z } from "zod";
import {
  PRODUCT_CONTENT_EDIT_FIELDS,
  productContentFieldsSchema,
  productContentItemSchema,
  productContentPacketSchema,
  productContentReviewSchema,
  productContentSelectionSchema,
  verifyProductContentReceipt,
  verifyProductContentReview,
  type ProductContentField,
  type ProductContentItem,
  type ProductContentPacket,
  type ProductContentReceipt,
  type ProductContentSelection,
} from "../../../../../commerce-platform/src/modules/commerce/product-content-editor/product-content-editor-contracts";

const fieldSchema = z.strictObject({
  mode: z.enum(["keep", "set", "clear"]),
  value: z.string(),
});
export const contentFormSchema = z.strictObject({
  item: productContentItemSchema,
  fields: z.strictObject({
    product_name_th: fieldSchema,
    product_name_en: fieldSchema,
    product_description_th: fieldSchema,
    product_description_en: fieldSchema,
    ingredients: fieldSchema,
    allergens: fieldSchema,
  }),
});
const jobSchema = z.strictObject({
  owner: z.string().min(1),
  packet: productContentPacketSchema,
  review: productContentReviewSchema,
  conflict: z.boolean(),
});
export type ContentForm = z.infer<typeof contentFormSchema>;
export type ContentJob = z.infer<typeof jobSchema>;
export const contentNameField = (field: ProductContentField) =>
  field === "product_name_th" || field === "product_name_en";
export const contentSelection = (
  packet: ProductContentPacket,
): ProductContentSelection => ({
  productId: packet.productId,
  sku: packet.sku,
  version: packet.version,
  fields: packet.fields,
});
export function initialContentForm(item: ProductContentItem): ContentForm {
  return contentFormSchema.parse({
    item,
    fields: Object.fromEntries(
      PRODUCT_CONTENT_EDIT_FIELDS.map((field) => [
        field,
        { mode: "keep", value: item.current[field] ?? "" },
      ]),
    ),
  });
}
export function contentFieldsFromForm(raw: ContentForm) {
  const form = contentFormSchema.parse(raw),
    fields: Record<string, string | null> = {};
  for (const key of PRODUCT_CONTENT_EDIT_FIELDS) {
    const field = form.fields[key];
    if (field.mode === "clear") {
      if (contentNameField(key))
        throw new z.ZodError([
          { code: "custom", path: [key], message: "Names cannot be cleared" },
        ]);
      fields[key] = null;
    }
    if (field.mode === "set") {
      if (!field.value.trim())
        throw new z.ZodError([
          {
            code: "custom",
            path: [key],
            message: "Enter text, or choose Clear for a text field",
          },
        ]);
      fields[key] = field.value;
    }
  }
  return productContentFieldsSchema.parse(fields);
}
const prefix = (owner: string) =>
  "cp-product-content-request:" + encodeURIComponent(owner) + ":";
const jobKey = (owner: string, id: string) => prefix(owner) + id;
const formKey = (owner: string, productId: string) =>
  "cp-product-content-form:" + encodeURIComponent(owner) + ":" + productId;
const reviewKey = (owner: string, productId: string) =>
  "cp-product-content-review:" + encodeURIComponent(owner) + ":" + productId;
export const CONTENT_JOURNAL_EVENT = "cp-product-content-journal";
const notify = () => window.dispatchEvent(new Event(CONTENT_JOURNAL_EVENT));
function read<T>(key: string, schema: z.ZodType<T>): T | null {
  try {
    const result = schema.safeParse(
      JSON.parse(localStorage.getItem(key) ?? "null"),
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
function store<T>(key: string, value: T, schema: z.ZodType<T>) {
  const valid = schema.parse(value);
  localStorage.setItem(key, JSON.stringify(valid));
  if (JSON.stringify(read(key, schema)) !== JSON.stringify(valid))
    throw Error("Recovery storage unavailable. No content change was sent.");
}
export function readContentForm(owner: string, productId: string) {
  const value = read(formKey(owner, productId), contentFormSchema);
  return value?.item.productId === productId ? value : null;
}
export function storeContentForm(owner: string, form: ContentForm) {
  z.string().min(1).parse(owner);
  store(formKey(owner, form.item.productId), form, contentFormSchema);
}
export function readContentSelection(owner: string, productId: string) {
  const value = read(
    reviewKey(owner, productId),
    productContentSelectionSchema,
  );
  return value?.productId === productId ? value : null;
}
export function storeContentSelection(
  owner: string,
  selection: ProductContentSelection,
) {
  z.string().min(1).parse(owner);
  store(
    reviewKey(owner, selection.productId),
    selection,
    productContentSelectionSchema,
  );
}
export function readContentJobs(owner: string): ContentJob[] {
  try {
    return Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    )
      .filter((key): key is string => !!key && key.startsWith(prefix(owner)))
      .sort()
      .flatMap((key) => {
        const job = read(key, jobSchema);
        if (
          !job ||
          job.owner !== owner ||
          key !== jobKey(owner, job.packet.requestId)
        )
          return [];
        try {
          verifyProductContentReview(job.review, contentSelection(job.packet));
          return [job];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
export function storeContentJob(job: ContentJob) {
  const valid = jobSchema.parse(job);
  verifyProductContentReview(valid.review, contentSelection(valid.packet));
  if (
    valid.review.ownership !== "commerce" ||
    !["native", "unavailable"].includes(valid.review.item.evidenceSource)
  )
    throw Error("A native owned content review is required");
  const jobs = readContentJobs(valid.owner),
    previous = jobs.find(
      (candidate) => candidate.packet.requestId === valid.packet.requestId,
    );
  if (
    previous &&
    (JSON.stringify(previous.packet) !== JSON.stringify(valid.packet) ||
      JSON.stringify(previous.review) !== JSON.stringify(valid.review))
  )
    throw Error("Original content request and evidence must remain immutable");
  if (previous?.conflict && !valid.conflict)
    throw Error(
      "A conflicted content request must be checked before starting again",
    );
  if (
    !previous &&
    jobs.some(
      (candidate) =>
        candidate.packet.productId === valid.packet.productId ||
        candidate.packet.sku === valid.packet.sku,
    )
  )
    throw Error(
      "Check the original content request before starting another edit",
    );
  if (!previous && jobs.length >= 30)
    throw Error("Resolve earlier content requests before confirming");
  store(jobKey(valid.owner, valid.packet.requestId), valid, jobSchema);
  notify();
}
export function clearContentJob(owner: string, id: string) {
  localStorage.removeItem(jobKey(owner, id));
  notify();
}
export function clearAcknowledgedContentDraft(
  owner: string,
  raw: ProductContentReceipt,
) {
  const receipt = verifyProductContentReceipt(raw);
  if (receipt.updatedBy !== owner)
    throw Error("Content outcome belongs to another actor");
  const packet = receipt.packet,
    form = readContentForm(owner, packet.productId),
    selection = readContentSelection(owner, packet.productId);
  try {
    if (
      form?.item.version === packet.version &&
      form.item.sku === packet.sku &&
      JSON.stringify(contentFieldsFromForm(form)) ===
        JSON.stringify(packet.fields)
    )
      localStorage.removeItem(formKey(owner, packet.productId));
  } catch {
    /* A newer or invalid local edit remains available to its owner. */
  }
  if (
    selection?.version === packet.version &&
    selection.sku === packet.sku &&
    JSON.stringify(selection.fields) === JSON.stringify(packet.fields)
  )
    localStorage.removeItem(reviewKey(owner, packet.productId));
}
