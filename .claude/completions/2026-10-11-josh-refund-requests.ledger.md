# SDD ledger — plan: docs/superpowers/plans/2026-10-10-josh-refund-requests.md
Setup: josh worktree ~/Documents/dev/josh-worktrees/refund-requests branch feat/refund-requests from origin/main b05ef5de8; node_modules symlinked from ~/Documents/dev/josh.
Setup: Ruling: ledger kept manually here for josh tasks 1–12 (task-start/task-done scripts resolve the workspace from cwd's repo; running them in josh would write .superpowers into josh) — BASE taken with git -C josh — cost if wrong: none, bookkeeping only.
Pre-flight: T7→T11 RefundNotifier: T7 stub must export notifyById (plan stub said notify) — Ruling: stub exports notifyById(id) — matches T10/T11 consumers — cost if wrong: one rename.
Pre-flight: T7 loadOrderMoney(manager, orderId, charge, excludeRequestId?) interface fixed in plan; T9 consumes same — consistent.
Pre-flight: T9 admin detail → T14 RefundRequestDetail fields — T9 must return exactly those camelCase fields.
Pre-flight: T6 consumes T1 isRefundFlowEnabled; T10 consumes CronLockService + cron config — consistent.
Ruling: PAYMENT_PARTNER_NAME = KBank (user, 2026-10-10: "Payment Partner คือ Kbank"); th text uses ธนาคารกสิกรไทย — cost if wrong: copy change.
Task 1: Ruling: migration timestamp 1792490000000 (plan said 1792480000000 but origin/main now has 1792480000000-CommerceOutboxUserDevices) — cost if wrong: none.
Task 1: Ruling: migrations verified on a fresh scratch DB josh_refund_scratch (not the user's dev DB, which may have other pending migrations) — up/down/up OK.
Task 1: complete (commits b05ef5d..b75c745, tests: jest refund-flow.flag.spec → 1 passed; migration run/revert/run OK)
Task 2: complete (commits b75c745..2e408d0, tests: jest refund-amount + refund-methods helper specs → 18 passed)
Task 3: Ruling: env example is the root .env.example (apps/backend/.env.example does not exist); also documented REFUND_FLOW_ENABLED there — cost if wrong: none.
Task 3: complete (commits 2e408d0..d001737, tests: jest pii-cipher + refund-banks specs → 8 passed)
Task 4: Ruling: replaced symlinked node_modules with npm ci --ignore-scripts in the josh worktree (main checkout deps lack pdfkit) — cost if wrong: a postinstall-dependent test may misbehave; none seen.
Task 4: complete (commits d001737..eec822c, tests: jest app/payment/kbank + refund-requests + pii-cipher → 18 suites, 202 passed)
Task 5: Ruling: signature issueCreditNote(input, manager?) (plan: (manager, input)) — keeps the existing spec's cnRepo-only setup working and matches CreditBackService.issueForClaim(input, manager?) — Task 9 calls it as (input, manager) — cost if wrong: argument swap.
Task 5: complete (commits eec822c..6be63cc, tests: jest app/credit-note → 4 suites, 32 passed)
Task 6: note: paid_out case passed before the change (existing wasUsed already protects it) — kept as a regression pin, not a TDD driver.
Task 6: complete (commits 6be63cc..b473a54, tests: jest app/credit-back → 6 suites, 71 passed)
Task 7: Ruling: order timestamp is orders.create_date (plan used created_at) — orderTime reads create_date — cost if wrong: none.
Task 7: Ruling: RefundRequestsService does not inject RefundNotifier (no customer-side notification per Task 11 list) — cost if wrong: add one constructor arg.
Task 7: Ruling: deleted_at filter uses TypeORM IsNull() (plan's null as never would match nothing) — cost if wrong: none.
Task 7: complete (commits b473a54..eb57f2a, tests: jest app/refund-requests → 5 suites, 34 passed)
Task 8: Ruling: CreateReturnDto.items converts with plainToInstance inside @Transform (@Type is skipped when @Transform is present — the plan's version failed validation) — cost if wrong: none, test pins it.
Task 8: Ruling: module imports MediaStorageModule only; HybridAuthGuard/AdminOnlyGuard come from the @Global SecurityModule (plan said provide HybridAuthGuard) — cost if wrong: DI error at boot, caught by e2e boot.
Task 8: complete (commits eb57f2a..77ecd50, tests: jest app/refund-requests → 6 suites pass; tsc --noEmit clean)
Task 9: Ruling: admin routes use AdminOnlyGuard (ADMIN_ROLES admin/platform_admin/dev) instead of AdminWriteGuard — decision 9 (bank PII admin-only); the commerce relay signs a token with the staff user's real josh role — cost if wrong: finance staff without a josh admin role get 403 until given one.
Task 9: Ruling: approve re-checks availableMethods at approval and refuses a method no longer valid (not in plan) — stops paying to a card past its window — cost if wrong: admin must request changes.
Task 9: Ruling: re-approval after a failed card payout keeps the already-issued credit part (credit_note_id) and only pays the rest; switching that request to credit is refused — avoids a second CN — cost if wrong: admin asks customer for cash method.
Task 9: Ruling: weight-diff approve with a changed CB amount throws (no in-txn amount sync, which would roll back); the 5-min cron syncs — cost if wrong: admin retries after ≤5 min.
Task 9: note: admin DTO tests were written after the DTO code (TDD order slip); service/payout tests were RED first.
Task 9: complete (commits 77ecd50..035346f, tests: jest app/refund-requests → 8 suites, 61 passed; tsc clean)
Task 10: Ruling: cron SQL also validated against the scratch schema with psql (BEGIN/ROLLBACK) — beyond the plan's mock test — cost: none.
Task 10: complete (commits 035346f..175222c, tests: jest config/cron.config + app/refund-requests → 10 suites, 90 passed; tsc clean)
Task 11: note: admin-service notifyById calls were already wired in Task 9 (after commit for approve/reject/requestChanges/markTransferred/retry/resolve, incl. payout result).
Task 11: complete (commits 175222c..0b8f2c6, tests: jest app/notification + app/refund-requests → 27 suites, 233 passed; tsc clean)
Task 12: complete (commits 0b8f2c6..2b11b51, tests: jest erp/commerce-admin-relay.controller.spec → 10 passed)
Task 13: Ruling: AREAS entry restricted to methods GET/PATCH/POST (plan had no methods → DELETE passed) — josh's RELAY_ROUTES also refuses it — cost if wrong: none.
Task 13: Ruling: commerce worktree tests resolve node_modules from the parent main checkout (no install in the worktree) — cost if wrong: version drift in test deps.
Task 13: complete (commits 3280d7a..1d394dc, tests: jest josh-admin-call.controller.spec → 14 passed)
Task 14: Ruling: npm ci --ignore-scripts in the commerce worktree (the parent main checkout's node_modules lacks @tailwindcss/vite) — cost: none.
Task 14: Ruling: added TH/EN entries for all 44 new UI strings to libs/ui/src/locales/ui-messages.json (navigation.spec requires both languages; not in plan) — cost if wrong: copy edits.
Task 14: note: src/app/task-navigation.spec.ts 'does not grant inaccessible indexes' fails on the clean base too (verified by reverting this task's tracked changes) — pre-existing, not touched.
Task 14: complete (commits 1d394dc..1865d3d, tests: vitest src/app + src/josh-admin → 754 passed, 1 pre-existing failure (task-navigation); tsc commerce-admin clean)
Finish: josh full backend jest → 620/621 suites pass; only pii-leak.spec fails (boots AppModule; needs DB+Mongo; timed out without env) — rerun with scratch DBs in progress.
Finish: commerce-platform full jest → 257/258 suites pass; replica-readers.spec fails on files this branch never touched (commerce-previews, assignment-fixtures, financial-reader) — pre-existing.
Finish: Ruling: pii-leak.spec (boots AppModule) cannot run locally — local MongoDB rejects the driver handshake ('Missing required sub-document driver'); left to CI — cost if wrong: a PII leak on a new route would only show in CI.
Final review: fresh reviewer (opus) — 1 Critical, 4 Important, 9 Minor.
Final: fixed C1 KBank 5xx/408/429 treated as definite refusal (void→refund fallback, FAILED→retry double pay) — now UNKNOWN + 30s timeout on void/refund — payout spec 'REVIEW C1' x2 + client spec timeout RED→GREEN, josh suite 622/622 (pii-leak excluded, env)
Final: fixed I1 stuck processing+pending — resolve accepts pending >10 min, post-KBank save failure logged with KBank answer, approve/retry survive payout errors, admin UI shows resolve — admin spec 'REVIEW I1' x2, payout spec I1, page spec I1 RED→GREEN
Final: fixed I2 re-held Credit Back with a cancelled request never re-opened — cron re-opens it (fresh 7-day clock) and notifies — cron spec 'REVIEW I2' RED→GREEN
Final: fixed I3 reject after a Credit Note freed money/qty — reject refused when credit_note_id set; CN/CB of rejected/cancelled requests still counted — admin spec + refund-order-money spec 'REVIEW I3' RED→GREEN
Final: fixed I4 bookbank/evidence/slip temp files left in the publicly served ./uploads — controllers delete them in finally — refund-uploads spec RED→GREEN
Final: minor (deferred): M1 after a partial CN + failed card payout the customer is still offered 'credit', which approve refuses
Final: minor (deferred): M2 re-approval needing a new credit part would reuse CN-<refund number> (unique violation → 500)
Final: minor (deferred): M3 createReturn uploads evidence to S3 while holding the order row lock
Final: minor (deferred): M4 100 THB minimum checked on the total, not on the cash part after a split
Final: minor (deferred): M5 reject keeps bank_account_id (spec says clear bank details on reject)
Final: minor (deferred): M6 7-day credit default does not cover weight-diff requests in changes_requested
Final: minor (deferred): M7 KBank not configured is recorded as UNKNOWN instead of FAILED
Final: minor (deferred): M8 approve confirm dialog shows only the total, not the cash/credit split
Final: minor (deferred): M9 COD order with no charge row treats total_price as cash paid before collection
Final: suites after fix pass — josh 622 suites / 7177 tests pass (pii-leak excluded); commerce-admin 877 pass + 1 pre-existing task-navigation failure; commits josh 485fb17, commerce d3649cc
