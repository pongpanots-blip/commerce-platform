# Stage 4 G9: product-level promotion rules

Scope: product quantity tiers only. Mechanic/campaign/audience configuration, checkout, sold units and mechanic relay remain Josh-owned. `COMMERCE_OWNS_PROMOTIONS` is literal `true`, off by default. Josh's existing mechanic admin lock and signed relay remain in place.

Commerce migration: `1795300000000-ProductPromotionRules`. Josh migration and matching consumers must be deployed before cutover. No production cutover or push is performed by this implementation.

## Contract

- Commerce → Josh: `product.promotion-rules.snapshot`, payload `{ sku, rules, version }`; whole replacement, `[]` clears. `version` is a decimal bigint string from `product_promotion_rules_seq`, compared without converting to JavaScript Number. Publish and rule write use the same transaction. Subscribe Josh's `/api/internal/erp-events` to this type, with the existing signature secret.
- Josh → commerce signed `/api/internal/josh-events`: `promotion-rules.snapshot` with `{ sku, rules }`, and `promotion-lock.snapshot` with `{ sku, lock }`. `lock` is null or `{ mechanic_id, mechanic_name }`; any assigned SKU is locked, irrespective of active/date/audience. Envelope version uses Josh's existing `commerce_snapshot_seq`.
- Josh's rule snapshot is stored separately for parity. It bootstraps commerce while its flag is off, and cannot overwrite commerce rules while on. Lock assignment clears local undated tiers and emits a newer clear snapshot while owned. Lock removal never restores the old tiers.
- Staff routes: `GET/POST /api/product-promotion-rules/:sku`, POST body `{ rules }`; `GET /api/product-promotion-rules/parity`. Product create/update accept `promotion_rules` or legacy `tier_prices` and strip them before the Josh relay when owned. Both aliases together are rejected. Empty arrays are writes. Malformed arrays never silently clear.
- Admin reads overlay local product rules for unlocked SKUs and retain Josh mechanic display tiers for locked SKUs. Local lock metadata controls editing. An unbackfilled lock blocks writes.

## Backfill and shadow

1. Deploy both migrations and code with ownership flags off. Set Josh `JOSH_EVENTS_TO_COMMERCE_ENABLED=true`, event URL and signature secrets using existing signed-event configuration.
2. Staff `POST /api/reports/order-copy/backfill` with `{ "group": "catalog" }`, then groups `promotion-rules` and `promotion-lock`. These queue all products, including SKUs with zero rules and null locks.
3. Drain Josh outbox, then run `npm run promotion-parity` or GET the parity route. Require zero differences and missing snapshots. This uses commerce's local signed copies only, with no Josh database reads.
4. Repeat throughout shadow. Rule and mechanic changes must enqueue fresh snapshots, including removal of assignments. Inspect outbox failures/retry backlog on both sides.

## Cutover

1. Pause product rule AND mechanic assignment edits. Drain both outboxes and do a final backfill of both promotion groups; require zero parity differences and no missing lock versions.
2. Add `product.promotion-rules.snapshot` to Josh's commerce webhook subscription.
3. Set Josh `COMMERCE_OWNS_PROMOTIONS=true` first; restart. Rule edits through product create/update, bulk imports or signed actions must reject 403. Mechanic operations continue through the signed relay.
4. Set commerce `COMMERCE_OWNS_PROMOTIONS=true`; restart. Resume edits after smoke checks.
5. Smoke: edit an unlocked SKU, replace tiers, clear with `[]`, then assign a mechanic via the existing relay. Product tier edits must reject; remove mechanic and verify no old product tiers return. Verify storefront price cache refresh and duplicate/older deliveries do not revert the rules.
6. Drain, backfill promotion rules again, and require parity zero. Local parity is eventually consistent; it is not proof until delivery backlogs are empty.

## Rollback

Pause rule and mechanic edits; drain commerce snapshots while Josh's consumer flag remains on. Capture any failed deliveries and replay before proceeding. Turn commerce flag off first, then Josh flag off and restart both. Remove the subscription only after draining. Backfill both groups and verify local parity before reopening edits. Commerce retains versions/rows; signed Josh snapshots refresh the bootstrap while off. Re-enable using the same cutover sequence; never reset the commerce sequence or Josh applied-version ledger.

An async mechanic assignment may reach commerce after a product edit. Josh's consumer checks its current assignments and records the version while discarding undated tiers for assigned SKUs. The following signed lock snapshot clears commerce and emits a newer clear, preventing delayed deliveries from resurrecting tiers. Do not enable flags without this matching consumer.
