import {
  assignmentPacketSchema,
  assignmentSelectionSchema,
  verifyAssignmentReceipt,
  canAssignCustomers,
} from "./assignment-contracts";
const company = "00000000-0000-4000-8000-000000000101",
  rep = "00000000-0000-4000-8000-000000000201",
  old = "00000000-0000-4000-8000-000000000202",
  requestId = "00000000-0000-4000-8000-000000000099";
const packet = {
  requestId,
  salesUserId: rep,
  changes: [{ companyId: company, version: "a".repeat(64) }],
};
const receipt = () => ({
  kind: "customer_assignment",
  scenario: { kind: "customer_assignment" },
  id: company,
  requestId,
  packet,
  status: "committed",
  persisted: true,
  appliedCount: 1,
  items: [
    {
      companyId: company,
      name: "Synthetic Company",
      previousOwner: { id: old, name: "Old" },
      newOwner: { id: rep, name: "New" },
      recorded: true,
      version: "a".repeat(64),
      savedVersion: "b".repeat(64),
      importedCustomerCount: 1,
    },
  ],
  savedAt: "2026-10-10T01:00:00.000Z",
  outboxEnqueued: true,
  downstreamDelivery: "unverified",
});
it("strictly bounds scope and rejects extra actor/permission fields", () => {
  expect(
    assignmentSelectionSchema.safeParse({
      companyIds: [company],
      salesUserId: null,
    }).success,
  ).toBe(true);
  for (const value of [
    { ...packet, actor: "admin" },
    { ...packet, changes: [] },
    { ...packet, changes: [...packet.changes, ...packet.changes] },
    { ...packet, changes: Array.from({ length: 21 }, () => packet.changes[0]) },
  ])
    expect(assignmentPacketSchema.safeParse(value).success).toBe(false);
});
it("retains admin/manager authority and rejects all other roles", () => {
  for (const role of ["admin", "sales_manager", "sale_manager"])
    expect(canAssignCustomers(role)).toBe(true);
  for (const role of [
    "sale",
    "business_analyst",
    "cs",
    "marketing",
    "merchandising",
    "graphic",
    "",
  ])
    expect(canAssignCustomers(role)).toBe(false);
});
it("requires complete persisted outcome and original immutable request equality", () => {
  expect(verifyAssignmentReceipt(receipt(), packet).appliedCount).toBe(1);
  for (const r of [
    { status: true },
    { ...receipt(), persisted: false },
    { ...receipt(), appliedCount: 2 },
    { ...receipt(), items: [] },
    { ...receipt(), packet: { ...packet, salesUserId: null } },
    { ...receipt(), requestId: company },
    { ...receipt(), outboxEnqueued: false },
  ])
    expect(() => verifyAssignmentReceipt(r, packet)).toThrow();
});
it("rejects mislabeled previous/new owners and duplicate/partial company results", () => {
  for (const item of [
    { ...receipt().items[0], newOwner: { id: old, name: "Old" } },
    { ...receipt().items[0], companyId: rep },
    { ...receipt().items[0], version: "c".repeat(64) },
    { ...receipt().items[0], previousOwner: { id: rep, name: "New" } },
  ])
    expect(() =>
      verifyAssignmentReceipt({ ...receipt(), items: [item] }, packet),
    ).toThrow();
});
it("does not infer downstream completion from a transactional outbox enqueue", () => {
  expect(verifyAssignmentReceipt(receipt()).downstreamDelivery).toBe(
    "unverified",
  );
  expect(() =>
    verifyAssignmentReceipt({ ...receipt(), downstreamDelivery: "delivered" }),
  ).toThrow();
});

it("normalizes UUID casing before uniqueness validation and receipt comparison", () => {
  const id = "abcdefab-1234-4567-89ab-abcdefabcdef";
  expect(
    assignmentSelectionSchema.parse({
      companyIds: [id.toUpperCase()],
      salesUserId: null,
    }).companyIds,
  ).toEqual([id]);
  expect(
    assignmentSelectionSchema.safeParse({
      companyIds: [id, id.toUpperCase()],
      salesUserId: null,
    }).success,
  ).toBe(false);
});
