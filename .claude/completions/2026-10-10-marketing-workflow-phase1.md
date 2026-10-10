# Marketing workflow phase 1 — commerce engine + drag-drop editor + Webhook + A/B split

Spec: `docs/superpowers/specs/2026-10-10-marketing-workflow-builder-design.md` · Plan: `docs/superpowers/plans/2026-10-10-marketing-workflow-phase1.md`

## Shipped
- **josh** `feat/commerce-marketing-receiver` (worktree `/Users/pongpanot_s/Documents/dev/josh-worktrees/commerce-marketing-receiver`), commit `225bbae1c`: `internal/erp-events` handles `marketing.notify` / `marketing.grant_coupon` (`CommerceMarketingEventsService`). Additive; two runner helpers made public.
- **commerce** `claude/marketing-workflow-0f1cc5`: module `modules/integration/marketing-workflow` (engine, triggers, sweep, webhook worker + SSRF guard + encrypted secrets, admin API `/api/marketing/flows`), migration `1796300000000`, josh-events trigger signals, admin editor `/marketing/flows/:id` (palette, canvas, forms, results, tester test-run), list page shows commerce + josh groups.

## Rollout (order matters)
1. Deploy josh (receiver). 2. Deploy commerce-platform (+ migration), set `MARKETING_WEBHOOK_SECRETS_KEY` (`openssl rand -base64 32`).
3. Only then: add the event types to the josh subscription — `SCRIPT_ARGS='add=marketing.notify,marketing.grant_coupon'` with `ops/scripts/josh-subscription.cjs`.
4. Deploy commerce-admin. 5. Test run with a tester before activating any workflow.

## Verified
- josh: `npx jest -c apps/backend/jest.config.cts apps/backend/src/app/marketing-workflow apps/backend/src/app/erp` → 850 passed; `tsc` 0; eslint 0.
- commerce-platform full jest: 2614 passed, 1 failed = `replica-readers.spec` (already failing on base `0b8f15e`, not this work); DB specs on a fresh migrated test DB; migration up/down/up; Nest boot OK.
- commerce-admin: vitest 662 passed; `tsc` 0.
- Browser (localhost, test DB): create → drop/click/`+` insert → A/B split → webhook (internal URL blocked) → secret stored encrypted, never in API/DB/logs → save/reload → tester test-run → `marketing.notify` in outbox, split logged, results list.

## Not verified yet
- Real delivery through josh (needs steps 1–3), real external webhook call, the email to pongpanot_s@jagota.co.th (staging).

## Known limits
- Frequency cap is per system until phase 3 (josh also applies its own cap to commerce notifies).
- No delivery feedback from josh in phase 1 (log shows `queued`).
- Scheduled runs scan every customer (`ponytail` note in `workflow-triggers.service.ts`).
- DNS-rebinding window between the SSRF check and fetch (`ponytail` note in `public-url.ts`).
