# Commerce table redesign — 9 October 2026

## Scope and result

The product catalog at `/j/allproducts` previously showed only the image/name portion of a wide table on a phone. Price, stock, status and actions required horizontal scrolling. It now shows complete product cards on phones, while desktop rows combine thumbnail, name, SKU and category. Search, status, counts, sorting, selection and pagination remain available in both layouts.

All application tables now use the shared table design: consistent headings and row spacing, selected-row feedback, a keyboard-accessible scroll region with a visible horizontal-scroll hint, and responsive pagination with a bounded page jump. Wide reports remain tables so their columns can be compared. Nested editor tables use the same scroll surface without introducing nested forms.

The source inventory finds **156 actual JSX table uses in 116 application files**, excluding comments and the shared renderers. All files map to routes: **118 admin route patterns and 4 portal pages**. Expanding `/josh/:view` into its 13 navigation destinations produces **130 admin URLs**. See [the complete file/route inventory](../table-page-inventory-2026-10-09.json).

Both table renderers were updated. Another **24 raw tables in 19 files** were migrated, including competitor review, product promotions/nutrition, bulk images, membership tiers, order/company detail, refunds, ERP/payment testing and workflow branches. Raw column headers now expose their scope to assistive technology.

## Behaviour checks

- Product search/status changes clear selections and return to page 1. Approving the last rows of the final page returns to an earlier page containing records.
- Price/stock sorting operates on the current page and says so. Phones have a sort selector; original order can be restored.
- Filtered bulk approval sends explicit visible IDs. Global draft approval is offered only without a search filter, states the total, and requires confirmation. The existing `all: true` API contract is retained.
- ERP rejection sends selected pending IDs after confirmation. The former global ERP rejection shortcut, which could affect records outside the displayed selection, is removed.
- Loading clears stale selectable rows and disables pagination. Catalog errors show retry. Brand save failures retain edited names; Supplier deletion failures retain the record.
- Graphic users retain catalog/image access and read-only brand access; forbidden product detail, approval and brand write actions are hidden.

## Validation and limits

| Check | Result |
| --- | --- |
| Actual source inventory and local import graph | 156 uses, 116 files; no unmapped files |
| All route layouts, TH/EN × desktop 1440 / phone 390 | **536 views; 0 layout issues, 0 page errors** |
| Populated embedded tables: product detail, product editor, competitor review | **12 additional views; 0 layout issues, 0 page errors** |
| Catalog/brand/Supplier workflows, TH/EN × desktop/phone, plus graphic at 320px | **54 checks passed** |
| Admin tests | **12 files, 171 tests passed** |
| Portal tests | **3 files, 34 tests passed** |
| Admin/portal TypeScript checks and production builds | Passed |

These browser checks serve local production builds with synthetic records. Every API/external request is intercepted; **no production requests or writes** occur. Fixtures populate catalog, brands, suppliers, platform products, prices/approval queues, backoffice records, portal lists and selected embedded tables. Other integrations deliberately return a simulated 503, so their loading/error layout is checked without claiming that their live backend or every conditional row/action has been exercised. The broad route pass includes 190 views with visible tables; source coverage supplies the check for conditional table branches not rendered by those fixtures.

Full metrics and fixture limitations are recorded in [route results](table-redesign-all-results.json), [workflow results](table-redesign-workflows-results.json), and [embedded results](table-redesign-embedded-results.json). Production deployment and asset verification are reported separately with their run links; the API and ownership/security flags are outside this UI change.

## Before and after

All images below show local builds and synthetic records.

| Surface | Before | After |
| --- | --- | --- |
| Catalog, Thai phone | [Before](screenshots/before-admin-th-phone-j-allproducts.png) | [After](screenshots/after-admin-th-phone-j-allproducts.png) |
| Catalog, English desktop | [Before](screenshots/before-admin-en-desktop-j-allproducts.png) | [After](screenshots/after-admin-en-desktop-j-allproducts.png) |

Additional views: [Brands, English phone](screenshots/after-admin-en-phone-j-brands.png), [Suppliers, English desktop](screenshots/after-admin-en-desktop-j-suppliers.png), [Product editor, Thai phone](screenshots/after-admin-th-phone-j-product-create.png), [Competitor review, Thai phone](screenshots/after-admin-th-phone-j-marketing-competitor-prices.png), [Portal keys, English phone](screenshots/after-portal-en-phone-keys.png).

## Reproduce

From the repository root, after building admin and portal:

```sh
node apps/commerce-admin/e2e/table-page-inventory.cjs
node apps/commerce-admin/e2e/table-redesign-review.mjs
TABLE_REVIEW_WORKFLOWS=true TABLE_REVIEW_WORKFLOWS_ONLY=true node apps/commerce-admin/e2e/table-redesign-review.mjs
TABLE_REVIEW_PATHS='/j/product/:id,/j/product/create,/j/marketing/competitor-prices' node apps/commerce-admin/e2e/table-redesign-review.mjs
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` sets the local browser binary. `TABLE_REVIEW_OUT`, `TABLE_REVIEW_BUILD` and `TABLE_REVIEW_PORTAL_BUILD` can override the artifact and build directories. Before comparisons require the previous build path and `TABLE_REVIEW_PHASE=before`.
