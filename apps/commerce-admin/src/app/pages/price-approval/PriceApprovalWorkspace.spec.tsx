// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUiLocale } from "@cp/ui";
import { api } from "../../../lib/api";
import { PriceApprovalWorkspace } from "./PriceApprovalWorkspace";
import { approvedPriceValues } from "../../../../../commerce-platform/src/modules/commerce/product-prices/price-approval-contracts";
import {
  clearPriceJob,
  readPriceJobs,
  storePriceJob,
  storePriceReview,
  reviewKey,
} from "./price-approval-journal";
import { priceDetailUrl, priceSkuFromToken } from "./price-approval-routing";
import { isRouteAllowed } from "../../../lib/landing";
vi.mock("../../../lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  session: { claims: () => ({ sub: "fixture", role: "merchandising" }) },
  productPricesApi: { ownership: vi.fn(), list: vi.fn(), edit: vi.fn() },
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root,
  container: HTMLDivElement,
  navigate: ReturnType<typeof useNavigate>,
  path: string,
  saved: unknown;
const item = {
  sku: "SYNTHETIC-PRICE-1",
  version: "a".repeat(64),
  current: { sellingUnitPrice: "10.00", orderingPrice: "100.00", moq: 1 },
  proposed: { sellingUnitPrice: "12.50", orderingPrice: null, moq: null },
  currentRecorded: true,
  currentSource: "import",
  currentUpdatedAt: null,
  currentUpdatedBy: null,
  changedAt: null,
  receivedAt: "2026-10-10T00:00:00.000Z",
};
const review = {
  items: [item],
  ownership: "commerce" as const,
  capturedAt: item.receivedAt,
};
const id = "00000000-0000-4000-8000-000000000001",
  packet = {
    requestId: id,
    decision: "approve" as const,
    changes: [{ sku: item.sku, version: item.version }],
  };
const receipt = (p = packet) => ({
  kind: "product_price_approval",
  scenario: { kind: "product_price_approval" },
  id,
  requestId: p.requestId,
  packet: p,
  status: "committed",
  persisted: true,
  appliedCount: 1,
  items: [
    {
      before: item,
      after:
        p.decision === "approve" ? approvedPriceValues(item) : item.current,
      outcome: p.decision === "approve" ? "approved" : "rejected",
    },
  ],
  savedAt: item.receivedAt,
  outboxEnqueued: p.decision === "approve",
  downstreamDelivery:
    p.decision === "approve" ? "unverified" : "not_applicable",
});
const deferred = <T,>() => {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function Observe() {
  navigate = useNavigate();
  path = useLocation().pathname;
  return null;
}
async function render(url = "/product-prices", role = "merchandising") {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <Observe />
        <PriceApprovalWorkspace role={role} owner="fixture" />
      </MemoryRouter>,
    ),
  );
}
const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  )!;
const checkbox = () =>
  container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
