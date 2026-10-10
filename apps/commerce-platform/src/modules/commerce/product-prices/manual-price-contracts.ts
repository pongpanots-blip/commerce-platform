import { z } from "zod";
import { priceRequestId, priceValuesSchema } from "./price-approval-contracts";

export const MANUAL_PRICE_API = "/product-prices/editor";
// Preserve the exact SKU, including Unicode and meaningful surrounding spaces.
// PostgreSQL text cannot store NUL; an all-whitespace identifier is not a product.
export const manualPriceSkuSchema = z
  .string()
  .min(1)
  .refine((v) => Array.from(v).length <= 64)
  .refine((v) => v.trim().length > 0 && !v.includes("\u0000"));
// The original PATCH accepts nonnegative numbers with at most two decimal places.
// The new review also validates existing numeric(12,2)/int storage bounds before dispatch.
// The legacy PATCH's DTO, conversions and business rules remain unchanged.
const amount = z
  .number()
  .nonnegative()
  .max(9999999999.99)
  .refine((v) => v % 1 === 0 || /^\d+\.\d{1,2}$/.test(String(v)));
export const manualPricePatchSchema = z
  .strictObject({
    sellingUnitPrice: amount.nullable().optional(),
    orderingPrice: amount.nullable().optional(),
    moq: z.number().int().nonnegative().max(2147483647).nullable().optional(),
  })
  .refine(
    (v) => Object.values(v).some((n) => n !== undefined),
    "Choose at least one field to set or clear",
  );
export const manualPriceItemSchema = z.strictObject({
  sku: manualPriceSkuSchema,
  version: z.string().regex(/^[a-f0-9]{64}$/),
  current: priceValuesSchema,
  currentRecorded: z.boolean(),
  currentSource: z.string().nullable(),
  currentUpdatedAt: z.string().nullable(),
  currentUpdatedBy: z.string().nullable(),
});
export const manualPriceSelectionSchema = z.strictObject({
  sku: manualPriceSkuSchema,
  version: manualPriceItemSchema.shape.version,
  patch: manualPricePatchSchema,
});
export const manualPricePacketSchema = manualPriceSelectionSchema.extend({
  requestId: priceRequestId,
});
export const manualPriceReviewSchema = z.strictObject({
  item: manualPriceItemSchema,
  patch: manualPricePatchSchema,
  after: priceValuesSchema,
  ownership: z.enum(["commerce", "josh"]),
  capturedAt: z.iso.datetime(),
});
export const manualPriceReadSchema = z.strictObject({
  item: manualPriceItemSchema,
  ownership: z.enum(["commerce", "josh"]),
});
export type ManualPriceItem = z.infer<typeof manualPriceItemSchema>;
export type ManualPriceSelection = z.infer<typeof manualPriceSelectionSchema>;
export type ManualPricePacket = z.infer<typeof manualPricePacketSchema>;
export type ManualPriceReview = z.infer<typeof manualPriceReviewSchema>;
export function editedPriceValues(
  item: ManualPriceItem,
  patch: z.infer<typeof manualPricePatchSchema>,
) {
  return priceValuesSchema.parse({
    sellingUnitPrice:
      patch.sellingUnitPrice === undefined
        ? item.current.sellingUnitPrice
        : patch.sellingUnitPrice === null
          ? null
          : patch.sellingUnitPrice.toFixed(2),
    orderingPrice:
      patch.orderingPrice === undefined
        ? item.current.orderingPrice
        : patch.orderingPrice === null
          ? null
          : patch.orderingPrice.toFixed(2),
    moq: patch.moq === undefined ? item.current.moq : patch.moq,
  });
}
export function verifyManualPriceReview(
  raw: unknown,
  expected: ManualPriceSelection,
) {
  const review = manualPriceReviewSchema.parse(raw),
    selection = manualPriceSelectionSchema.parse(expected);
  if (
    review.item.sku !== selection.sku ||
    review.item.version !== selection.version ||
    JSON.stringify(review.patch) !== JSON.stringify(selection.patch) ||
    JSON.stringify(review.after) !==
      JSON.stringify(editedPriceValues(review.item, review.patch))
  )
    throw Error(
      "Returned review differs from the requested edit. No change can be sent.",
    );
  return review;
}
export const manualPriceReceiptSchema = z.strictObject({
  kind: z.literal("product_price_edit"),
  scenario: z.strictObject({ kind: z.literal("product_price_edit") }),
  id: priceRequestId,
  requestId: priceRequestId,
  packet: manualPricePacketSchema,
  status: z.literal("committed"),
  persisted: z.literal(true),
  savedAt: z.iso.datetime(),
  before: manualPriceItemSchema,
  after: priceValuesSchema,
  appliedCount: z.literal(1),
  source: z.literal("staff"),
  updatedBy: z.string().min(1),
  outboxEnqueued: z.literal(true),
  downstreamDelivery: z.literal("unverified"),
  replayed: z.boolean().optional(),
});
export type ManualPriceReceipt = z.infer<typeof manualPriceReceiptSchema>;
export function verifyManualPriceReceipt(
  raw: unknown,
  expected?: ManualPricePacket,
) {
  const r = manualPriceReceiptSchema.parse(raw);
  if (
    r.requestId !== r.packet.requestId ||
    r.before.sku !== r.packet.sku ||
    r.before.version !== r.packet.version ||
    (expected &&
      JSON.stringify(r.packet) !==
        JSON.stringify(manualPricePacketSchema.parse(expected))) ||
    JSON.stringify(r.after) !==
      JSON.stringify(editedPriceValues(r.before, r.packet.patch))
  )
    throw Error(
      "Incomplete or inconsistent edit outcome. Completion is unconfirmed.",
    );
  return r;
}
