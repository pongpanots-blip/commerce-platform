import {
  verifyPriceApprovalReview,
  approvedPriceValues,
  canApprovePrices,
  priceApprovalPacketSchema,
  verifyPriceApprovalReceipt,
} from "./price-approval-contracts";
const item = {
  sku: "S",
  version: "a".repeat(64),
  current: { sellingUnitPrice: "10.00", orderingPrice: "100.00", moq: 1 },
  proposed: { sellingUnitPrice: "0.00", orderingPrice: null, moq: 0 },
  currentRecorded: true,
  currentSource: "import",
  currentUpdatedAt: null,
  currentUpdatedBy: null,
  changedAt: null,
  receivedAt: "2026-10-10T00:00:00.000Z",
};
const packet = {
  requestId: "00000000-0000-4000-8000-000000000001",
  decision: "approve" as const,
  changes: [{ sku: item.sku, version: item.version }],
};
const receipt = {
  kind: "product_price_approval",
  scenario: { kind: "product_price_approval" },
  id: packet.requestId,
  requestId: packet.requestId,
  packet,
  status: "committed",
  persisted: true,
  appliedCount: 1,
  items: [
    { before: item, after: approvedPriceValues(item), outcome: "approved" },
  ],
  savedAt: item.receivedAt,
  outboxEnqueued: true,
  downstreamDelivery: "unverified",
};
describe("price approval strict native contract", () => {
  it("keeps the native 64-character SKU boundary for supplementary Unicode", () => {
    const valid = {
      ...packet,
      changes: [{ sku: "🐟".repeat(64), version: item.version }],
    };
    expect(priceApprovalPacketSchema.parse(valid).changes[0].sku).toBe(
      valid.changes[0].sku,
    );
    expect(() =>
      priceApprovalPacketSchema.parse({
        ...valid,
        changes: [{ ...valid.changes[0], sku: "🐟".repeat(65) }],
      }),
    ).toThrow();
  });
  it("binds review evidence to every originally selected SKU and version", () => {
    const r = {
      items: [item],
      ownership: "commerce",
      capturedAt: item.receivedAt,
    };
    expect(verifyPriceApprovalReview(r, packet.changes).items[0].sku).toBe("S");
    expect(() => verifyPriceApprovalReview(r, [{ sku: "other" }])).toThrow();
    expect(() =>
      verifyPriceApprovalReview(r, [{ sku: "S", version: "b".repeat(64) }]),
    ).toThrow();
    expect(() =>
      verifyPriceApprovalReview(r, [...packet.changes, ...packet.changes]),
    ).toThrow();
  });
  it("keeps null fields and applies zero without numeric truthiness", () =>
    expect(approvedPriceValues(item)).toEqual({
      sellingUnitPrice: "0.00",
      orderingPrice: "100.00",
      moq: 0,
    }));
  it.each([
    "admin",
    "merchandising",
    "marketing",
    "business_analyst",
    "sale",
    "sales_manager",
    "cs",
    "graphic",
  ])("%s retains original price authority", (r) =>
    expect(canApprovePrices(r)).toBe(["admin", "merchandising"].includes(r)),
  );
  it("accepts at most100 distinct explicit SKUs, never an all-filtered marker", () => {
    expect(
      priceApprovalPacketSchema.safeParse({
        ...packet,
        changes: Array.from({ length: 100 }, (_, i) => ({
          sku: String(i),
          version: item.version,
        })),
      }).success,
    ).toBe(true);
    for (const changes of [
      [],
      [...packet.changes, ...packet.changes],
      Array.from({ length: 101 }, (_, i) => ({
        sku: String(i),
        version: item.version,
      })),
      [{ sku: "S", version: "old" }],
    ])
      expect(
        priceApprovalPacketSchema.safeParse({ ...packet, changes }).success,
      ).toBe(false);
    expect(
      priceApprovalPacketSchema.safeParse({ ...packet, all: true }).success,
    ).toBe(false);
  });
  it("verifies the exact packet and authoritative after-values", () =>
    expect(verifyPriceApprovalReceipt(receipt, packet).appliedCount).toBe(1));
  it.each([
    { appliedCount: 0 },
    { appliedCount: 2 },
    { persisted: false },
    { outboxEnqueued: false },
    { items: [] },
    {
      items: [
        {
          ...receipt.items[0],
          after: { ...item.current, sellingUnitPrice: "99.00" },
        },
      ],
    },
    { packet: { ...packet, decision: "reject" } },
    { requestId: "00000000-0000-4000-8000-000000000002" },
    { downstreamDelivery: "delivered" },
  ])("rejects incomplete/partial/inconsistent success %j", (change) =>
    expect(() =>
      verifyPriceApprovalReceipt({ ...receipt, ...change }, packet),
    ).toThrow(),
  );
});