async function click(label: string) {
  await act(async () => button(label).click());
}
async function confirm() {
  await act(async () => checkbox().click());
}
const writes = () =>
  vi.mocked(api.post).mock.calls.filter(([p]) => p.endsWith("/actions"));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  saved = null;
  setUiLocale("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(api.get).mockImplementation(async (p) => {
    if (p.includes("/pending?"))
      return {
        items: [item],
        total: 1,
        page: 1,
        limit: 20,
        ownership: "commerce",
      } as never;
    if (p.includes("/items/")) return review as never;
    if (p.includes("/requests/")) {
      if (saved) return saved as never;
      throw Object.assign(Error("Not found"), { status: 404 });
    }
    throw Error("Unexpected read " + p);
  });
  vi.mocked(api.post).mockImplementation(async (p, b) => {
    if (p.endsWith("/review")) return review as never;
    if (p.endsWith("/actions")) {
      saved = receipt(b as typeof packet);
      return saved as never;
    }
    throw Error("Unexpected write " + p);
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setUiLocale("th");
  vi.restoreAllMocks();
});
it("shows loading instead of fabricated zero/empty, retry, and actual pending count", async () => {
  const d = deferred<unknown>();
  vi.mocked(api.get).mockReturnValueOnce(d.promise as never);
  await render();
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Pending: 0");
  await act(async () => d.reject(Error("Unavailable")));
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await click("Try again");
  expect(container.textContent).toContain("Pending: 1");
});
it("uses detail/review/outcome URLs, explicit confirmation, one native request and authoritative success", async () => {
  await render(priceDetailUrl(item.sku));
  expect(container.textContent).toContain("Keep current value");
  expect(container.textContent).toContain("100.00");
  await click("Review before approval");
  expect(path).toBe(priceDetailUrl(item.sku) + "/review");
  expect(button("Approve reviewed prices").disabled).toBe(true);
  expect(writes()).toHaveLength(0);
  await confirm();
  const b = button("Approve reviewed prices");
  await act(async () => {
    b.click();
    b.click();
  });
  expect(writes()).toHaveLength(1);
  expect(path).toContain("/requests/");
  expect(container.textContent).toContain("Approved 1 SKU(s)");
  expect(readPriceJobs("fixture")).toEqual([]);
});
it("requires a fresh confirmation after back/forward and preserves the reviewed scope", async () => {
  await render(priceDetailUrl(item.sku));
  await click("Review before approval");
  await confirm();
  await act(async () => navigate(-1));
  await act(async () => navigate(1));
  expect(checkbox().checked).toBe(false);
  expect(button("Approve reviewed prices").disabled).toBe(true);
  expect(writes()).toHaveLength(0);
});
it("preserves a discoverable request when a successful write finishes after leaving review", async () => {
  const d = deferred<unknown>();
  vi.mocked(api.post).mockImplementation(async (p, b) =>
    p.endsWith("/actions") ? (d.promise as never) : (review as never),
  );
  await render(priceDetailUrl(item.sku) + "/review?decision=approve");
  await confirm();
  await click("Approve reviewed prices");
  await act(async () => navigate("/product-prices"));
  await act(async () => d.resolve(receipt(writes()[0][1] as typeof packet)));
  expect(path).toBe("/product-prices");
  expect(readPriceJobs("fixture")).toHaveLength(1);
  expect(container.textContent).toContain("Check original requests");
});
it("does not clear a request when a receipt read finishes after leaving outcome", async () => {
  storePriceJob({ owner: "fixture", packet, review, conflict: false });
  const d = deferred<unknown>();
  vi.mocked(api.get).mockImplementation(async (p) =>
    p.includes("/requests/")
      ? (d.promise as never)
      : ({
          items: [item],
          total: 1,
          page: 1,
          limit: 20,
          ownership: "commerce",
        } as never),
  );
  await render("/product-prices/requests/" + id);
  await act(async () => navigate("/product-prices"));
  await act(async () => d.resolve(receipt()));
  expect(readPriceJobs("fixture")).toHaveLength(1);
});
it("lost response recovers the committed receipt before any resend", async () => {
  vi.mocked(api.post).mockImplementation(async (p, b) => {
    if (p.endsWith("/actions")) {
      saved = receipt(b as typeof packet);
      throw Error("Lost reply");
    }
    return review as never;
  });
  await render(priceDetailUrl(item.sku) + "/review?decision=approve");
  await confirm();
  await click("Approve reviewed prices");
  expect(container.textContent).toContain("Approved 1 SKU(s)");
  expect(writes()).toHaveLength(1);
});
it("confirmed absent outcome allows only an explicitly confirmed exact original retry", async () => {
  storePriceJob({ owner: "fixture", packet, review, conflict: false });
  await render("/product-prices/requests/" + id);
  expect(button("Retry checked original request").disabled).toBe(true);
  await confirm();
  await click("Retry checked original request");
  expect(writes()[0][1]).toEqual(packet);
  expect(container.textContent).toContain("Approved 1 SKU(s)");
});
it("lookup failure does not prove absence or expose a retry write", async () => {
  storePriceJob({ owner: "fixture", packet, review, conflict: false });
  vi.mocked(api.get).mockRejectedValueOnce(Error("Receipt unavailable"));
  await render("/product-prices/requests/" + id);
  expect(writes()).toHaveLength(0);
  expect(button("Retry checked original request")).toBeUndefined();
  expect(readPriceJobs("fixture")).toHaveLength(1);
});
it("stale review shows retained evidence and blocks confirmation; native conflicts never auto retry", async () => {
  storePriceReview("fixture", "/product-prices/review", review);
  vi.mocked(api.post).mockRejectedValueOnce(
    Object.assign(Error("Evidence changed"), { status: 409 }),
  );
  await render("/product-prices/review?decision=approve");
  expect(container.textContent).toContain("12.50");
  expect(button("Approve reviewed prices")).toBeUndefined();
  expect(writes()).toHaveLength(0);
});
it("stays on review when pre-dispatch recovery storage cannot be verified", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
  await render(priceDetailUrl(item.sku) + "/review?decision=approve");
  await confirm();
  await click("Approve reviewed prices");
  expect(path).toContain("/review");
  expect(writes()).toHaveLength(0);
  expect(container.textContent).toContain("No decision was sent");
});
it("rejects incomplete partial-shaped receipts without claiming completion", async () => {
  vi.mocked(api.post).mockImplementation(async (p) =>
    p.endsWith("/actions")
      ? ({ ...receipt(), appliedCount: 0 } as never)
      : (review as never),
  );
  await render(priceDetailUrl(item.sku) + "/review?decision=approve");
  await confirm();
  await click("Approve reviewed prices");
  expect(container.textContent).not.toContain("Approved 1 SKU(s)");
  expect(container.textContent).toContain("Completion is unconfirmed");
  expect(readPriceJobs("fixture")).toHaveLength(1);
});
it("blocks an empty native approval patch but permits reviewed rejection", async () => {
  vi.mocked(api.get).mockResolvedValueOnce({
    ...review,
    items: [
      {
        ...item,
        proposed: { sellingUnitPrice: null, orderingPrice: null, moq: null },
      },
    ],
  } as never);
  await render(priceDetailUrl(item.sku) + "/review?decision=approve");
  await confirm();
  expect(button("Approve reviewed prices").disabled).toBe(true);
  expect(container.textContent).toContain("no price fields");
});
it("corrects an emptied last page instead of claiming the entire queue is empty", async () => {
  vi.mocked(api.get).mockResolvedValueOnce({
    items: [],
    total: 40,
    page: 3,
    limit: 20,
    ownership: "commerce",
  } as never);
  await render("/product-prices?page=3");
  expect(
    vi.mocked(api.get).mock.calls.some(([p]) => p.includes("page=2")),
  ).toBe(true);
  expect(container.textContent).toContain(item.sku);
});
it.each([
  "business_analyst",
  "sale",
  "sales_manager",
  "marketing",
  "cs",
  "graphic",
])("%s is denied before any price reads", async (role) => {
  await render("/product-prices", role);
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
it("owner-private per-request keys preserve concurrent inserts and single clears, and skip only corrupt entries", () => {
  const second = {
    ...packet,
    requestId: "00000000-0000-4000-8000-000000000002",
  };
  const original = Storage.prototype.setItem;
  let interleaved = false;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    k,
    v,
  ) {
    if (!interleaved) {
      interleaved = true;
      storePriceJob({
        owner: "fixture",
        packet: second,
        review,
        conflict: false,
      });
    }
    original.call(this, k, v);
  });
  storePriceJob({ owner: "fixture", packet, review, conflict: false });
  expect(readPriceJobs("fixture")).toHaveLength(2);
  expect(readPriceJobs("other")).toEqual([]);
  localStorage.setItem("cp-price-approval-request:fixture:broken", "not-json");
  expect(readPriceJobs("fixture")).toHaveLength(2);
  clearPriceJob("fixture", id);
  expect(readPriceJobs("fixture").map((j) => j.packet.requestId)).toEqual([
    second.requestId,
  ]);
});
it("keeps original request evidence immutable and binds private review backup to its owner", () => {
  storePriceJob({ owner: "fixture", packet, review, conflict: false });
  expect(() =>
    storePriceJob({
      owner: "fixture",
      packet: { ...packet, decision: "reject" },
      review,
      conflict: false,
    }),
  ).toThrow("immutable");
  storePriceReview("fixture", "/product-prices/review", review);
  expect(
    localStorage.getItem(reviewKey("other", "/product-prices/review")),
  ).toBeNull();
});
it.each(["A/B", "A\\B", "..", "ไทย.1", "A % B", "🐟".repeat(64)])(
  "keeps native SKU %s navigable without broadening encoded-path policy",
  (sku) => {
    const url = priceDetailUrl(sku);
    expect(isRouteAllowed("merchandising", url)).toBe(true);
    expect(priceSkuFromToken(url.split("/").pop()!)).toBe(sku);
  },
);
it("renders detail for a full native 64-character supplementary Unicode SKU", async () => {
  const sku = "🐟".repeat(64);
  vi.mocked(api.get).mockResolvedValueOnce({
    ...review,
    items: [{ ...item, sku }],
  } as never);
  await render(priceDetailUrl(sku));
  expect(button("Review before approval")).toBeDefined();
  expect(container.textContent).toContain(sku);
  expect(api.get).toHaveBeenCalledWith(
    "/product-prices/workspace/items/" + encodeURIComponent(sku),
  );
});
it("rejects a SKU beyond the native Unicode character limit", () => {
  expect(
    priceSkuFromToken(priceDetailUrl("🐟".repeat(65)).split("/").pop()!),
  ).toBeNull();
});
it("a direct batch review with no selection has a useful empty state and cannot dispatch", async () => {
  await render("/product-prices/review?decision=approve");
  expect(container.textContent).toContain("No reviewed selection");
  expect(writes()).toHaveLength(0);
});
it("does not silently replace selected scope with a different valid server review", async () => {
  storePriceReview("fixture", "/product-prices/review", review);
  vi.mocked(api.post).mockResolvedValueOnce({
    ...review,
    items: [{ ...item, sku: "other" }],
  } as never);
  await render("/product-prices/review?decision=approve");
  expect(container.textContent).toContain(
    "differs from the reviewed selection",
  );
  expect(button("Approve reviewed prices")).toBeUndefined();
  expect(writes()).toHaveLength(0);
});
it("canonicalizes an uppercase outcome UUID and clears the matching original intent after rendering", async () => {
  const original = {
    ...packet,
    requestId: "00000000-0000-4000-8000-00000000000a",
  };
  storePriceJob({
    owner: "fixture",
    packet: original,
    review,
    conflict: false,
  });
  saved = receipt(original);
  await render("/product-prices/requests/" + original.requestId.toUpperCase());
  expect(readPriceJobs("fixture")).toEqual([]);
  expect(container.textContent).toContain("Approved 1 SKU(s)");
});
