// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUiLocale } from "@cp/ui";
import { api, productPricesApi } from "../../../lib/api";
import {
  CurrentPrices,
  manualPriceEditUrl,
  manualPriceReviewUrl,
  manualPriceViewUrl,
} from "./CurrentPrices";
import { PriceApprovalWorkspace } from "./PriceApprovalWorkspace";
import {
  editedPriceValues,
  type ManualPriceItem,
  type ManualPricePacket,
  type ManualPriceReceipt,
  type ManualPriceReview,
} from "../../../../../commerce-platform/src/modules/commerce/product-prices/manual-price-contracts";
import {
  initialManualPriceForm,
  readManualForm,
  readManualJobs,
  readManualSelection,
  storeManualForm,
  storeManualJob,
  storeManualSelection,
} from "./manual-price-journal";
import { priceSkuFromToken } from "./price-approval-routing";
import { isRouteAllowed } from "../../../lib/landing";

vi.mock("../../../lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  productPricesApi: { list: vi.fn(), ownership: vi.fn() },
  session: { claims: () => ({ sub: "fixture-owner", role: "admin" }) },
}));
// The independently tested evidence adapter has its own source and permission contract.
vi.mock("./ProductEvidence", () => ({
  ProductEvidence: ({ sku }: { sku: string }) => (
    <aside aria-label="Authoritative product evidence">{sku}</aside>
  ),
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const owner = "fixture-owner",
  home = "/product-prices/current";
const baseline: ManualPriceItem = {
  sku: "SYNTHETIC/PRICE-1",
  version: "a".repeat(64),
  current: { sellingUnitPrice: "10.00", orderingPrice: "100.00", moq: 2 },
  currentRecorded: true,
  currentSource: "import",
  currentUpdatedAt: "2026-10-10T00:00:00.000Z",
  currentUpdatedBy: null,
};
const id = "00000000-0000-4000-8000-000000000001",
  patch = { sellingUnitPrice: 12.5, orderingPrice: null };
let root: Root,
  container: HTMLDivElement,
  navigate: ReturnType<typeof useNavigate>,
  path: string;
let item: ManualPriceItem,
  ownership: "commerce" | "josh",
  saved: ManualPriceReceipt | null;
function reviewed(packet: { patch: typeof patch }): ManualPriceReview {
  return {
    item,
    patch: packet.patch,
    after: editedPriceValues(item, packet.patch),
    ownership,
    capturedAt: "2026-10-10T00:01:00.000Z",
  };
}
function receipt(packet: ManualPricePacket): ManualPriceReceipt {
  const review = reviewed(packet as { patch: typeof patch });
  return {
    kind: "product_price_edit",
    scenario: { kind: "product_price_edit" },
    id: packet.requestId,
    requestId: packet.requestId,
    packet,
    status: "committed",
    persisted: true,
    savedAt: review.capturedAt,
    before: item,
    after: review.after,
    appliedCount: 1,
    source: "staff",
    updatedBy: owner,
    outboxEnqueued: true,
    downstreamDelivery: "unverified",
  };
}
function selection() {
  const form = initialManualPriceForm(item);
  form.fields.sellingUnitPrice = { mode: "set", value: "12.50" };
  form.fields.orderingPrice.mode = "clear";
  storeManualForm(owner, form);
  const value = { sku: item.sku, version: item.version, patch };
  storeManualSelection(owner, value);
  return value;
}
function original() {
  const packet = { ...selection(), requestId: id };
  return { owner, packet, review: reviewed(packet), conflict: false };
}
const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function Observe() {
  navigate = useNavigate();
  const location = useLocation();
  path = location.pathname + location.search;
  return null;
}
async function render(
  url = home,
  role = "admin",
  account = owner,
  integrated = false,
) {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <Observe />
        {integrated ? (
          <PriceApprovalWorkspace role={role} owner={account} />
        ) : (
          <CurrentPrices role={role} owner={account} />
        )}
      </MemoryRouter>,
    ),
  );
}
const content = () => container.textContent ?? "";
const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (node) => node.textContent === label,
  )!;
