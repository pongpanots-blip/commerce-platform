import { beforeEach, expect, it, vi } from "vitest";
import {
  orderingApi,
  productContentsApi,
  productMastersApi,
  productPricesApi,
} from "../../../lib/api";
import {
  legacyOwnedValue,
  readLegacyOwnedSources,
} from "./legacy-owned-sources";
vi.mock("../../../lib/api", () => ({
  productPricesApi: { ownership: vi.fn() },
  productContentsApi: { get: vi.fn() },
  productMastersApi: { get: vi.fn() },
  orderingApi: { logistics: vi.fn() },
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(productPricesApi.ownership).mockResolvedValue({
    productContent: true,
    productMaster: true,
    ordering: true,
  });
  vi.mocked(productContentsApi.get).mockResolvedValue({
    sku: "S",
    fields: { buying_price: null, low_stock_threshold: 0 },
    updated_at: "2026-10-10T00:00:00Z",
  });
  vi.mocked(productMastersApi.get).mockResolvedValue({
    sku: "S",
    fields: { brand_name: "Native" },
  });
  vi.mocked(orderingApi.logistics).mockResolvedValue({
    sku: "S",
    fields: { unit_ratio: null },
  });
});
it("owned missing keys and explicit null do not inherit copied editing values", async () => {
  const source = await readLegacyOwnedSources("S");
  expect(legacyOwnedValue("buying_price", source, () => 100)).toBeNull();
  expect(legacyOwnedValue("low_stock_threshold", source, () => 100)).toBe(0);
  expect(
    legacyOwnedValue("selling_unit", source, () => "COPY"),
  ).toBeUndefined();
  expect(legacyOwnedValue("unit_ratio", source, () => "12")).toBeNull();
  expect(legacyOwnedValue("original_price", source, () => 100)).toBe(100);
});
it.each(["content", "master", "logistics"])(
  "%s non404 source failure propagates and cannot be treated as missing",
  async (source) => {
    const error = Object.assign(Error("Unavailable"), { status: 503 });
    if (source === "content")
      vi.mocked(productContentsApi.get).mockRejectedValue(error);
    if (source === "master")
      vi.mocked(productMastersApi.get).mockRejectedValue(error);
    if (source === "logistics")
      vi.mocked(orderingApi.logistics).mockRejectedValue(error);
    await expect(readLegacyOwnedSources("S")).rejects.toBe(error);
  },
);
it("a genuine missing row is explicit and can be retried without copied defaults", async () => {
  vi.mocked(productContentsApi.get).mockRejectedValueOnce(
    Object.assign(Error("No row"), { status: 404 }),
  );
  const missing = await readLegacyOwnedSources("S");
  expect(missing.missing).toEqual(["content"]);
  expect(legacyOwnedValue("buying_price", missing, () => 100)).toBeUndefined();
  expect((await readLegacyOwnedSources("S")).missing).toEqual([]);
});
it("ownership false preserves unrelated legacy sources and avoids native reads", async () => {
  vi.mocked(productPricesApi.ownership).mockResolvedValue({
    productContent: false,
    productMaster: false,
    ordering: false,
  });
  const source = await readLegacyOwnedSources("S");
  expect(source.fields).toBeNull();
  expect(legacyOwnedValue("buying_price", source, () => 100)).toBe(100);
  expect(productContentsApi.get).not.toHaveBeenCalled();
  expect(productMastersApi.get).not.toHaveBeenCalled();
  expect(orderingApi.logistics).not.toHaveBeenCalled();
});
it("wrong SKU, malformed fields or missing ownership flags block editing evidence", async () => {
  vi.mocked(productContentsApi.get).mockResolvedValueOnce({
    sku: "OTHER",
    fields: {},
  } as never);
  await expect(readLegacyOwnedSources("S")).rejects.toThrow("different SKU");
  vi.mocked(productMastersApi.get).mockResolvedValueOnce({
    sku: "S",
    fields: [],
  } as never);
  await expect(readLegacyOwnedSources("S")).rejects.toThrow();
  vi.mocked(productPricesApi.ownership).mockResolvedValueOnce({} as never);
  await expect(readLegacyOwnedSources("S")).rejects.toThrow();
});
