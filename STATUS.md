# Stage 4 G9

Scope approved: commerce owns product-level promotion quantity rules only. Existing mechanic relay remains; mechanic/campaign/audience config, checkout and sold-unit accounting stay in Josh. No push or production cutover.

## commerce-g9 — feat/stage4-g9-promotions

Complete. Existing implementation commit: `0cf2901`. Per-SKU rules have strict validation, explicit replacement/empty clear, guarded staff endpoints, product form routing and ownership discovery. Writes and `product.promotion-rules.snapshot` are transactional; bigint versions serialize concurrent changes. Signed Josh rules/lock snapshots provide bootstrap/shadow data, stale-delivery guards and mechanic locks. Admin reads local unlocked rules and locks. Backfill requests and parity use events/local copies.

Follow-up polish adds strict decimal bigint/SKU checks and retained `rules_reset_version` assignment markers. Even a latest-state unlock snapshot clears discarded tiers if the assigned snapshot was never delivered. Every owned write/clear carries the observed marker; older shadow rules cannot re-bootstrap tiers after assignment/removal. Clear and reset-marker writes roll back with outbox failures.

Validation: platform and admin TypeScript checks pass. Eight focused Jest suites pass (65 tests), including scratch PostgreSQL concurrency, clear, assignment/removal/coalescing, stale delivery and rollback using the real EventEmitterBus/outbox. `git diff --check` passes.

Plan: [G9](docs/superpowers/plans/2026-10-08-stage4g-promotions.md). Runbook/contracts: [cutover](docs/runbooks/stage4g-promotions-cutover.md), [events](docs/event-contract.md). Commerce migrations: `1795300000000-ProductPromotionRules`, `1795310000000-PromotionRuleAssignmentResets`.

## webjosh-g9 — feat/commerce-owns-promotions

Complete and committed locally as `b0ba9b20` (`feat(g9): guard and consume commerce-owned product promotion rules`). Follows existing `COMMERCE_OWNS_*` flags and the signed ERP-event consumer. Product create/update and direct rule services reject both aliases with 403 while owned, including signed actions and relays. The consumer validates whole replacements, applies only newer bigint versions transactionally, suppresses tiers for any assignment or an older observed reset marker, records suppressed versions and refreshes price/response caches after commit.

Migration `1792360000000-CommercePromotionRules` adds the version ledger, retained assignment resets and durable rule/lock producers. Assignment/rule writes and snapshot building serialize on the product row. Assignment clears undated/legacy tiers; bootstrap cannot restore applied clears or tiers discarded by assignments. Signed snapshots/backfill include empty/unassigned/new SKUs, assignment moves/cascade removal and mechanic renames. Rapid assign/remove keeps its reset marker even when lock events coalesce, so a previously unseen pending edit cannot resurrect tiers after release. Sold-unit writes do not enqueue these snapshots. Existing mechanic relay remains available; product sheet imports do not write promotion rules.

Validation: backend TypeScript check passes. Twelve focused/regression Jest suites pass (267 tests), including real PostgreSQL replacement/clear, bigint concurrency, assignment/consumer races in both orders, coalesced unlocks, bootstrap protection, transactional outbox/reset rollback, and migration up/down with existing assignments. Signed delivery, backfill, consumers, ownership guards, product pricing and mechanic relay/service regressions pass. `git diff --check` passes.

## Remaining operational work

Development and local verification are complete in both repositories. Both branches are committed with identity `pongpanots-blip`; nothing was pushed. Ownership flags remain off. Production migrations/deployment, subscriptions, drained outboxes, final backfill/parity and cutover smoke checks remain prerequisites in the runbook; no production cutover was performed.
