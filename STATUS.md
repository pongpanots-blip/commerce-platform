# Stage 4 G9

Scope approved: commerce owns product-level promotion quantity rules only. Existing mechanic relay remains; mechanic/campaign/audience config, checkout and sold-unit accounting stay in Josh. No push or production cutover.

## commerce-g9 — feat/stage4-g9-promotions

Implemented per-SKU rules, strict validation, explicit replacement/empty clear, guarded staff endpoints, product form routing and ownership discovery. Writes and `product.promotion-rules.snapshot` are transactional; bigint versions serialize concurrent changes. Signed Josh rules/lock snapshots provide bootstrap/shadow data, stale-delivery guards and mechanic locks. Assigned SKUs clear undated tiers and emit a newer clear; release cannot resurrect tiers. Admin reads local unlocked rules and locks. Backfill requests and parity use events/local copies, without runtime Josh DB reads for this feature.

Validation: platform and admin TypeScript checks pass. Six focused Jest suites pass (49 tests), including scratch PostgreSQL concurrency, clear, assignment/removal, stale delivery and rollback using the real EventEmitterBus/outbox. `git diff --check` passes. Flags remain off.

Plan: [G9](docs/superpowers/plans/2026-10-08-stage4g-promotions.md). Runbook/contracts: [cutover](docs/runbooks/stage4g-promotions-cutover.md), [events](docs/event-contract.md). Commerce migration: `1795300000000-ProductPromotionRules`.

## webjosh-g9 — feat/commerce-owns-promotions

Next: implement matching strict product-rule guards, newest-only signed consumer with assignment protection/cache invalidation, durable shadow/lock producers and both backfill groups. Verify and commit on this branch, then update this status. Commerce flag must remain off until those changes and cutover prerequisites are deployed.
