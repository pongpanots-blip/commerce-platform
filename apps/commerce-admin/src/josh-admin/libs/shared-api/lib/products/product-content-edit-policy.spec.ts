import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  authority: vi.fn(),
  write: vi.fn(),
  relay: vi.fn(),
  role: "merchandising",
}));
vi.mock("../api-client/api-client", () => ({
  apiClient: {},
  viaCommerceAction: mocks.write,
}));
vi.mock("../api-client/commerce-client", () => ({ ownership: mocks.relay }));
vi.mock("../../../../../lib/api", () => ({
  productImagesApi: {},
  productPricesApi: { ownership: mocks.authority },
  request: vi.fn(),
  session: { claims: () => ({ role: mocks.role }) },
}));
import { updateProduct } from "./product.api";

const id = "11111111-1111-4111-8111-111111111111";
const form = () => {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    product_inventory_sku: "SKU-1",
    product_name_th: "เก่า",
    product_name_en: "Old",
    product_description_th: "คำอธิบายเก่า",
    product_description_en: "Old copy",
    ingredients: "Copied ingredient",
    allergens: "Copied allergen",
    selling_unit_price: "10.00",
    product_status: "1",
    expiration_info: "12 months",
  }))
    data.append(key, value);
  return data;
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "merchandising";
  mocks.write.mockResolvedValue({});
});
describe("legacy product form content ownership at dispatch", () => {
  it("refuses delayed copy fields when commerce owns content before any partial save", async () => {
    mocks.authority.mockResolvedValue({ productContent: true });
    await expect(updateProduct(id, form())).rejects.toThrow(
      "No product change was sent",
    );
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("preserves the unique full-form fields when the native content task owns the six copy fields", async () => {
    mocks.authority.mockResolvedValue({ productContent: true });
    const data = new FormData();
    data.append("selling_unit_price", "10.00");
    data.append("product_status", "1");
    data.append("expiration_info", "12 months");
    await updateProduct(id, data);
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith(
      `/josh/products/${id}/update`,
      {
        fields: {
          selling_unit_price: "10.00",
          product_status: "1",
          expiration_info: "12 months",
        },
      },
    );
  });
  it("retains Josh-owned copy workflow and rechecks ownership on the next dispatch", async () => {
    mocks.authority
      .mockResolvedValueOnce({ productContent: false })
      .mockResolvedValueOnce({ productContent: true });
    await updateProduct(id, form());
    expect(mocks.write.mock.calls[0][1].fields).toMatchObject({
      product_name_en: "Old",
      ingredients: "Copied ingredient",
    });
    await expect(updateProduct(id, form())).rejects.toThrow(
      "No product change was sent",
    );
    expect(mocks.authority).toHaveBeenCalledTimes(2);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it.each([
    {},
    null,
    { productContent: "true" },
    { productContent: undefined },
  ])(
    "refuses unavailable or invalid authority before any write: %j",
    async (authority) => {
      mocks.authority.mockResolvedValue(authority);
      await expect(updateProduct(id, form())).rejects.toThrow(
        "ownership is unavailable",
      );
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );
  it("propagates an authority failure and permits a fresh explicit retry", async () => {
    mocks.authority
      .mockRejectedValueOnce(new Error("503 unavailable"))
      .mockResolvedValueOnce({ productContent: true });
    await expect(updateProduct(id, form())).rejects.toThrow("503 unavailable");
    expect(mocks.write).not.toHaveBeenCalled();
    const data = new FormData();
    data.append("expiration_info", "12 months");
    await updateProduct(id, data);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("retains existing graphic commercial-field restrictions in the legacy path", async () => {
    mocks.role = "graphic";
    mocks.authority.mockResolvedValue({ productContent: false });
    await updateProduct(id, form());
    expect(mocks.write.mock.calls[0][1].fields).toHaveProperty(
      "product_name_en",
      "Old",
    );
    expect(mocks.write.mock.calls[0][1].fields).not.toHaveProperty(
      "selling_unit_price",
    );
    expect(mocks.write.mock.calls[0][1].fields).not.toHaveProperty(
      "product_status",
    );
  });
});
