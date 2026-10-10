import { z } from "zod";
export const ASSIGNMENT_HOME = "/cs/sales-assignment";
export const ASSIGNMENT_API = "/cs-admin/assignment-workspace";
export const assignmentUuid = z
  .uuid()
  .transform((value) => value.toLowerCase());
export const assignmentSelectionSchema = z.strictObject({
  companyIds: z
    .array(assignmentUuid)
    .min(1)
    .max(20)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Select each company once",
    ),
  salesUserId: assignmentUuid.nullable(),
});
export const assignmentPacketSchema = z.strictObject({
  requestId: assignmentUuid,
  salesUserId: assignmentUuid.nullable(),
  changes: z
    .array(
      z.strictObject({
        companyId: assignmentUuid,
        version: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .min(1)
    .max(20)
    .refine(
      (rows) => new Set(rows.map((r) => r.companyId)).size === rows.length,
      "Select each company once",
    ),
});
const owner = z.strictObject({ id: assignmentUuid, name: z.string() });
export const assignmentItemSchema = z.strictObject({
  companyId: assignmentUuid,
  name: z.string(),
  previousOwner: owner.nullable(),
  recorded: z.boolean(),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  importedCustomerCount: z.number().int().nonnegative(),
});
export const assignmentReviewSchema = z
  .strictObject({
    items: z.array(assignmentItemSchema).min(1).max(20),
    newOwner: owner.nullable(),
    capturedAt: z.iso.datetime(),
    ownership: z.literal("commerce"),
    sourceFreshness: z.literal("unverified"),
  })
  .refine(
    (r) => new Set(r.items.map((i) => i.companyId)).size === r.items.length,
  );
export const assignmentReceiptSchema = z.strictObject({
  kind: z.literal("customer_assignment"),
  scenario: z.strictObject({ kind: z.literal("customer_assignment") }),
  id: assignmentUuid,
  requestId: assignmentUuid,
  packet: assignmentPacketSchema,
  status: z.literal("committed"),
  persisted: z.literal(true),
  appliedCount: z.number().int().min(1).max(20),
  items: z
    .array(
      assignmentItemSchema.extend({
        newOwner: owner.nullable(),
        savedVersion: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .min(1)
    .max(20),
  savedAt: z.iso.datetime(),
  outboxEnqueued: z.literal(true),
  downstreamDelivery: z.literal("unverified"),
  replayed: z.boolean().optional(),
});
export type AssignmentPacket = z.infer<typeof assignmentPacketSchema>;
export type AssignmentReview = z.infer<typeof assignmentReviewSchema>;
export type AssignmentReceipt = z.infer<typeof assignmentReceiptSchema>;
export function canAssignCustomers(role: string) {
  return ["admin", "sales_manager", "sale_manager"].includes(
    role.trim().toLowerCase(),
  );
}
export function verifyAssignmentReceipt(
  raw: unknown,
  expected?: AssignmentPacket,
): AssignmentReceipt {
  const r = assignmentReceiptSchema.parse(raw);
  if (
    expected &&
    JSON.stringify(r.packet) !==
      JSON.stringify(assignmentPacketSchema.parse(expected))
  )
    throw Error("Receipt differs from the original assignment request");
  if (
    r.requestId !== r.packet.requestId ||
    r.appliedCount !== r.packet.changes.length ||
    r.items.length !== r.appliedCount ||
    r.items.some(
      (i, n) =>
        i.companyId !== r.packet.changes[n].companyId ||
        i.version !== r.packet.changes[n].version ||
        (i.newOwner?.id ?? null) !== r.packet.salesUserId ||
        (i.recorded && (i.previousOwner?.id ?? null) === r.packet.salesUserId),
    )
  )
    throw Error("Assignment receipt is incomplete or inconsistent");
  return r;
}
