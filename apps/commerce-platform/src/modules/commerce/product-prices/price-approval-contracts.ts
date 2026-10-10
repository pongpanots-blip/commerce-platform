import { z } from "zod";
export const PRICE_APPROVAL_API = "/product-prices/workspace";
export const PRICE_APPROVAL_HOME = "/product-prices";
export const priceRequestId = z.uuid().transform((v) => v.toLowerCase());
// Match PostgreSQL varchar(64): supplementary Unicode characters count once.
const sku = z
  .string()
  .min(1)
  .refine((v) => Array.from(v).length <= 64);
const version = z.string().regex(/^[a-f0-9]{64}$/);
const decimal = z
  .string()
  .regex(/^-?\d+\.\d{2}$/)
  .nullable();
export const priceValuesSchema = z.strictObject({
  sellingUnitPrice: decimal,
  orderingPrice: decimal,
  moq: z.number().int().nullable(),
});
export const priceApprovalItemSchema = z.strictObject({
  sku,
  version,
  current: priceValuesSchema,
  proposed: priceValuesSchema,
  currentRecorded: z.boolean(),
  currentSource: z.string().nullable(),
  currentUpdatedAt: z.string().nullable(),
  currentUpdatedBy: z.string().nullable(),
  changedAt: z.iso.datetime().nullable(),
  receivedAt: z.iso.datetime(),
});
const changes = z
  .array(z.strictObject({ sku, version }))
  .min(1)
  .max(100)
  .refine(
    (v) => new Set(v.map((i) => i.sku)).size === v.length,
    "Choose each SKU once",
  );
export const priceApprovalSelectionSchema = z.strictObject({ changes });
export const priceApprovalPacketSchema = z.strictObject({
  requestId: priceRequestId,
  decision: z.enum(["approve", "reject"]),
  changes,
});
export const priceApprovalReviewSchema = z
  .strictObject({
    items: z.array(priceApprovalItemSchema).min(1).max(100),
    ownership: z.enum(["commerce", "josh"]),
    capturedAt: z.iso.datetime(),
  })
  .refine((v) => new Set(v.items.map((i) => i.sku)).size === v.items.length);
export const priceApprovalPageSchema = z.strictObject({
  items: z.array(priceApprovalItemSchema).max(100),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().min(1).max(100),
  ownership: z.enum(["commerce", "josh"]),
});
export const priceApprovalReceiptSchema = z.strictObject({
  kind: z.literal("product_price_approval"),
  scenario: z.strictObject({ kind: z.literal("product_price_approval") }),
  id: priceRequestId,
  requestId: priceRequestId,
  packet: priceApprovalPacketSchema,
  status: z.literal("committed"),
  persisted: z.literal(true),
  appliedCount: z.number().int().min(1).max(100),
  items: z
    .array(
      z.strictObject({
        before: priceApprovalItemSchema,
        after: priceValuesSchema,
        outcome: z.enum(["approved", "rejected"]),
      }),
    )
    .min(1)
    .max(100),
  savedAt: z.iso.datetime(),
  outboxEnqueued: z.boolean(),
  downstreamDelivery: z.enum(["unverified", "not_applicable"]),
  replayed: z.boolean().optional(),
});
export type PriceApprovalItem = z.infer<typeof priceApprovalItemSchema>;
export type PriceApprovalReview = z.infer<typeof priceApprovalReviewSchema>;
export function verifyPriceApprovalReview(
  raw: unknown,
  expected: { sku: string; version?: string }[],
) {
  const review = priceApprovalReviewSchema.parse(raw);
  if (
    review.items.length !== expected.length ||
    review.items.some(
      (i, n) =>
        i.sku !== expected[n].sku ||
        (expected[n].version != null && i.version !== expected[n].version),
    )
  )
    throw Error(
      "Returned evidence differs from the reviewed selection. No decision can be sent.",
    );
  return review;
}
export type PriceApprovalPacket = z.infer<typeof priceApprovalPacketSchema>;
export type PriceApprovalReceipt = z.infer<typeof priceApprovalReceiptSchema>;
export const canApprovePrices = (role: string) =>
  ["admin", "merchandising"].includes(role.trim().toLowerCase());
export function approvedPriceValues(item: PriceApprovalItem) {
  return Object.fromEntries(
    Object.entries(item.current).map(([k, v]) => [
      k,
      item.proposed[k as keyof typeof item.proposed] ?? v,
    ]),
  ) as PriceApprovalItem["current"];
}
export function verifyPriceApprovalReceipt(
  raw: unknown,
  expected?: PriceApprovalPacket,
): PriceApprovalReceipt {
  const r = priceApprovalReceiptSchema.parse(raw);
  if (
    expected &&
    JSON.stringify(r.packet) !==
      JSON.stringify(priceApprovalPacketSchema.parse(expected))
  )
    throw Error("Receipt differs from the original price decision");
  const approval = r.packet.decision === "approve";
  if (
    r.requestId !== r.packet.requestId ||
    r.appliedCount !== r.packet.changes.length ||
    r.items.length !== r.appliedCount ||
    r.outboxEnqueued !== approval ||
    r.downstreamDelivery !== (approval ? "unverified" : "not_applicable") ||
    r.items.some(
      (i, n) =>
        i.before.sku !== r.packet.changes[n].sku ||
        i.before.version !== r.packet.changes[n].version ||
        i.outcome !== (approval ? "approved" : "rejected") ||
        JSON.stringify(i.after) !==
          JSON.stringify(
            approval ? approvedPriceValues(i.before) : i.before.current,
          ),
    )
  )
    throw Error(
      "Incomplete or inconsistent price outcome. No completion can be confirmed.",
    );
  return r;
}
