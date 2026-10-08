# Full UI redesign with Thai and English

All **175 inventoried route surfaces** now use the shared Stitch-derived UI and bilingual controls, including existing detail, create and edit routes. **170 routes have fresh Stitch HTML/PNG exports**. **Five routes use documented shared or composed Stitch patterns**: four share existing page components; notification statistics combines the metric-card and notification-log patterns. These five do not have separate freshly generated prototypes. Stitch rejected their final fresh generation requests because its quota was exhausted.

Open the [design gallery](gallery.html) to search every route and filter by work area. Cards that reuse a design are explicitly marked. The [coverage report](coverage.json), [reuse decisions](reused-patterns.json), [route inventory](inventory.json) and [generation history](screens.json) distinguish implementation, design references and fresh exports.

| Work area / Stitch project | Route surfaces | Fresh exports | Shared patterns |
| --- | ---: | ---: | ---: |
| [ภาพรวม](https://stitch.withgoogle.com/projects/2119096700124056635) | 1 | 1 | 0 |
| [ตั้งค่าและทีมงาน](https://stitch.withgoogle.com/projects/6268281027426713533) | 6 | 6 | 0 |
| [รายงานและข้อมูล](https://stitch.withgoogle.com/projects/5251266173911652655) | 13 | 13 | 0 |
| [ระบบเชื่อมต่อ](https://stitch.withgoogle.com/projects/8704786612449063827) | 15 | 15 | 0 |
| [สินค้าและสต็อก](https://stitch.withgoogle.com/projects/9809859018179965476) | 23 | 23 | 0 |
| [ลูกค้าและบริการ](https://stitch.withgoogle.com/projects/18348214526789030153) | 27 | 27 | 0 |
| [การตลาด](https://stitch.withgoogle.com/projects/6122197874596130141) | 58 | 53 | 5 |
| [ออเดอร์และการเงิน](https://stitch.withgoogle.com/projects/11459856437863302160) | 26 | 26 | 0 |
| [Developer Portal](https://stitch.withgoogle.com/projects/4298724794282575393) | 6 | 6 | 0 |

## Usability changes in the apps

The Admin has seven task-based work areas with translated navigation, permitted-page search, keyboard shortcuts and a consistent shell. Portal keeps its own navigation and next-step actions. Existing role restrictions and all 114 original navigation destinations remain available.

Lists lead with records, then their existing filters and actions. Native product/customer/order creation and editing use named dialogs with keyboard containment, Escape and restored trigger focus. Long management forms use visible section navigation, associated labels and hints, and sticky Cancel/Save controls. Sortable headers are keyboard buttons with `aria-sort`; wide tables scroll inside their panels.

Order import presents the two required CSV files first and enables import when both are selected. Maintenance relinking stays in an expandable section with its existing confirmation. Stock tasks retain their quantity constraints, warehouse rules and request payloads. Integration secrets stay masked, and Portal exposes full keys only during the existing one-time handover.

Failed initial reads on product, segment, bot and workflow editors show a retryable error instead of an editable blank record or an endless loading indicator. Notification statistics hides totals after a failed read; order/shipment/payment cards show “—” when analytics is unavailable. Unknown backend diagnostics are available in closed error details.

## Thai / English

Thai is the default. Admin, Portal, authentication pages and native dialogs have a ไทย / English selector; the choice persists after reload. Changing language keeps form values, selected API enums, files and record identifiers. Dates, known statuses, option labels, help, validation and UI notices use the selected language.

**5,378 active source-copy keys have both translations**, with no missing catalogue keys. The runtime dictionary retains 5,519 entries, including earlier references. Stitch translation exports and [reviewed copy](curated-translations.json) are merged into the [UI dictionary](../../../../libs/ui/src/locales/ui-messages.json). The [source catalogue](ui-copy-catalogue.json) and [translation coverage](translation-coverage.json) make that coverage inspectable. All dictionary entries pass placeholder checks; English entries contain no untranslated Thai UI except the explicit language-selector label.

Names, descriptions, user-written campaign content, SKUs, IDs, URLs, source diagnostic details and API payloads retain their original values. The final English review retains Thai product/customer/warehouse names as record data. Backend/provider messages that are not known UI copy remain available as source diagnostics.

## Current application previews

These screenshots show the running React apps with isolated local seed data, independently of the generated prototypes:

- [Order import, English](implemented/import-en.png), [phone](implemented/import-phone.png)
- [Orders work area](implemented/orders-workspace-en.png)
- Product dialog: [Thai](implemented/product-dialog-th.png), [English](implemented/product-dialog-en.png)
- Portal documentation: [Thai](implemented/portal-docs-th.png), [English](implemented/portal-docs-en.png)
- [Coupon creation, English](implemented/coupon-create-en.png)

The five routes using shared patterns also have actual [Thai/English screenshots](implemented/), named by their route identifiers in [reused-patterns.json](reused-patterns.json).

## Verification

Both application type checks and production builds pass. Browser checks passed:

- **350 route/language visits** across all 175 routes in Thai and English.
- **178 follow-up visits** reviewing English copy, then **10 focused visits** in both languages after the last two copy fixes and workflow read-error guard.
- **162 navigation/CRUD visits**, including role restrictions, keyboard menu search, actual local product/customer creation and editing, order creation, filters and responsive layouts. Temporary CRUD fixtures were removed.
- **7 bilingual checks**, including authentication, persistent language, field and file preservation, unchanged record values, translated search and specialized coupon options.
- Phone checks on three lists and five Admin/Portal dialogs, including width, keyboard containment, Escape and trigger focus restoration.

The full route audit blocks operational API writes after authentication, including legacy segment preview writes. Its 39 unavailable backend/external endpoints are recorded in [validation.json](validation.json). Live Josh services are unconfigured, so these checks verify rendered loading/error states and local workflows, not live Josh operations. Stock mutations were not exercised because seeded warehouses are ERP-owned. Builds retain large-chunk warnings.

Repository runners: [workspace-redesign.mjs](../../../../apps/commerce-admin/e2e/workspace-redesign.mjs), [bilingual-ui.mjs](../../../../apps/commerce-admin/e2e/bilingual-ui.mjs), [full-ui-routes.mjs](../../../../apps/commerce-admin/e2e/full-ui-routes.mjs). They require an isolated local stack and generated mock credentials; credentials are never printed.

```bash
source /workspace/.commerce-cloud/env.sh
UI_AUDIT_ALL_ROUTES=1 bash /workspace/.commerce-cloud/ui-check.sh
```

The cloud helper selects the installed compatible Chromium binary. Alternatively, supply your own Playwright-compatible executable. `UI_AUDIT_LOCALES=en` runs the English follow-up; `UI_AUDIT_PATHS` can select comma-separated inventoried paths.

## Stitch generation status

The existing Environment API key successfully produced the fresh designs. Intermittent authentication rejections were recovered with fresh clients and read-only project checks; no new OAuth token is required for the completed work. The final blocker was an explicit quota rejection, not a missing local key.

When fresh prototypes for the five shared-pattern routes are desired after quota is available, inspect the saved failures and remote screens first. Lost generation responses may complete remotely. In this session `list_screens` returned empty results even for projects containing known screens, so an empty list does not prove that a lost response created no screen. Explicit rejected requests and timeout/connection failures are recorded separately. Do not blindly repeat ambiguous requests.

Existing API helpers without a route, such as `createOrderBatch`, are not counted as UI pages; the redesign does not add a new batch-order financial operation. Migration reports document literal copy, metadata, helpers, captions, dates, notices and render gaps; each generated prototype remains a design reference rather than a promise of live backend availability.
