// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUiLocale } from "@cp/ui";
import { api } from "../../../lib/api";
import { ProductEvidence } from "./ProductEvidence";
vi.mock("../../../lib/api", () => ({ api: { get: vi.fn() } }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, el: HTMLDivElement;
const response = (sku = "S") => ({
  sku,
  capturedAt: "2026-10-10T00:00:00Z",
  freshness: "unverified",
  prices: {
    source: "native",
    recordedAt: null,
    sellingUnitPrice: null,
    orderingPrice: "0.00",
    moq: 0,
    currency: null,
    taxBasis: null,
  },
  cost: {
    source: "native",
    recordedAt: null,
    amount: 0,
    currency: null,
    unit: null,
    taxBasis: null,
    observedAt: null,
  },
  units: {
    source: "native",
    recordedAt: null,
    selling: null,
    ordering: "BOX",
    packSize: null,
  },
  stock: {
    status: "unavailable",
    unit: null,
    observedAt: null,
    warehouses: [],
  },
});
beforeEach(() => {
  vi.resetAllMocks();
  setUiLocale("en");
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
});
afterEach(async () => {
  await act(async () => root.unmount());
  el.remove();
});
const render = async (sku = "S") =>
  act(async () => root.render(<ProductEvidence sku={sku} />));
it("shows zero cost and missing stock as unavailable without inferred currency or unit", async () => {
  vi.mocked(api.get).mockResolvedValue(response());
  await render();
  expect(el.textContent).toContain("Recorded cost0");
  expect(el.textContent).toContain("this does not mean zero");
  expect(el.textContent).toContain("source freshness is unverified");
  expect(el.textContent).not.toContain("THB");
});
it("keeps loading visible until the read, rejects a different SKU, and retries the same exact read", async () => {
  let resolve!: (v: unknown) => void;
  vi.mocked(api.get).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await render(" ไทย ");
  expect(el.querySelector('[aria-busy="true"]')).toBeTruthy();
  await act(async () => resolve(response("wrong")));
  expect(el.textContent).toContain("Evidence could not be loaded");
  vi.mocked(api.get).mockResolvedValue(response(" ไทย "));
  await act(async () => el.querySelector<HTMLButtonElement>("button")!.click());
  expect(api.get).toHaveBeenLastCalledWith(
    "/product-evidence/%20%E0%B9%84%E0%B8%97%E0%B8%A2%20",
  );
  expect(el.textContent).toContain("Recorded cost");
});
it("cannot label ambiguous identity as a zero warehouse balance", async () => {
  const r = response();
  r.stock.status = "ambiguous_identity";
  vi.mocked(api.get).mockResolvedValue(r);
  await render();
  expect(el.textContent).toContain("This SKU matches multiple products");
  expect(el.textContent).not.toContain("Quantity: 0");
});
