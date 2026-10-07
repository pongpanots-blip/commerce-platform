# STATUS — Stage 4f (G5) ordering / logistics → commerce

Branch `feat/stage4-g5-ordering-logistics` (from master `a1730cd`, after 4e). Not pushed.
Plan: `docs/superpowers/plans/2026-10-08-stage4f-ordering-logistics.md` · Runbook: `docs/runbooks/stage4f-ordering-logistics-cutover.md`

## Scope decided (from exploring josh `feat/commerce-owns-images`)

| Moves to commerce (4f) | Stays in josh |
|---|---|
| ERP supplier order rounds `supplier_order_period` (`PUT /erp/order-periods`) | `sku_order_period`, `delivery_calendar` (josh's caches of the Jagota Node API) |
| SKU logistics: `unit_ratio`, `sub_packing_unit`, `product_unit`, `expected_restock_at`, `delivery_dates` | `order_taking_dates` (dead column, computed at read time); `tier_prices` (deprecated → promotions) |

Already moved earlier: `order_taking_flag` / season / `sup_code` / units (4d), MOQ / `ordering_price` (4a).

## Done (commerce)

- Switch `COMMERCE_OWNS_ORDERING` (default off); `GET /api/ownership` → `ordering`.
- Migration `1795150000000-OrderingLogistics`: `supplier_order_periods`, `product_logistics`.
- `modules/commerce/ordering`:
  - port of josh's `upsertFromErp` mapping;
  - `OrderingService`: `fromErp`, `periods`, `republish`, `getLogistics`, `editLogistics`;
  - events `supplier.order_periods.snapshot` (all rounds of one supplier) and `product.logistics.snapshot`.
- When owned, ERP relay of order periods and the fallback replay of `/order-periods` update commerce's rounds in the same transaction.
- Routes `GET /api/order-periods`, `POST /api/order-periods/:supCode/republish`, `GET /api/product-logistics/:sku`.
- The product form (`JoshActionsController.updateProduct` + `JoshProductDetail`) has the five fields. When owned they are saved in commerce; delivery weekdays can only be edited when owned.
- commerce-admin page "รอบสั่งซื้อ supplier" (`/order-periods`).
- `npm run import-from-josh -- ordering` and `npm run ordering-parity`.
- Docs: event contract, `.env.example`, cutover runbook, prod-data list, plan "As built".

## Remaining

1. **josh repo (not touched here): Task 1 in the plan.**
   - Flag.
   - Guards: ERP order-period push and poll cron; form, relay and sheet import for the five keys; Jagota sync putting back `unit_ratio`.
   - `CommerceOrderingService.applyOrderPeriods` / `applyLogistics` and the two handlers.
   - **Do not turn the commerce flag on before josh has these.**
2. **Pre-existing josh gap.** commerce relays `erp.order_periods.pushed`, but josh's receiver has no handler for it. Decide in the josh PR: add a handler, or keep the event off the subscription.
3. Run the opt-in DB spec and an end-to-end check on scratch DBs (no Postgres was available in this session):
   - `ORDERING_TEST_DATABASE_URL=… npx jest -c apps/commerce-platform/jest.config.cts --runInBand ordering.service.db`
   - import → parity → ERP push → josh apply → parity.
4. Browser check of the new page and the form fields.
5. Merge conflicts to expect with the parallel promotions branch (g9): `ownership.controller(.spec).ts`, `import-from-josh.ts`, `package.json`, `.env.example`, `event-contract.md`, `app.tsx`, `api.ts`.

## How to verify

```bash
npx tsc -p apps/commerce-platform/tsconfig.app.json --noEmit
npx tsc -p apps/commerce-platform/tsconfig.spec.json --noEmit
npx tsc -p apps/commerce-admin/tsconfig.app.json --noEmit
npx jest -c apps/commerce-platform/jest.config.cts --runInBand ordering josh-actions erp-relay ownership
npx jest -c apps/commerce-platform/jest.config.cts --maxWorkers=2   # this session: 1307 passed, 35 opt-in skipped
```
