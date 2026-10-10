# Marketing event layer — ingest, device → user, event trigger, wait for event, event rules, guest journeys

Spec: `docs/superpowers/specs/2026-10-10-marketing-event-layer-design.md` · Plan: `docs/superpowers/plans/2026-10-10-marketing-event-layer.md`

## Shipped
- **commerce** branch `feat/marketing-event-layer`
  - New module `modules/integration/marketing-events`, covering:
    - catalog, public ingest `POST /api/events`, and a monthly-partitioned `marketing_events` table;
    - device links with consent / PDPA handling, event rules, dynamic segments;
    - nightly retention + rollup, and health.
  - Migration `1796400000000`.
  - marketing-workflow additions:
    - trigger `event`, steps `wait_event` / `event_split`, event goals;
    - guest enrollments + device push, and `{{event.*}}` / `{{device.*}}` variables.
  - josh-events now handles `device.snapshot`, consent withdrawal and the PDPA cleanup.
  - commerce-admin:
    - new pages `/marketing/events` and `/marketing/dynamic-segments`;
    - editor adds Event entry, Wait for event, Event condition, goals, audience rules, guest switch.
- **josh** branch `feat/commerce-event-layer` (worktree `/Users/pongpanot_s/Documents/dev/josh-worktrees/commerce-event-layer`)
  - `device.snapshot` outbox trigger + builder + backfill.
  - `marketing.notify` device target → OneSignal `include_subscription_ids`.
  - shop-web sends events to commerce (batched, `keepalive`) with the OneSignal subscription id.

## Verified
- **commerce-platform:**
  - full jest run: 2913 passed, 1 failed = `replica-readers.spec` (pre-existing);
  - DB specs on `commerce_mw_test_20261010` (Postgres 18): device links guest → A → B, compiled rule SQL, partitions + retention, store queries;
  - migration up / down / up;
  - `tsc` 0.
- **commerce-admin:** vitest 876 passed, 1 failed = `task-navigation.spec` (fails on base `navigation.ts` too); `tsc` 0.
- **josh:**
  - backend tests: commerce-events + marketing-workflow + erp + notification = 1026 passed;
  - shop-web lib + components 325 passed;
  - backend / shop-web `tsc` 0, eslint 0 errors;
  - `user_devices` trigger checked in a rolled-back transaction.
- **End-to-end on localhost** (commerce-platform on the test DB, Redis):
  1. josh `device.snapshot` linked the device.
  2. `test_claude_cart` (price 600) was accepted, and a resend came back `duplicate`. It enrolled once, waiting for `test_claude_buy`.
  3. A buy with a different `order_id` was ignored. The matching buy took the matched branch: `marketing.notify` reached the outbox.
  4. A second cart with no buy timed out after 1 minute and took the timeout branch.

## Not verified yet
- The admin pages in a browser (needs a staff login).
- Real delivery through josh: guest push to an actual OneSignal subscription, and staging.
- The mobile app (contract only).

## Known limits
- Rate limit per device is per process.
- Guest journeys need DPO sign-off before `includeGuests` is used for real.
- A device shared after logout counts as the last customer.
- Mobile sends nothing yet, so event rules count web events only.
- Consent withdrawal keeps device links. That customer's later events are stored as `no_consent` and never used.

## Rollout (order matters)
1. Deploy commerce-platform + migration `1796400000000` with `MARKETING_EVENTS_INGEST_ENABLED=false`.
2. Deploy josh (migration `1792480000000`, builder, notify device path). Then backfill: `POST /api/reports/order-copy/backfill {"group":"device"}`.
3. Set `MARKETING_EVENTS_INGEST_ENABLED=true`, add the shop domain to `COMMERCE_CORS_ORIGINS`, and deploy shop-web with `NEXT_PUBLIC_COMMERCE_EVENTS_URL`.
4. Deploy commerce-admin. Test with a tester before activating any event workflow. Use `includeGuests` only after DPO sign-off.
5. Give the mobile team `docs/event-contract.md` §7.