async function click(label: string) {
  await act(async () => button(label).click());
}
async function link(url: string) {
  await act(async () =>
    container
      .querySelector<HTMLAnchorElement>('a[href="' + url + '"]')!
      .click(),
  );
}
async function confirm() {
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click(),
  );
}
async function choose(key: string, mode: string) {
  const input = container.querySelector<HTMLSelectElement>(
    'select[name="' + key + '-mode"]',
  )!;
  await act(async () => {
    input.value = mode;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function fill(key: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(
    'input[name="' + key + '"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const writes = () =>
  vi.mocked(api.post).mock.calls.filter(([url]) => url.endsWith("/actions"));
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  setUiLocale("en");
  item = { ...baseline, current: { ...baseline.current } };
  ownership = "commerce";
  saved = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(productPricesApi.list).mockImplementation(
    async (_search, page, limit) =>
      ({
        items: [
          {
            sku: item.sku,
            selling_unit_price: item.current.sellingUnitPrice,
            ordering_price: item.current.orderingPrice,
            moq: item.current.moq,
            source: "import",
            updated_by: null,
            updated_at: baseline.currentUpdatedAt!,
          },
        ],
        total: 1,
        page,
        limit,
      }) as never,
  );
  vi.mocked(productPricesApi.ownership).mockImplementation(
    async () => ({ prices: ownership === "commerce" }) as never,
  );
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url.includes("/items/")) return { item, ownership } as never;
    if (url.includes("/requests/")) {
      if (saved) return saved as never;
      throw Object.assign(Error("Fixture request absent"), { status: 404 });
    }
    throw Error("Unexpected fixture read: " + url);
  });
  vi.mocked(api.post).mockImplementation(async (url, value) => {
    if (url.endsWith("/review"))
      return reviewed(value as { patch: typeof patch }) as never;
    if (url.endsWith("/actions")) {
      saved = receipt(value as ManualPricePacket);
      return saved as never;
    }
    throw Error("Unexpected fixture write: " + url);
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setUiLocale("th");
  vi.restoreAllMocks();
});

it("opens canonical inspect and edit URLs through the existing price workspace", async () => {
  await render(home, "admin", owner, true);
  expect(
    container.querySelector('a[href="' + manualPriceViewUrl(item.sku) + '"]'),
  ).not.toBeNull();
  await link(manualPriceViewUrl(item.sku));
  expect(content()).toContain("Inspect product price");
  expect(content()).toContain("Price record exists");
  expect(content()).not.toContain("Saved price edit");
  await link(manualPriceEditUrl(item.sku));
  expect(path).toBe(manualPriceEditUrl(item.sku));
  expect(container.querySelectorAll("select[name$='-mode']")).toHaveLength(2);
  // Josh prices off ERP PRICE only: the per-selling-unit rate is display-only, never editable.
  expect(container.querySelector("select[name='sellingUnitPrice-mode']")).toBeNull();
  expect(writes()).toHaveLength(0);
});
it("edit→review→persist keeps zero/clear/omitted semantics and guards duplicate clicks", async () => {
  await render(manualPriceEditUrl(item.sku));
  await choose("orderingPrice", "set");
  await fill("orderingPrice", "0");
  await choose("moq", "clear");
  expect(content()).toContain("Local edit — not submitted");
  await click("Review price edit");
  expect(path).toBe(manualPriceReviewUrl(item.sku));
  expect(button("Save reviewed price edit").disabled).toBe(true);
  expect(writes()).toHaveLength(0);
  await confirm();
  const pending = deferred<unknown>();
  vi.mocked(api.post).mockImplementationOnce(async (_url, value) => {
    saved = receipt(value as ManualPricePacket);
    return pending.promise as never;
  });
  const save = button("Save reviewed price edit");
  await act(async () => {
    save.click();
    save.click();
  });
  expect(writes()).toHaveLength(1);
  expect(writes()[0][1]).toMatchObject({
    sku: item.sku,
    version: item.version,
    patch: { orderingPrice: 0, moq: null },
  });
  expect(content()).not.toContain("Saved price edit for 1 SKU");
  expect(content()).toContain("Waiting for a confirmed outcome");
  expect(readManualJobs(owner)).toHaveLength(1);
  await act(async () => pending.resolve(saved));
  expect(path).toContain("/requests/");
  expect(content()).toContain("Saved price edit for 1 SKU");
  expect(content()).toContain("Reviewed baseline: ");
  expect(content()).toContain("Prices may have changed since");
  expect(content()).toContain("Shop delivery remains unverified");
  expect(readManualJobs(owner)).toEqual([]);
  expect(readManualForm(owner, item.sku)).toBeNull();
});
it("back and forward restore draft fields but require confirmation again", async () => {
  await render(manualPriceEditUrl(item.sku));
  await choose("orderingPrice", "set");
  await fill("orderingPrice", "12.50");
  await click("Review price edit");
  await confirm();
  await act(async () => navigate(-1));
  expect(
    container.querySelector<HTMLInputElement>('input[name="orderingPrice"]')
      ?.value,
  ).toBe("12.50");
  await act(async () => navigate(1));
  expect(
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')
      ?.checked,
  ).toBe(false);
  expect(button("Save reviewed price edit").disabled).toBe(true);
  expect(writes()).toHaveLength(0);
});
it("an unchanged edit cannot reach preview and invalid fields are labeled and focused", async () => {
  await render(manualPriceEditUrl(item.sku));
  await click("Review price edit");
  expect(content()).toContain("Choose at least one field");
  expect(api.post).not.toHaveBeenCalled();
  await choose("orderingPrice", "set");
  await fill("orderingPrice", "12.345");
  await click("Review price edit");
  const invalid = container.querySelector<HTMLInputElement>(
    '[aria-invalid="true"]',
  )!;
  expect(invalid.name).toBe("orderingPrice");
  expect(document.activeElement).toBe(invalid);
  expect(invalid.getAttribute("aria-describedby")).toContain("-error");
  expect(api.post).not.toHaveBeenCalled();
});
it("direct review without the owner's selection has a useful empty state", async () => {
  await render(manualPriceReviewUrl(item.sku));
  expect(content()).toContain("No selected edit for this account");
  expect(api.post).not.toHaveBeenCalled();
  expect(button("Save reviewed price edit")).toBeUndefined();
});
it("stale retained draft cannot be sent until explicitly restarted from current evidence", async () => {
  selection();
  item = {
    ...item,
    version: "b".repeat(64),
    current: { ...item.current, sellingUnitPrice: "20.00" },
  };
  await render(manualPriceEditUrl(item.sku));
  expect(content()).toContain("Current values changed");
  expect(button("Review price edit").disabled).toBe(true);
  await click("Start again from current values");
  expect(readManualForm(owner, item.sku)?.item.version).toBe(item.version);
  expect(readManualForm(owner, item.sku)?.fields.sellingUnitPrice.mode).toBe(
    "keep",
  );
  expect(writes()).toHaveLength(0);
});
it("failed evidence read shows retained local baseline and retries without writes", async () => {
  selection();
  vi.mocked(api.get).mockRejectedValueOnce(Error("Evidence unavailable"));
  await render(manualPriceEditUrl(item.sku));
  expect(content()).toContain("Current values are unverified");
  expect(button("Review price edit")).toBeUndefined();
  await click("Try again");
  expect(button("Review price edit")).toBeDefined();
  expect(writes()).toHaveLength(0);
});
it("review conflict or inconsistent preview prevents a durable action", async () => {
  selection();
  vi.mocked(api.post).mockRejectedValueOnce(
    Object.assign(Error("Evidence changed"), { status: 409 }),
  );
  await render(manualPriceReviewUrl(item.sku));
  expect(content()).toContain("No edit can be sent");
  expect(button("Save reviewed price edit")).toBeUndefined();
  expect(writes()).toHaveLength(0);
});
it("does not accept a valid-shaped preview with a different after value", async () => {
  const selected = selection();
  vi.mocked(api.post).mockResolvedValueOnce({
    ...reviewed(selected),
    after: { ...item.current, sellingUnitPrice: "999.00" },
  } as never);
  await render(manualPriceReviewUrl(item.sku));
  expect(content()).toContain("differs from the requested edit");
  expect(button("Save reviewed price edit")).toBeUndefined();
  expect(writes()).toHaveLength(0);
});
it("disabled ownership still exposes inspect evidence without implying the live Josh price", async () => {
  ownership = "josh";
  await render(manualPriceViewUrl(item.sku));
  expect(content()).toContain("Retained commerce values may differ");
  expect(
    container.querySelector('a[href="' + manualPriceEditUrl(item.sku) + '"]'),
  ).toBeNull();
  expect(writes()).toHaveLength(0);
});
it("ownership change on a deep review blocks saving despite retained selection", async () => {
  selection();
  ownership = "josh";
  await render(manualPriceReviewUrl(item.sku));
  await confirm();
  expect(button("Save reviewed price edit").disabled).toBe(true);
  expect(writes()).toHaveLength(0);
});
it("loading shows a skeleton without fabricated count or successful outcome", async () => {
  const pending = deferred<unknown>();
  vi.mocked(productPricesApi.list).mockReturnValueOnce(
    pending.promise as never,
  );
  await render();
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(content()).not.toContain("Recorded price records: 0");
  expect(content()).not.toContain("Saved price edit");
  await act(async () => pending.reject(Error("List unavailable")));
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await click("Try again");
  expect(content()).toContain("Recorded price records: 1");
});
it("empty recorded-price search links to known-SKU inspection and first-record creation", async () => {
  vi.mocked(productPricesApi.list).mockResolvedValueOnce({
    items: [],
    total: 0,
    page: 1,
    limit: 20,
  } as never);
  item = {
    ...item,
    currentRecorded: false,
    current: { sellingUnitPrice: null, orderingPrice: null, moq: null },
    currentSource: null,
    currentUpdatedAt: null,
  };
  await render(home + "?search=" + encodeURIComponent(item.sku));
  expect(content()).toContain("No matching SKU");
  await link(manualPriceViewUrl(item.sku));
  expect(content()).toContain("No price record");
  expect(content()).toContain(
    "Saving creates a price row with only the selected fields",
  );
  expect(writes()).toHaveLength(0);
});
it("invalid query pages are normalized and an emptied last page uses replacement navigation", async () => {
  await render(home + "?page=Infinity");
  expect(productPricesApi.list).toHaveBeenCalledWith("", 1, 20);
  await act(async () => navigate(home + "?page=3&limit=20"));
  expect(path).toBe(home + "?page=1&limit=20");
  expect(writes()).toHaveLength(0);
});
it("a lost reply checks the committed original outcome before allowing any resend", async () => {
  selection();
  vi.mocked(api.post).mockImplementation(async (url, value) => {
    if (url.endsWith("/review"))
      return reviewed(value as { patch: typeof patch }) as never;
    saved = receipt(value as ManualPricePacket);
    throw Error("Reply lost after commit");
  });
  await render(manualPriceReviewUrl(item.sku));
  await confirm();
  await click("Save reviewed price edit");
  expect(content()).toContain("Saved price edit for 1 SKU");
  expect(writes()).toHaveLength(1);
  expect(readManualJobs(owner)).toEqual([]);
});
it("failed write retains original intent and permits only a checked exact retry", async () => {
  selection();
  vi.mocked(api.post).mockImplementationOnce(
    async (_url, value) => reviewed(value as { patch: typeof patch }) as never,
  );
  vi.mocked(api.post).mockRejectedValueOnce(
    Error("Request interrupted before commit"),
  );
  await render(manualPriceReviewUrl(item.sku));
  await confirm();
  await click("Save reviewed price edit");
  expect(content()).toContain("Completion is unconfirmed");
  const packet = writes()[0][1];
  expect(button("Retry checked original edit").disabled).toBe(true);
  await confirm();
  await click("Retry checked original edit");
  expect(writes()).toHaveLength(2);
  expect(writes()[1][1]).toEqual(packet);
  expect(content()).toContain("Saved price edit for 1 SKU");
});
it("receipt lookup failure cannot be interpreted as absence or expose a retry write", async () => {
  storeManualJob(original());
  vi.mocked(api.get).mockRejectedValueOnce(Error("Receipt unavailable"));
  await render(home + "/requests/" + id);
  expect(button("Retry checked original edit")).toBeUndefined();
  expect(readManualJobs(owner)).toHaveLength(1);
  expect(writes()).toHaveLength(0);
});
it("a stale conflict is checked as absent before it can be dismissed and never automatically retried", async () => {
  const job = original();
  storeManualJob({ ...job, conflict: true });
  await render(home + "/requests/" + id);
  expect(button("Retry checked original edit")).toBeUndefined();
  await click("Dismiss uncommitted stale edit");
  expect(readManualJobs(owner)).toEqual([]);
  expect(writes()).toHaveLength(0);
});
it("an outstanding original SKU request blocks a second edit at inspection and deep edit", async () => {
  storeManualJob(original());
  await render(manualPriceViewUrl(item.sku));
  expect(content()).toContain("Original requests are retained");
  expect(
    container.querySelector('a[href="' + manualPriceEditUrl(item.sku) + '"]'),
  ).toBeNull();
  await act(async () => navigate(manualPriceEditUrl(item.sku)));
  expect(button("Review price edit").disabled).toBe(true);
  expect(writes()).toHaveLength(0);
});
it("successful write arriving after review is left remains discoverable on this device", async () => {
  selection();
  const pending = deferred<unknown>();
  vi.mocked(api.post).mockImplementation(async (url, value) =>
    url.endsWith("/actions")
      ? (pending.promise as never)
      : (reviewed(value as { patch: typeof patch }) as never),
  );
  await render(manualPriceReviewUrl(item.sku));
  await confirm();
  await click("Save reviewed price edit");
  await act(async () => navigate(home));
  await act(async () =>
    pending.resolve(receipt(writes()[0][1] as ManualPricePacket)),
  );
  expect(path).toBe(home);
  expect(readManualJobs(owner)).toHaveLength(1);
  expect(content()).toContain("Check price edit: ");
});
it("an outcome read arriving after navigation does not erase the recovery journal", async () => {
  const job = original();
  storeManualJob(job);
  const pending = deferred<unknown>();
  vi.mocked(api.get).mockReturnValueOnce(pending.promise as never);
  await render(home + "/requests/" + id);
  await act(async () => navigate(home));
  await act(async () => pending.resolve(receipt(job.packet)));
  expect(readManualJobs(owner)).toHaveLength(1);
});
it("unavailable recovery storage fails before action dispatch and leaves the review open", async () => {
  selection();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
  await render(manualPriceReviewUrl(item.sku));
  await confirm();
  await click("Save reviewed price edit");
  expect(path).toBe(manualPriceReviewUrl(item.sku));
  expect(content()).toContain("No change was sent");
  expect(writes()).toHaveLength(0);
});
it("edit preparation reports unavailable storage without navigating or requesting a preview", async () => {
  await render(manualPriceEditUrl(item.sku));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
  await choose("orderingPrice", "set");
  await fill("orderingPrice", "12.50");
  await click("Review price edit");
  expect(path).toBe(manualPriceEditUrl(item.sku));
  expect(content()).toContain(
    "Recovery storage unavailable. No change was sent.",
  );
  expect(api.post).not.toHaveBeenCalled();
});
it.each(["persisted", "actor", "after", "request"])(
  "a mismatched %s receipt never produces success or clears the journal",
  async (mismatch) => {
    const job = original();
    storeManualJob(job);
    const value = receipt(job.packet);
    const bad =
      mismatch === "persisted"
        ? { ...value, persisted: false }
        : mismatch === "actor"
          ? { ...value, updatedBy: "another" }
          : mismatch === "request"
            ? { ...value, requestId: "00000000-0000-4000-8000-000000000099" }
            : { ...value, after: { ...value.after, moq: 100 } };
    vi.mocked(api.get).mockResolvedValueOnce(bad as never);
    await render(home + "/requests/" + id);
    expect(content()).not.toContain("Saved price edit for 1 SKU");
    expect(readManualJobs(owner)).toHaveLength(1);
    expect(writes()).toHaveLength(0);
  },
);
it("receipt cleanup preserves a different newer draft based on the same revision", async () => {
  const job = original();
  storeManualJob(job);
  const newer = initialManualPriceForm(item);
  newer.fields.sellingUnitPrice = { mode: "set", value: "20.00" };
  storeManualForm(owner, newer);
  storeManualSelection(owner, {
    sku: item.sku,
    version: item.version,
    patch: { sellingUnitPrice: 20 },
  });
  saved = receipt(job.packet);
  await render(home + "/requests/" + id);
  expect(content()).toContain("Saved price edit for 1 SKU");
  expect(readManualJobs(owner)).toEqual([]);
  expect(readManualForm(owner, item.sku)).toEqual(newer);
  expect(readManualSelection(owner, item.sku)?.patch).toEqual({
    sellingUnitPrice: 20,
  });
});
it.each(["A/B", "A\\B", "..", "ไทย.1", "A % B", " A ", "🐟".repeat(64)])(
  "native SKU %s keeps an allowed round-trip task URL",
  (sku) => {
    const url = manualPriceViewUrl(sku);
    expect(priceSkuFromToken(url.split("/").pop()!)).toBe(sku);
    for (const route of [
      url,
      manualPriceEditUrl(sku),
      manualPriceReviewUrl(sku),
    ])
      expect(isRouteAllowed("admin", route)).toBe(true);
  },
);
it("malformed task paths stop before any evidence or action request", async () => {
  await render(home + "/s-00041/edit");
  expect(content()).toContain("Price edit page not found");
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
it.each(["\u0000", "   ", "🐟".repeat(65)])(
  "unrepresentable manual SKU %s is denied before evidence reads",
  async (sku) => {
    await render(manualPriceEditUrl(sku));
    expect(content()).toContain("Price edit page not found");
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  },
);
it.each([
  "business_analyst",
  "sale",
  "sales_manager",
  "marketing",
  "cs",
  "graphic",
  "unknown",
])("%s remains denied before price reads or writes", async (role) => {
  await render(manualPriceEditUrl(item.sku), role);
  expect(content()).toContain("cannot access price edits");
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
it("an absent actor identity cannot read or send price edits", async () => {
  await render(manualPriceEditUrl(item.sku), "admin", "");
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
