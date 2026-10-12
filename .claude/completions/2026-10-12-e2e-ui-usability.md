# 2026-10-12 — E2E UI usability round + fixes (commerce-admin)

Local stack (master fdb8539), admin :4403 + API :3100, staff `e2e-ux@example.com` (admin).
Swept 51 native routes + hands-on: products, product edit, orders, customers, ⌘K, reports, mobile 375px.
`/j/*` pages and replica-backed reports not testable locally (no josh backend / JOSH_DATABASE_URL / JOSH_MONGO_URL → 503).

## Fixed
- Blank product name/SKU and customer name: DTOs now `@Matches(/\S/)` (400), detail editors check
  required fields before the confirm (`missingRequired` in catalog-fields.ts).
- Reports no longer show "เลือกวันที่ให้ครบ" under a load error (ShopReports.tsx).
- Server-side search: `ListQueryDto.search` → `BaseCrudService.list()` (newest first, `searchFields`)
  → `TypeOrmBaseRepository` ORs `ILike` per field (wildcards escaped). Products: sku/name; customers:
  name/code/email/phone. Admin `ListSearch` (debounced, kept in `?q=`) replaces the current-page filter.
- Orders: `OrderService.listForAdmin` — customer name/code joined, search on order code/id/customer,
  `status` filter, newest first; list shows customer column and `#xxxxxxxx` when no order number.
- ⌘K: labels match in TH and EN (`uiTextAllLocales`), plus "ค้นหาสินค้า/ออเดอร์/ลูกค้า “X”" shortcuts → `/…?q=X`
  (only for lists the role may open). Sidebar filter matches EN too.
- 503 load errors say the data is not available on this server (retrying won't help) with the reason inline.
- Home: removed the 4 always-empty KPI cards; Thai labels for webhook/outbox/sync/dead-letter copy;
  sync job "started" shows date + time.
- Product detail: selling price / ordering price / MOQ for admin+merchandising; warehouse code not repeated.
- RowLink: 44px tap height below md.

## Not changed
- Sidebar → section hub → page: the hub step is the admin redesign's deliberate IA (task-navigation.spec).

## Pre-existing failures on master (not from this work)
- commerce-admin `task-navigation.spec.ts:34` (merchandising may now open /j/marketing/competitor-prices).
- commerce-platform `replica-readers.spec.ts` (commerce-previews, assignment-fixtures, financial-reader not listed).
