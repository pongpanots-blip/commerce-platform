import { expect, it } from "vitest";
import { navFor } from "../../navigation";
import { isRouteAllowed } from "../../../lib/landing";
import { COMPARISON_HOME } from "../../../../../commerce-platform/src/modules/integration/competitor-prices/comparison-contracts";

it("MER gets one canonical comparison entry and retains comparison deep links", () => {
  const links = navFor("merchandising").flatMap((group) =>
    group.links.map((link) => link.to),
  );
  expect(links.filter((link) => link === COMPARISON_HOME)).toHaveLength(1);
  for (const suffix of [
    "",
    "?sku=SYNTHETIC-SKU",
    "/overview",
    "/matching",
    "/products/SYNTHETIC-SKU/pairs/00000000-0000-4000-8000-000000000010/capture",
  ])
    expect(isRouteAllowed("merchandising", COMPARISON_HOME + suffix)).toBe(
      true,
    );
});

it("comparison readership does not give MER source configuration or planning access", () => {
  for (const path of [
    "/j/marketing/scraping-sources",
    "/j/marketing/scraped-catalog",
    "/planning/pack-prices",
    "/planning/pack-prices/new/product",
    "/planning/promotions/new",
  ])
    expect(isRouteAllowed("merchandising", path), path).toBe(false);
  for (const role of ["admin", "marketing", "business_analyst"])
    expect(isRouteAllowed(role, "/planning/pack-prices/new/product")).toBe(
      true,
    );
  for (const role of ["sale", "sales_manager", "cs", "graphic"])
    expect(isRouteAllowed(role, COMPARISON_HOME)).toBe(false);
});
