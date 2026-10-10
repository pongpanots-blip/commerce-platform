// @vitest-environment jsdom
import { beforeEach, expect, it, vi, afterEach } from "vitest";
import {
  clearManualDraft,
  clearManualJob,
  initialManualPriceForm,
  manualPatchFromForm,
  readManualForm,
  readManualJobs,
  readManualSelection,
  storeManualForm,
  storeManualJob,
  storeManualSelection,
  type ManualPriceJob,
} from "./manual-price-journal";
import {
  editedPriceValues,
  type ManualPriceReceipt,
} from "../../../../../commerce-platform/src/modules/commerce/product-prices/manual-price-contracts";

const owner = "fixture-owner";
const item = {
  sku: "SYNTHETIC/PRICE",
  version: "a".repeat(64),
  current: { sellingUnitPrice: "10.00", orderingPrice: "100.00", moq: 2 },
  currentRecorded: true,
  currentSource: "import",
  currentUpdatedAt: null,
  currentUpdatedBy: null,
};
const selection = {
  sku: item.sku,
  version: item.version,
  patch: { sellingUnitPrice: 12.5, orderingPrice: null },
};
function job(
  id = "00000000-0000-4000-8000-000000000001",
  sku = item.sku,
): ManualPriceJob {
  const packet = { ...selection, sku, requestId: id },
    baseline = { ...item, sku };
  return {
    owner,
    packet,
    review: {
      item: baseline,
      patch: selection.patch,
      after: editedPriceValues(baseline, selection.patch),
      ownership: "commerce",
      capturedAt: "2026-10-10T00:00:00.000Z",
    },
    conflict: false,
  };
}
const receipt = (): ManualPriceReceipt => {
  const j = job();
  return {
    kind: "product_price_edit",
    scenario: { kind: "product_price_edit" },
    id: j.packet.requestId,
    requestId: j.packet.requestId,
    packet: j.packet,
    status: "committed",
    persisted: true,
    savedAt: j.review.capturedAt,
    before: item,
    after: j.review.after,
    appliedCount: 1,
    source: "staff",
    updatedBy: owner,
    outboxEnqueued: true,
    downstreamDelivery: "unverified",
  };
};
function form() {
  const value = initialManualPriceForm(item);
  value.fields.sellingUnitPrice = { mode: "set", value: "12.50" };
  value.fields.orderingPrice.mode = "clear";
  return value;
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("keep omits a field, zero is a number and clear is null", () => {
  const f = initialManualPriceForm(item);
  f.fields.sellingUnitPrice = { mode: "set", value: "0" };
  f.fields.orderingPrice.mode = "clear";
  expect(manualPatchFromForm(f)).toEqual({
    sellingUnitPrice: 0,
    orderingPrice: null,
  });
  expect(() => manualPatchFromForm(initialManualPriceForm(item))).toThrow(
    "Choose at least one",
  );
});
it.each([
  "",
  "-1",
  "Infinity",
  "NaN",
  "1e2",
  "0x10",
  "12.345",
  "9999999999.991",
  "9999999999.9999999999",
  "10000000000",
])("rejects invalid price text %s before it can round or overflow", (value) => {
  const f = initialManualPriceForm(item);
  f.fields.sellingUnitPrice = { mode: "set", value };
  expect(() => manualPatchFromForm(f)).toThrow();
});
it.each(["1.5", "-1", "2147483648", "1e2", ""])(
  "rejects invalid MOQ %s",
  (value) => {
    const f = initialManualPriceForm(item);
    f.fields.moq = { mode: "set", value };
    expect(() => manualPatchFromForm(f)).toThrow();
  },
);
it("accepts exact legacy storage limits without supplying untouched fields", () => {
  const f = initialManualPriceForm(item);
  f.fields.sellingUnitPrice = { mode: "set", value: "9999999999.99" };
  f.fields.moq = { mode: "set", value: "2147483647" };
  expect(manualPatchFromForm(f)).toEqual({
    sellingUnitPrice: 9999999999.99,
    moq: 2147483647,
  });
});
it("restores only the exact owner's SKU draft and selection", () => {
  storeManualForm(owner, form());
  storeManualSelection(owner, selection);
  expect(readManualForm(owner, item.sku)).toEqual(form());
  expect(readManualSelection(owner, item.sku)).toEqual(selection);
  expect(readManualForm("another", item.sku)).toBeNull();
  expect(readManualSelection("another", item.sku)).toBeNull();
  expect(() => storeManualForm("", form())).toThrow();
});
it("silently dropped recovery storage stops before any request can be dispatched", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
  expect(() => storeManualForm(owner, form())).toThrow("No change was sent");
  expect(() => storeManualSelection(owner, selection)).toThrow(
    "No change was sent",
  );
  expect(() => storeManualJob(job())).toThrow("No change was sent");
});
it("retains independent intents and removes only the acknowledged request", () => {
  const one = job(),
    two = job("00000000-0000-4000-8000-000000000002", "OTHER-SKU");
  storeManualJob(one);
  storeManualJob(two);
  expect(readManualJobs(owner)).toHaveLength(2);
  expect(readManualJobs("another")).toEqual([]);
  clearManualJob(owner, one.packet.requestId);
  expect(readManualJobs(owner)).toEqual([two]);
});
it("does not replace packet or review evidence under the original request ID", () => {
  const one = job();
  storeManualJob(one);
  expect(() =>
    storeManualJob({
      ...one,
      packet: { ...one.packet, patch: { sellingUnitPrice: 13 } },
    }),
  ).toThrow();
  expect(() =>
    storeManualJob({
      ...one,
      review: { ...one.review, capturedAt: "2026-10-11T00:00:00.000Z" },
    }),
  ).toThrow("immutable");
  expect(readManualJobs(owner)).toEqual([one]);
});
it("blocks a second unresolved edit for the same SKU and prevents undoing a recorded conflict", () => {
  const one = job();
  storeManualJob(one);
  expect(() =>
    storeManualJob(job("00000000-0000-4000-8000-000000000002")),
  ).toThrow("original request");
  storeManualJob({ ...one, conflict: true });
  expect(() => storeManualJob(one)).toThrow("conflicted edit");
  expect(readManualJobs(owner)[0].conflict).toBe(true);
});
it("ignores corrupt or mismatched journal entries without losing valid independent intent", () => {
  storeManualJob(job());
  localStorage.setItem(
    "cp-manual-price-request:fixture-owner:broken",
    "not-json",
  );
  localStorage.setItem(
    "cp-manual-price-request:fixture-owner:wrong-key",
    JSON.stringify(job()),
  );
  expect(readManualJobs(owner)).toEqual([job()]);
});
it("clears the exact saved draft and review only when the committed packet matches", () => {
  storeManualForm(owner, form());
  storeManualSelection(owner, selection);
  clearManualDraft(owner, receipt());
  expect(readManualForm(owner, item.sku)).toBeNull();
  expect(readManualSelection(owner, item.sku)).toBeNull();
});
it("a saved receipt preserves a newer edit from the same baseline revision", () => {
  const newer = form();
  newer.fields.sellingUnitPrice.value = "13.00";
  storeManualForm(owner, newer);
  storeManualSelection(owner, {
    ...selection,
    patch: { sellingUnitPrice: 13 },
  });
  clearManualDraft(owner, receipt());
  expect(readManualForm(owner, item.sku)).toEqual(newer);
  expect(readManualSelection(owner, item.sku)?.patch).toEqual({
    sellingUnitPrice: 13,
  });
});
it("a saved receipt preserves a draft based on a later revision", () => {
  const newer = form();
  newer.item = { ...item, version: "b".repeat(64) };
  storeManualForm(owner, newer);
  storeManualSelection(owner, { ...selection, version: newer.item.version });
  clearManualDraft(owner, receipt());
  expect(readManualForm(owner, item.sku)).toEqual(newer);
  expect(readManualSelection(owner, item.sku)?.version).toBe(
    newer.item.version,
  );
});
it("cleanup rejects an unpersisted or another actor's receipt and retains the draft", () => {
  storeManualForm(owner, form());
  storeManualSelection(owner, selection);
  expect(() =>
    clearManualDraft(owner, {
      ...receipt(),
      persisted: false,
    } as unknown as ManualPriceReceipt),
  ).toThrow();
  expect(() =>
    clearManualDraft(owner, { ...receipt(), updatedBy: "another" }),
  ).toThrow("another actor");
  expect(readManualForm(owner, item.sku)).toEqual(form());
  expect(readManualSelection(owner, item.sku)).toEqual(selection);
});
it("the recovery cap preserves earlier intents and stops a new untracked dispatch", () => {
  for (let index = 1; index <= 30; index++) {
    storeManualJob(
      job(
        "00000000-0000-4000-8000-" + String(index).padStart(12, "0"),
        "SKU-" + index,
      ),
    );
  }
  expect(() =>
    storeManualJob(job("00000000-0000-4000-8000-000000000031", "SKU-31")),
  ).toThrow("Resolve earlier requests");
  expect(readManualJobs(owner)).toHaveLength(30);
});
