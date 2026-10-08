# Commerce workspace UI

The Admin and Portal share a calmer visual system: neutral surfaces, blue actions, readable Thai text, locally hosted fonts, SVG icons, larger inputs, and consistent tables. Live Stitch authentication and eight new designs were verified on 2026-10-08. See [the category design project](stitch/task-ui-2026-10-08/README.md) for generation prompts, screen references, implemented previews and export access status. The original exports remain references for existing page patterns.

## Work by category

All 114 original navigation destinations are retained. The Admin groups them by what the person is doing, rather than by backend ownership:

| Category | Everyday workflow |
| --- | --- |
| สินค้าและสต็อก | Product information, prices, availability, supplier ordering |
| ออเดอร์และการเงิน | Orders, payments, shipments, invoices and refunds |
| ลูกค้าและบริการ | Customer accounts, companies, support and follow-up |
| การตลาด | Planning, campaigns, promotions, research and communication |
| รายงานและข้อมูล | Sales, products, orders, customers and system reports |
| ระบบเชื่อมต่อ | Connections, queues, inbound data and failed deliveries |
| ตั้งค่าและทีมงาน | Staff access and account settings |

Each category has an overview at `/workspaces/:workspaceId`, with frequent tasks, a short workflow guide and searchable task sections. Every permitted destination appears once in its task directory. `navigation.ts` is the source of truth for categorization; existing destination URLs and server permissions remain in place. The two staff-administration routes are still shown only to administrators. Price requests/offers belong to catalog work; the ERP webhook simulator belongs to connections.

## Shared interaction rules

- Keep lists visible first. Open creation forms from one primary action; use a named dialog with keyboard focus containment and Escape dismissal.
- After creating a product or customer, offer a direct link to the saved record. A newly created order opens its detail page.
- Product, customer and order list filters explicitly search the current loaded page. Keep the pager available when filters match nothing, and provide a clear action to reset the filters.
- Edit products/customers in named dialogs with Thai or English labels. Switching language keeps entered values and files. Display readable warehouse names when available. Inventory totals and customer order values identify their displayed scope; order values stay separate by currency.
- Stock tasks explain receive/count/adjust/transfer before entry. Preserve quantity constraints and API payloads, and exclude the selected source from transfer destinations. New integration/staff forms open from list headers; signing secrets are password-masked.
- Search pages and menus with Ctrl/⌘ K. Search only the permitted navigation, and say so in the interface; do not imply that this searches business records.
- Use customer/product names in order selectors. They load the first 100 available records; manual IDs remain available for records outside that set. Allow adding/removing lines and display a calculated line subtotal.
- Use real API data for counts and status. Category counts are menu counts. A missing health response must not be shown as a healthy system.
- Keep the Portal's next steps actionable: create an active key, subscribe an active webhook, then open webhook testing. Do not mark a revoked key or inactive subscription as ready.
- Filter the Portal's recent deliveries by their real status and refresh them from the API. Examples use the configured API URL and a valid storefront endpoint.
- Never offer copying a complete key when only its prefix is available. The complete new key remains visible only in the existing one-time creation banner.
- Stop loading indicators on request failure and display an error. The migrated invoice, credit, sample/price-request, active-offer, Smart Link and payment-test screens now catch their load failures; unavailable external data must not appear as a successful empty result.
- Use the shared UI primitives for native screens. Management pages use matching headers, controls, tables, task frames, long-form section navigation and sticky Cancel/Save actions. Failed initial reads on product, segment, bot and workflow editors block empty editable forms and provide retry actions. Business operations retain their existing payloads and constraints.

## Validation

From the repository root:

```bash
./node_modules/.bin/tsc -p apps/commerce-admin/tsconfig.app.json --noEmit
./node_modules/.bin/tsc -p apps/commerce-portal/tsconfig.app.json --noEmit
./node_modules/.bin/nx run-many -t build -p commerce-admin,commerce-portal --parallel=2
```

For an isolated local stack with PostgreSQL/Redis and mock fixtures:

```bash
npm run seed:mock
node apps/commerce-admin/e2e/workspace-redesign.mjs
```

The browser check visits the original destinations and category overviews, verifies complete task sections and role filtering, uses keyboard menu search, creates and edits real local product/customer fixtures and creates an order, exercises current-page filters and stock input constraints, tests integration/staff/Portal creation entry points, and checks phone/tablet layouts. It removes its own CRUD fixtures. Screenshots and a result summary are written under the ignored `.e2e-out/redesign/` directory. API failures from unavailable external integrations are recorded separately; a rendered error state does not verify the external integration.

The runner uses Playwright's installed Chromium by default. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can point to an existing compatible Chromium binary.

This cloud environment also keeps `bash /workspace/.commerce-cloud/ui-check.sh`, which activates Node 22 and uses the verified npm-distributed Chromium 153 binary outside the checkout. Reusable setup files are in `/workspace/.commerce-cloud`; this UI work does not publish an environment configuration.

Verified on 2026-10-08: both app type checks and builds passed. The browser runner completed 162 page visits with no JavaScript or page-overflow failures, including all 114 original destinations and real local CRUD. It recorded 35 external/backend endpoints returning 503; their live data and remote workflows remain unverified. Stock mutation was not exercised because the mock warehouses are ERP-owned. Builds retain large-chunk warnings.

The [full UI/bilingual report](stitch/full-ui-bilingual/README.md) adds all 175 route surfaces, including detail/create/edit views. It records 170 fresh Stitch designs and five shared-pattern decisions, 5,378 active translated copy keys, 350 route/language visits, a 178-visit English review, ten final focused visits in both languages, seven bilingual regression checks, and phone checks on three lists and five dialogs. The full route audit recorded 39 unavailable endpoints and blocked operational API writes after authentication. Unknown source diagnostics remain in closed error details; record names and written business content retain their original language.

Fonts: Noto Sans Thai Variable from `@fontsource-variable/noto-sans-thai` 5.3.0, with its SIL Open Font License retained in `libs/ui/fonts/LICENSE.txt`.
