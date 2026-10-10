// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUiLocale } from "@cp/ui";
import { getProductById, updateProduct } from "@josh/shared-api";
import { productPricesApi } from "../../../../lib/api";
import EditProduct from "./EditProduct";

vi.mock("@josh/shared-api", () => ({
  getBrands: vi.fn(async () => ({ data: { data: [] } })),
  getCuisineCatalog: vi.fn(async () => []),
  getProductById: vi.fn(),
  getProductCuisines: vi.fn(async () => []),
  getProductPromotionLock: vi.fn(async () => null),
  getBulkUploadLogs: vi.fn(async () => ({ data: { data: { items: [] } } })),
  updateProduct: vi.fn(async () => ({ data: { statusCode: 200 } })),
  setProductCuisines: vi.fn(async () => undefined),
  deleteBulkUploadReplacedImage: vi.fn(),
  restoreBulkUploadReplacedImage: vi.fn(),
}));
vi.mock("../../../../lib/api", () => ({
  productPricesApi: { ownership: vi.fn() },
  session: { claims: () => ({ role: "merchandising" }) },
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const id = "00000000-0000-4000-8000-000000000001";
const copy = {
  product_inventory_sku: "SKU-1",
  product_status: "1",
  base_selling_price: 10,
  translations: [
    {
      language_code: "th",
      product_name: "Copied Thai name",
      product_description: "Copied Thai description",
    },
    {
      language_code: "en",
      product_name: "Copied English name",
      product_description: "Copied English description",
    },
  ],
  ingredients: "Copied ingredients",
  allergens: "Copied allergens",
  expiration_info: "12 months",
};
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  setUiLocale("en");
  vi.mocked(productPricesApi.ownership).mockResolvedValue({
    productContent: true,
  });
  vi.mocked(getProductById).mockResolvedValue({ data: copy } as never);
  vi.spyOn(window, "alert").mockImplementation(() => undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={["/j/product/edit/" + id]}>
        <Routes>
          <Route path="/j/product/edit/:id" element={<EditProduct />} />
          <Route path="/j/product/:id" element={<div>Product details</div>} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}
const values = () =>
  [
    ...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input,textarea",
    ),
  ].map((node) => node.value);
async function save() {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(".sticky button:last-child")!
      .click(),
  );
}
it("native ownership provides one content task link and never submits the six copied fields with other full-form changes", async () => {
  await render();
  expect(
    container.querySelectorAll(`a[href="/j/product/${id}/content"]`),
  ).toHaveLength(1);
  for (const text of [
    "Copied Thai name",
    "Copied English name",
    "Copied Thai description",
    "Copied English description",
    "Copied ingredients",
    "Copied allergens",
  ])
    expect(values()).not.toContain(text);
  await save();
  expect(updateProduct).toHaveBeenCalledTimes(1);
  const payload = vi.mocked(updateProduct).mock.calls[0][1] as FormData;
  for (const field of [
    "product_name_th",
    "product_name_en",
    "product_description_th",
    "product_description_en",
    "ingredients",
    "allergens",
  ])
    expect(payload.has(field)).toBe(false);
  expect(payload.get("selling_unit_price")).toBe("10");
  expect(payload.get("expiration_info")).toBe("12 months");
});
it("retains all six existing full-form content fields when Josh owns them", async () => {
  vi.mocked(productPricesApi.ownership).mockResolvedValue({
    productContent: false,
  });
  await render();
  expect(values()).toContain("Copied English name");
  expect(values()).toContain("Copied ingredients");
  await save();
  const payload = vi.mocked(updateProduct).mock.calls[0][1] as FormData;
  expect(payload.get("product_name_en")).toBe("Copied English name");
  expect(payload.get("ingredients")).toBe("Copied ingredients");
});
it("a failed authority read exposes retry and cannot expose an editable copied form", async () => {
  vi.mocked(productPricesApi.ownership).mockRejectedValueOnce(
    Error("Ownership unavailable"),
  );
  await render();
  expect(container.textContent).toContain("Ownership unavailable");
  expect(values()).toEqual([]);
  expect(updateProduct).not.toHaveBeenCalled();
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(
    container.querySelector(`a[href="/j/product/${id}/content"]`),
  ).not.toBeNull();
  expect(values()).not.toContain("Copied English name");
  expect(updateProduct).not.toHaveBeenCalled();
});
