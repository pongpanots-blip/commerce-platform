// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUiLocale } from "@cp/ui";
import {
  joshProductApi,
  productContentsApi,
  productMastersApi,
  productPricesApi,
  orderingApi,
  joshActionsApi,
  type JoshProductDetail,
} from "../../../lib/api";
import { JoshProductDetail as Detail } from "../JoshProductDetail";
import { contentHomeUrl } from "./content-editor-routing";

vi.mock("../../../lib/api", () => ({
  joshProductApi: { detail: vi.fn(), categories: vi.fn() },
  productPricesApi: { ownership: vi.fn() },
  productContentsApi: { get: vi.fn() },
  productMastersApi: { get: vi.fn() },
  orderingApi: { logistics: vi.fn() },
  productImagesApi: { get: vi.fn(), set: vi.fn(), upload: vi.fn() },
  joshActionsApi: { updateProduct: vi.fn() },
  joshAdmin: { call: vi.fn(), upload: vi.fn() },
  session: { claims: () => ({ sub: "fixture-owner", role: "admin" }) },
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const productId = "00000000-0000-4000-8000-000000000001",
  sku = "SYNTHETIC/CONTENT-1";
const product = {
  product_inventory_id: productId,
  product_inventory_sku: sku,
  product_status: "active",
  updated_at: "2026-10-10T00:00:00.000Z",
  name_th: "Copied name",
  name_en: "Copied English name",
  description_th: "Copied description",
  description_en: "Copied English description",
  ingredients: "Copied ingredients",
  allergens: "Copied allergens",
  buying_price: 999,
  selling_unit_price: 321,
  original_price: 456,
  brand_name: "Copied brand",
  selling_unit: "Copied unit",
  pack_size: "Copied pack",
  storage_temperature: "Copied storage",
  unit_ratio: "Copied ratio",
  product_unit: "Copied product unit",
  sub_packing_unit: "Copied subunit",
  low_stock_threshold: 777,
  reorder_quantity: 888,
  pendingChanges: [],
  media: [],
  category_id: null,
} as unknown as JoshProductDetail;
let container: HTMLDivElement, root: Root;
const content = () => container.textContent ?? "";
const edit = () =>
  [...container.querySelectorAll("button")].find((node) =>
    node.textContent?.includes("Edit other product fields"),
  )!;
async function render() {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={["/reports/products/" + productId]}>
        <Routes>
          <Route path="/reports/products/:id" element={<Detail />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  setUiLocale("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(joshProductApi.detail).mockResolvedValue(structuredClone(product));
  vi.mocked(joshProductApi.categories).mockResolvedValue([]);
  vi.mocked(productPricesApi.ownership).mockResolvedValue({
    productContent: true,
    productMaster: true,
    ordering: true,
    productImages: false,
  } as never);
  vi.mocked(productContentsApi.get).mockResolvedValue({
    sku,
    fields: {},
  } as never);
  vi.mocked(productMastersApi.get).mockResolvedValue({
    sku,
    fields: {},
  } as never);
  vi.mocked(orderingApi.logistics).mockResolvedValue({
    sku,
    fields: {},
  } as never);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

it.each(["content", "master", "logistics"])(
  "blocks the old editor on failed native %s instead of copied defaults, and permits a successful retry",
  async (source) => {
    const api =
      source === "content"
        ? productContentsApi.get
        : source === "master"
          ? productMastersApi.get
          : orderingApi.logistics;
    vi.mocked(api).mockRejectedValueOnce(
      Object.assign(Error("Fixture native " + source + " failure"), {
        status: 503,
      }),
    );
    await render();
    expect(edit().disabled).toBe(true);
    expect(container.querySelector("form")).toBeNull();
    expect(content()).toContain("Fixture native " + source + " failure");
    expect(joshActionsApi.updateProduct).not.toHaveBeenCalled();
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((node) => node.textContent === "Try again")!
        .click(),
    );
    expect(edit().disabled).toBe(false);
    await act(async () => edit().click());
    expect(container.querySelector("form")).not.toBeNull();
    expect(
      [...container.querySelectorAll("input,textarea")].map(
        (node) => (node as HTMLInputElement).value,
      ),
    ).not.toContain("999");
  },
);
it("blocks edit on failed ownership without assuming any native source is unowned", async () => {
  vi.mocked(productPricesApi.ownership).mockRejectedValue(
    Error("Fixture ownership unavailable"),
  );
  await render();
  expect(edit().disabled).toBe(true);
  expect(container.querySelector("form")).toBeNull();
  expect(joshActionsApi.updateProduct).not.toHaveBeenCalled();
});
it("uses one canonical six-field task and preserves other legacy fields with native missing/null defaults", async () => {
  vi.mocked(productContentsApi.get).mockResolvedValue({
    sku,
    fields: { buying_price: null, low_stock_threshold: 0 },
  } as never);
  await render();
  await act(async () => edit().click());
  expect(
    container.querySelector('a[href="' + contentHomeUrl(productId) + '"]'),
  ).not.toBeNull();
  const values = [
    ...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "form input, form textarea",
    ),
  ].map((node) => node.value);
  expect(values).not.toContain("Copied name");
  expect(values).not.toContain("Copied English name");
  expect(values).not.toContain("Copied ingredients");
  expect(values).not.toContain("Copied allergens");
  expect(values).not.toContain("Copied brand");
  expect(values).not.toContain("Copied ratio");
  expect(values).not.toContain("999");
  expect(values).not.toContain("888");
  expect(values).toContain("0");
  expect(values).toContain("321"); // Existing independently scoped price editing remains available.
  expect(values).toContain("456");
});
it("treats genuine missing native rows as known unrecorded values, preserving unrelated legacy workflows", async () => {
  vi.mocked(productContentsApi.get).mockRejectedValue(
    Object.assign(Error("Missing"), { status: 404 }),
  );
  await render();
  expect(content()).toContain("Missing editing values are not filled");
  expect(edit().disabled).toBe(false);
  await act(async () => edit().click());
  const values = [
    ...container.querySelectorAll<HTMLInputElement>("form input"),
  ].map((node) => node.value);
  expect(values).not.toContain("999");
  expect(values).toContain("321");
});
it("retains Josh defaults for unrelated domains that remain unowned", async () => {
  vi.mocked(productPricesApi.ownership).mockResolvedValue({
    productContent: false,
    productMaster: false,
    ordering: false,
    productImages: false,
  } as never);
  await render();
  await act(async () => edit().click());
  const values = [
    ...container.querySelectorAll<HTMLInputElement>("form input"),
  ].map((node) => node.value);
  expect(values).toContain("Copied brand");
  expect(values).toContain("999");
  expect(values).toContain("321");
  expect(productContentsApi.get).not.toHaveBeenCalled();
  expect(productMastersApi.get).not.toHaveBeenCalled();
  expect(orderingApi.logistics).not.toHaveBeenCalled();
});
