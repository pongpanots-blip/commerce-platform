import {
  manualPricePacketSchema,
  manualPricePatchSchema,
  editedPriceValues,
  verifyManualPriceReceipt,
  verifyManualPriceReview,
} from "./manual-price-contracts";
const item = {
  sku: "SKU",
  version: "a".repeat(64),
  current: { sellingUnitPrice: "10.00", orderingPrice: "100.00", moq: 1 },
  currentRecorded: true,
  currentSource: "import",
  currentUpdatedAt: null,
  currentUpdatedBy: null,
};
const packet = {
  sku: item.sku,
  version: item.version,
  patch: { sellingUnitPrice: 0, moq: null },
  requestId: "00000000-0000-4000-8000-000000000001",
};
const review = {
  item,
  patch: packet.patch,
  after: editedPriceValues(item, packet.patch),
  ownership: "commerce",
  capturedAt: "2026-10-10T00:00:00.000Z",
};
const receipt = {
  kind: "product_price_edit",
  scenario: { kind: "product_price_edit" },
  id: packet.requestId,
  requestId: packet.requestId,
  packet,
  before: item,
  after: review.after,
  status: "committed",
  persisted: true,
  appliedCount: 1,
  source: "staff",
  updatedBy: "actor",
  outboxEnqueued: true,
  downstreamDelivery: "unverified",
  savedAt: review.capturedAt,
};
it("manual semantics preserve omitted values and distinguish zero from clearing", () => {
  expect(review.after).toEqual({
    sellingUnitPrice: "0.00",
    orderingPrice: "100.00",
    moq: null,
  });
  expect(verifyManualPriceReceipt(receipt, packet)).toMatchObject({
    persisted: true,
  });
});
it.each([
  {},
  { sellingUnitPrice: -1 },
  { sellingUnitPrice: 1.001 },
  { sellingUnitPrice: NaN },
  { sellingUnitPrice: Infinity },
  { sellingUnitPrice: 10000000000 },
  { moq: 2147483648 },
  { moq: 0.5 },
  { sellingUnitPrice: "1" },
  { extra: 1 },
])("rejects invalid patch %p before review", (patch) => {
  expect(manualPricePatchSchema.safeParse(patch).success).toBe(false);
});
it("supports raw Unicode SKU at PostgreSQL 64-character boundary and normalizes request IDs", () => {
  expect(
    manualPricePacketSchema.parse({
      ...packet,
      sku: "😀".repeat(64),
      requestId: packet.requestId.toUpperCase(),
    }).sku,
  ).toHaveLength(128);
  expect(
    manualPricePacketSchema.safeParse({ ...packet, sku: "😀".repeat(65) })
      .success,
  ).toBe(false);
});
it.each(["after", "packet", "version", "count", "delivery", "persisted"])(
  "refuses mismatched %s outcome",
  (kind) => {
    const r = structuredClone(receipt);
    if (kind === "after") r.after.moq = 1;
    if (kind === "packet") r.packet.patch.sellingUnitPrice = 1;
    if (kind === "version") r.before.version = "b".repeat(64);
    if (kind === "count") r.appliedCount = 0;
    if (kind === "delivery") r.downstreamDelivery = "delivered";
    if (kind === "persisted") r.persisted = false;
    expect(() => verifyManualPriceReceipt(r, packet)).toThrow();
  },
);
it("refuses wrong selection and a server review that does not match native manual semantics", () => {
  expect(() =>
    verifyManualPriceReview({ ...review, after: item.current }, packet),
  ).toThrow();
  expect(() =>
    verifyManualPriceReview(
      { ...review, item: { ...item, sku: "OTHER" } },
      packet,
    ),
  ).toThrow();
});
