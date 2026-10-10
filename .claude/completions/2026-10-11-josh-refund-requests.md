# 2026-10-11 — Josh refund requests (credit / card / bank transfer)

**Plan:** `docs/superpowers/plans/2026-10-10-josh-refund-requests.md` · **Spec:** `docs/research/2026-10-10-josh-refund-flow-edge-cases.md`

## Branches (local, not pushed)
- josh `~/Documents/dev/josh-worktrees/refund-requests` — `feat/refund-requests` (13 commits on origin/main b05ef5de8)
- commerce-platform — `claude/refund-flow-options-a85046` (3 commits + docs)

## What shipped
- josh `app/refund-requests/`: return reports (photo evidence), weight-diff requests from held Credit Backs (cron, `REFUND_FLOW_ENABLED`), method choice (credit → Credit Note / Credit Back; KBank card void-if-whole else refund; bank transfer with encrypted account + bookbank + cash reason + policy v2026-10-v1 "KBank"), admin approve / reject / request-changes / transfer / retry / resolve, `refund_request_updated` notification, relay routes, `docs/refund-requests-api.md`.
- commerce: admin-call AREAS (admin only) + commerce-admin page `/j/refund-requests`.

## Before enabling
Migration `1792490000000-RefundRequests` → set `REFUND_PII_KEY` → deploy → KBank sandbox test → `REFUND_FLOW_ENABLED=true`.

## Known gaps
- `pii-leak.spec` not run locally (local MongoDB/driver mismatch) — CI must pass it.
- 9 deferred minors from the final review (see the final message / ledger copy below).
- Pre-existing failures not touched: commerce `replica-readers.spec`, commerce-admin `task-navigation.spec`.
