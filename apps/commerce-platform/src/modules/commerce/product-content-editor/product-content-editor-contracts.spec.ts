import {
  editedProductContentValues,
  productContentFieldsSchema,
  productContentPacketSchema,
  productContentUpdateEnvelope,
  productContentUpdateSchema,
  productContentValuesSchema,
  verifyProductContentReceipt,
  verifyProductContentReview,
} from "./product-content-editor-contracts";
import { splitContent } from "../product-contents/content-fields";

const item = {
  productId: "00000000-0000-4000-8000-0000000000ab",
  sku: " exact ไทย SKU ",
  version: "a".repeat(64),
  current: { product_name_en: "Original", ingredients: null },
  currentRecorded: true,
  currentSource: "staff",
  currentUpdatedAt: null,
  currentUpdatedBy: "previous",
  evidenceSource: "native" as const,
};
const selection = {
  productId: item.productId,
  sku: item.sku,
  version: item.version,
  fields: { product_name_th: "ใหม่", allergens: null },
};
const packet = {
  ...selection,
  requestId: "00000000-0000-4000-8000-0000000000cd",
};
const review = {
  item,
  fields: selection.fields,
  after: editedProductContentValues(item, selection.fields),
  ownership: "commerce",
  capturedAt: "2026-10-10T00:00:00.000Z",
};
const receipt = {
  kind: "product_content_edit",
  scenario: { kind: "product_content_edit" },
  id: "00000000-0000-4000-8000-0000000000ef",
  requestId: packet.requestId,
  packet,
  before: item,
  after: review.after,
  status: "committed",
  persisted: true,
  savedAt: review.capturedAt,
  appliedCount: 1,
  source: "staff",
  updatedBy: "actor",
  outboxEnqueued: true,
  downstreamDelivery: "unverified",
};

it.each([
  { product_name_th: "  ชื่อ  " },
  { product_name_en: "Name" },
  { product_description_th: "  Description\n " },
  { product_description_en: "" },
  { ingredients: "  flour  " },
  { allergens: null },
  { product_name_en: "x".repeat(255), ingredients: "x".repeat(20000) },
  { product_name_en: "😀".repeat(127) + "x", allergens: "😀".repeat(10000) },
])("uses existing native normalization for six-field patch %p", (raw) => {
  expect(productContentFieldsSchema.parse(raw)).toEqual(
    splitContent(raw).content,
  );
});
it.each([
  {},
  { product_name_th: null },
  { product_name_en: " " },
  { product_name_th: "x".repeat(256) },
  { product_name_en: "😀".repeat(128) },
  { ingredients: "x".repeat(20001) },
  { product_description_en: "😀".repeat(10000) + "x" },
  { allergens: "😀".repeat(10001) },
  { allergens: 0 },
  { product_description_en: false },
  { ingredients: "x\u0000y" },
  { product_name_en: "x\u0000y" },
  { buying_price: 1 },
  { selling_unit_price: 1 },
  { product_status: "active" },
  { selling_unit: "KG" },
  { actor: "admin" },
  { productId: item.productId },
  { sku: item.sku },
  { expiration_info: "2027" },
])("refuses invalid, commercial, master or identity patch %p", (raw) => {
  expect(productContentFieldsSchema.safeParse(raw).success).toBe(false);
});
it("keeps omitted fields distinct from explicitly cleared fields without copied defaults", () => {
  expect(productContentValuesSchema.parse({})).toEqual({});
  expect(review.after).toEqual({
    product_name_th: "ใหม่",
    product_name_en: "Original",
    ingredients: null,
    allergens: null,
  });
  expect(
    Object.prototype.hasOwnProperty.call(
      review.after,
      "product_description_en",
    ),
  ).toBe(false);
  expect(
    editedProductContentValues(item, {
      ingredients: undefined,
      allergens: "milk",
    }),
  ).toEqual({
    product_name_en: "Original",
    ingredients: null,
    allergens: "milk",
  });
  expect(
    productContentFieldsSchema.parse({ ingredients: "literal\\u0000" })
      .ingredients,
  ).toBe("literal\\u0000");
});
it("binds packet identity and emits only the existing product update envelope", () => {
  expect(productContentUpdateEnvelope(packet)).toEqual({
    fields: selection.fields,
    contentEdit: {
      requestId: packet.requestId,
      sku: item.sku,
      version: item.version,
    },
  });
  const upper = productContentPacketSchema.parse({
    ...packet,
    productId: packet.productId.toUpperCase(),
    requestId: packet.requestId.toUpperCase(),
  });
  expect(upper.productId).toBe(packet.productId);
  expect(upper.requestId).toBe(packet.requestId);
  for (const extra of [
    { actor: "other" },
    { productId: item.productId },
    { selling_unit_price: 1 },
  ])
    expect(
      productContentUpdateSchema.safeParse({
        ...productContentUpdateEnvelope(packet),
        ...extra,
      }).success,
    ).toBe(false);
});
it("checks valid reviews and does not accept a packet as a strict selection", () => {
  expect(verifyProductContentReview(review, selection)).toEqual(review);
  expect(() => verifyProductContentReview(review, packet)).toThrow();
  for (const raw of [
    { ...review, item: { ...item, productId: packet.requestId } },
    { ...review, item: { ...item, sku: "OTHER" } },
    { ...review, item: { ...item, version: "b".repeat(64) } },
    { ...review, fields: { ingredients: "different" } },
    { ...review, after: item.current },
  ])
    expect(() => verifyProductContentReview(raw, selection)).toThrow();
});
it("accepts only the actual internally consistent content outcome", () => {
  expect(verifyProductContentReceipt(receipt, packet)).toEqual(receipt);
  for (const raw of [
    { ...receipt, persisted: false },
    { ...receipt, appliedCount: 0 },
    { ...receipt, outboxEnqueued: false },
    { ...receipt, downstreamDelivery: "delivered" },
    { ...receipt, requestId: item.productId },
    { ...receipt, before: { ...item, productId: packet.requestId } },
    { ...receipt, before: { ...item, sku: "OTHER" } },
    { ...receipt, before: { ...item, version: "b".repeat(64) } },
    { ...receipt, before: { ...item, evidenceSource: "archived_native" } },
    { ...receipt, after: { ...review.after, ingredients: "different" } },
  ])
    expect(() => verifyProductContentReceipt(raw, packet)).toThrow();
});
