# Stage 4 G9 — promotion rules owned by commerce

Spec: `docs/superpowers/specs/2026-10-06-josh-to-commerce-ownership-move-design.md` §2.4 (`POST promotion-rules`) and §4.2. Patterns: stage4a–e storage, ownership discovery and transactional snapshots.

Scope: product-level quantity promotion rules (including empty-array clear), admin product form, and mechanic ownership locks. Existing mechanic/campaign/product-set/page editors use their existing Josh services; checkout and sold-unit accounting remain Josh-owned. After commerce verification, implement matching Webjosh guards/consumers on feat/commerce-owns-promotions; commit both, do not push. Full mechanic configuration migration is a separate scope decision.

- [x] Search existing promotion code and read design/sibling plans.
- [x] Add commerce rule storage, validation, guarded staff APIs and transactional `product.promotion-rules.snapshot`.
- [x] Add signed inbound `promotion-rules.snapshot` for backfill/shadow and `promotion-lock.snapshot` for mechanic assignment locks; reject stale versions and prevent inbound rules overwriting owned rules.
- [x] Route product create/update rules into commerce when owned; use local admin reads for rules and locks.
- [x] Add event-driven backfill request and local parity report (no runtime Josh DB reads).
- [x] Add focused unit/database tests for validation, flag-off, locks, replacement/clear, concurrency, stale delivery and atomic outbox writes.
- [x] Document contract, environment and cutover/rollback with matching Josh guards/consumers and cutover prerequisites.
- [x] Run checks, write STATUS.md and commit implementation/verification. Do not push.

## Matching Josh implementation (next, before cutover)

Josh must implement signed backfill/shadow snapshots, per-SKU lock updates, newest-only snapshot application and cache invalidation. Audit `POST promotion-rules`, product create/update (including signed actions), `tier_prices`, mechanic edits and bulk imports under `COMMERCE_OWNS_PROMOTIONS`. ERP endpoints remain available. Flags remain off until consumers and parity verification are ready.
