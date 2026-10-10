// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  editedProductContentValues,
  type ProductContentReceipt,
} from "../../../../../commerce-platform/src/modules/commerce/product-content-editor/product-content-editor-contracts";
import {
  clearAcknowledgedContentDraft,
  clearContentJob,
  contentFieldsFromForm,
  initialContentForm,
  readContentForm,
  readContentJobs,
  readContentSelection,
  storeContentForm,
  storeContentJob,
  storeContentSelection,
  type ContentJob,
} from "./content-editor-journal";

const owner = "fixture-owner",
  productId = "00000000-0000-4000-8000-000000000010",
  id = "00000000-0000-4000-8000-000000000001";
const item = {
  productId,
  sku: "SYNTHETIC-CONTENT",
  version: "a".repeat(64),
  current: { product_name_th: "เดิม", product_description_en: null },
  currentRecorded: true,
  currentSource: "import",
  currentUpdatedAt: null,
  currentUpdatedBy: null,
  evidenceSource: "native" as const,
};
const selection = {
  productId,
  sku: item.sku,
  version: item.version,
  fields: { product_name_th: "ใหม่", ingredients: null },
};
function form() {
  const result = initialContentForm(item);
  result.fields.product_name_th = { mode: "set" as const, value: " ใหม่ " };
  result.fields.ingredients.mode = "clear";
  return result;
}
function job(
  requestId = id,
  selectedId = productId,
  sku = item.sku,
): ContentJob {
  const baseline = { ...item, productId: selectedId, sku },
    packet = { ...selection, productId: selectedId, sku, requestId };
  return {
    owner,
    packet,
    review: {
      item: baseline,
      fields: packet.fields,
      after: editedProductContentValues(baseline, packet.fields),
      ownership: "commerce",
      capturedAt: "2026-10-10T00:00:00.000Z",
    },
    conflict: false,
  };
}
function receipt(): ProductContentReceipt {
  const original = job();
  return {
    kind: "product_content_edit",
    scenario: { kind: "product_content_edit" },
    id,
    requestId: id,
    packet: original.packet,
    status: "committed",
    persisted: true,
    savedAt: original.review.capturedAt,
    before: item,
    after: original.review.after,
    appliedCount: 1,
    source: "staff",
    updatedBy: owner,
    outboxEnqueued: true,
    downstreamDelivery: "unverified",
  };
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
it("sets trimmed names, clears text explicitly and omits untouched missing and null fields", () => {
  expect(contentFieldsFromForm(form())).toEqual(selection.fields);
  const after = editedProductContentValues(item, selection.fields);
  expect(after.product_description_en).toBeNull();
  expect(after.product_name_en).toBeUndefined();
  expect(Object.hasOwn(after, "product_name_en")).toBe(false);
  expect(after.ingredients).toBeNull();
});
it.each(["product_name_th", "product_name_en"] as const)(
  "does not allow clearing or blanking %s",
  (field) => {
    const f = initialContentForm(item);
    f.fields[field].mode = "clear";
    expect(() => contentFieldsFromForm(f)).toThrow("Names cannot be cleared");
    f.fields[field] = { mode: "set", value: " " };
    expect(() => contentFieldsFromForm(f)).toThrow();
  },
);
it.each([
  "product_description_th",
  "product_description_en",
  "ingredients",
  "allergens",
] as const)("requires explicit Clear for blank %s", (field) => {
  const f = initialContentForm(item);
  f.fields[field] = { mode: "set", value: " \n " };
  expect(() => contentFieldsFromForm(f)).toThrow("Enter text");
  f.fields[field].mode = "clear";
  expect(contentFieldsFromForm(f)).toEqual({ [field]: null });
});
it("enforces the existing name/text length and NUL rules before preview", () => {
  const f = initialContentForm(item);
  f.fields.product_name_th = { mode: "set", value: "a".repeat(256) };
  expect(() => contentFieldsFromForm(f)).toThrow();
  f.fields.product_name_th = { mode: "keep", value: "" };
  f.fields.ingredients = { mode: "set", value: "a".repeat(20001) };
  expect(() => contentFieldsFromForm(f)).toThrow();
  f.fields.ingredients.value = "a\u0000b";
  expect(() => contentFieldsFromForm(f)).toThrow();
});
it("requires a selected field and rejects injected commercial fields", () => {
  expect(() => contentFieldsFromForm(initialContentForm(item))).toThrow(
    "Choose at least one",
  );
  expect(() =>
    contentFieldsFromForm({
      ...form(),
      fields: { ...form().fields, buying_price: { mode: "set", value: "1" } },
    } as never),
  ).toThrow();
});
it("a known product without native content starts with no copied text", () => {
  const empty = initialContentForm({
    ...item,
    currentRecorded: false,
    current: {},
    currentSource: null,
    evidenceSource: "unavailable",
  });
  expect(
    Object.values(empty.fields).every(
      (field) => field.mode === "keep" && field.value === "",
    ),
  ).toBe(true);
  expect(() => contentFieldsFromForm(empty)).toThrow();
});
it("draft and selection are private to account and product", () => {
  storeContentForm(owner, form());
  storeContentSelection(owner, selection);
  expect(readContentForm(owner, productId)).toEqual(form());
  expect(readContentSelection(owner, productId)).toEqual(selection);
  expect(readContentForm("another", productId)).toBeNull();
  expect(readContentSelection("another", productId)).toBeNull();
  expect(() => storeContentForm("", form())).toThrow();
});
it("missing recovery storage blocks before dispatch", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
  expect(() => storeContentForm(owner, form())).toThrow(
    "No content change was sent",
  );
  expect(() => storeContentSelection(owner, selection)).toThrow(
    "No content change was sent",
  );
  expect(() => storeContentJob(job())).toThrow("No content change was sent");
});
it("stores full packets while projecting strict review selection correctly", () => {
  const original = job();
  storeContentJob(original);
  expect(readContentJobs(owner)).toEqual([original]);
});
it("independent requests survive a single clear while corrupt records remain ignored", () => {
  const one = job(),
    two = job(
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000020",
      "OTHER",
    );
  storeContentJob(one);
  storeContentJob(two);
  localStorage.setItem(
    "cp-product-content-request:fixture-owner:broken",
    "not-json",
  );
  expect(readContentJobs(owner)).toHaveLength(2);
  expect(readContentJobs("another")).toEqual([]);
  clearContentJob(owner, id);
  expect(readContentJobs(owner)).toEqual([two]);
});
it("packet/evidence are immutable and a conflict cannot become retryable", () => {
  const original = job();
  storeContentJob(original);
  expect(() =>
    storeContentJob({
      ...original,
      review: { ...original.review, capturedAt: "2026-10-11T00:00:00.000Z" },
    }),
  ).toThrow("immutable");
  storeContentJob({ ...original, conflict: true });
  expect(() => storeContentJob(original)).toThrow("conflicted");
});
it("prevents a second unresolved edit to the same product or native SKU", () => {
  storeContentJob(job());
  expect(() =>
    storeContentJob(job("00000000-0000-4000-8000-000000000002")),
  ).toThrow("original");
  expect(() =>
    storeContentJob(
      job(
        "00000000-0000-4000-8000-000000000002",
        "00000000-0000-4000-8000-000000000020",
      ),
    ),
  ).toThrow("original");
});
it("copied or ownership-disabled evidence cannot be journaled for a write", () => {
  const original = job();
  expect(() =>
    storeContentJob({
      ...original,
      review: { ...original.review, ownership: "josh" },
    }),
  ).toThrow("native owned");
});
it("receipt acknowledgement clears only matching intent and keeps newer same-version drafts", () => {
  storeContentForm(owner, form());
  storeContentSelection(owner, selection);
  clearAcknowledgedContentDraft(owner, receipt());
  expect(readContentForm(owner, productId)).toBeNull();
  expect(readContentSelection(owner, productId)).toBeNull();
  const newer = form();
  newer.fields.product_name_th.value = "ใหม่กว่า";
  storeContentForm(owner, newer);
  storeContentSelection(owner, {
    ...selection,
    fields: { product_name_th: "ใหม่กว่า" },
  });
  clearAcknowledgedContentDraft(owner, receipt());
  expect(readContentForm(owner, productId)).toEqual(newer);
  expect(readContentSelection(owner, productId)?.fields.product_name_th).toBe(
    "ใหม่กว่า",
  );
});
it("an unpersisted or foreign actor receipt cannot clear a draft", () => {
  storeContentForm(owner, form());
  expect(() =>
    clearAcknowledgedContentDraft(owner, {
      ...receipt(),
      persisted: false,
    } as never),
  ).toThrow();
  expect(() =>
    clearAcknowledgedContentDraft(owner, {
      ...receipt(),
      updatedBy: "another",
    }),
  ).toThrow("another actor");
  expect(readContentForm(owner, productId)).toEqual(form());
});
