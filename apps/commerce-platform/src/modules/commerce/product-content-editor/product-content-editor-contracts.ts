import { z } from "zod";
import { priceRequestId } from "../product-prices/price-approval-contracts";
import { manualPriceSkuSchema } from "../product-prices/manual-price-contracts";

export const PRODUCT_CONTENT_EDITOR_API = "/product-content-editor";
export const PRODUCT_CONTENT_EDIT_FIELDS = [
  "product_name_th",
  "product_name_en",
  "product_description_th",
  "product_description_en",
  "ingredients",
  "allergens",
] as const;
export type ProductContentField = (typeof PRODUCT_CONTENT_EDIT_FIELDS)[number];
const identity = priceRequestId;
const version = z.string().regex(/^[a-f0-9]{64}$/);
const recordedText = z.string().nullable().optional();
export const productContentValuesSchema = z.strictObject({
  product_name_th: recordedText,
  product_name_en: recordedText,
  product_description_th: recordedText,
  product_description_en: recordedText,
  ingredients: recordedText,
  allergens: recordedText,
});
// These are the same six text rules used by splitContent. The server also runs
// splitContent before dispatch; this browser-safe contract never broadens them.
const name = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((v) => v.length <= 255, "Name must be 255 characters or fewer")
  .refine((v) => !v.includes("\u0000"));
const text = z
  .string()
  .nullable()
  .transform((v) => (v ?? "").trim())
  .pipe(
    z
      .string()
      .max(20000)
      .refine(
        (v) => v.length <= 20000,
        "Text must be 20000 characters or fewer",
      )
      .refine((v) => !v.includes("\u0000")),
  )
  .transform((v) => v || null);
const editableFields = z.strictObject({
  product_name_th: name.optional(),
  product_name_en: name.optional(),
  product_description_th: text.optional(),
  product_description_en: text.optional(),
  ingredients: text.optional(),
  allergens: text.optional(),
});
export const productContentFieldsSchema = editableFields
  .refine(
    (v) => Object.values(v).some((value) => value !== undefined),
    "Choose at least one content field to set or clear",
  )
  .transform(
    (v) =>
      Object.fromEntries(
        Object.entries(v).filter(([, value]) => value !== undefined),
      ) as z.infer<typeof editableFields>,
  );
export const productContentItemSchema = z
  .strictObject({
    productId: identity,
    sku: manualPriceSkuSchema,
    version,
    current: productContentValuesSchema,
    currentRecorded: z.boolean(),
    currentSource: z.string().nullable(),
    currentUpdatedAt: z.string().nullable(),
    currentUpdatedBy: z.string().nullable(),
    evidenceSource: z.enum([
      "native",
      "archived_native",
      "copied_snapshot",
      "unavailable",
    ]),
  })
  .refine(
    (v) =>
      v.currentRecorded ===
      ["native", "archived_native"].includes(v.evidenceSource),
  );
export const productContentReadSchema = z.strictObject({
  item: productContentItemSchema,
  ownership: z.enum(["commerce", "josh"]),
});
export const productContentSelectionSchema = z.strictObject({
  productId: identity,
  sku: manualPriceSkuSchema,
  version,
  fields: productContentFieldsSchema,
});
export const productContentPacketSchema = productContentSelectionSchema.extend({
  requestId: priceRequestId,
});
export const productContentUpdateSchema = z.strictObject({
  fields: productContentFieldsSchema,
  contentEdit: z.strictObject({
    requestId: priceRequestId,
    sku: manualPriceSkuSchema,
    version,
  }),
});
export const productContentReviewSchema = z.strictObject({
  item: productContentItemSchema,
  fields: productContentFieldsSchema,
  after: productContentValuesSchema,
  ownership: z.enum(["commerce", "josh"]),
  capturedAt: z.iso.datetime(),
});
export type ProductContentItem = z.infer<typeof productContentItemSchema>;
export type ProductContentSelection = z.infer<
  typeof productContentSelectionSchema
>;
export type ProductContentPacket = z.infer<typeof productContentPacketSchema>;
export type ProductContentReview = z.infer<typeof productContentReviewSchema>;
export type ProductContentValues = z.infer<typeof productContentValuesSchema>;
export function editedProductContentValues(
  item: ProductContentItem,
  fields: ProductContentSelection["fields"],
) {
  return productContentValuesSchema.parse({
    ...item.current,
    ...productContentFieldsSchema.parse(fields),
  });
}
export function productContentUpdateEnvelope(raw: ProductContentPacket) {
  const packet = productContentPacketSchema.parse(raw);
  return productContentUpdateSchema.parse({
    fields: packet.fields,
    contentEdit: {
      requestId: packet.requestId,
      sku: packet.sku,
      version: packet.version,
    },
  });
}
export function verifyProductContentReview(
  raw: unknown,
  expected: ProductContentSelection,
) {
  const review = productContentReviewSchema.parse(raw),
    selection = productContentSelectionSchema.parse(expected);
  if (
    review.item.productId !== selection.productId ||
    review.item.sku !== selection.sku ||
    review.item.version !== selection.version ||
    JSON.stringify(review.fields) !== JSON.stringify(selection.fields) ||
    JSON.stringify(review.after) !==
      JSON.stringify(editedProductContentValues(review.item, review.fields))
  )
    throw Error(
      "Returned content review differs from the selected edit. No change can be sent.",
    );
  return review;
}
export const productContentReceiptSchema = z.strictObject({
  kind: z.literal("product_content_edit"),
  scenario: z.strictObject({ kind: z.literal("product_content_edit") }),
  id: priceRequestId,
  requestId: priceRequestId,
  packet: productContentPacketSchema,
  status: z.literal("committed"),
  persisted: z.literal(true),
  savedAt: z.iso.datetime(),
  before: productContentItemSchema,
  after: productContentValuesSchema,
  appliedCount: z.literal(1),
  source: z.literal("staff"),
  updatedBy: z.string().min(1),
  outboxEnqueued: z.literal(true),
  downstreamDelivery: z.literal("unverified"),
  replayed: z.boolean().optional(),
});
export type ProductContentReceipt = z.infer<typeof productContentReceiptSchema>;
export function verifyProductContentReceipt(
  raw: unknown,
  expected?: ProductContentPacket,
) {
  const receipt = productContentReceiptSchema.parse(raw);
  if (
    receipt.requestId !== receipt.packet.requestId ||
    receipt.before.productId !== receipt.packet.productId ||
    receipt.before.sku !== receipt.packet.sku ||
    receipt.before.version !== receipt.packet.version ||
    !["native", "unavailable"].includes(receipt.before.evidenceSource) ||
    (expected &&
      JSON.stringify(receipt.packet) !==
        JSON.stringify(productContentPacketSchema.parse(expected))) ||
    JSON.stringify(receipt.after) !==
      JSON.stringify(
        editedProductContentValues(receipt.before, receipt.packet.fields),
      )
  )
    throw Error(
      "Incomplete or inconsistent content outcome. Completion is unconfirmed.",
    );
  return receipt;
}
