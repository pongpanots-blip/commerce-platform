# Stage 7 — cleanup: retire josh's read replica (`JOSH_DATABASE_URL`) and the cutover tools — Inventory + Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. Nothing here is invented. Every removal comes from an
> earlier stage that marked it D (drop/defer, "stage 7"). Each removal is gated on an ops fact (a cutover done or a
> shadow week passed), not on code being ready.

**Goal:** commerce runs without josh's database. Spec §1 says "no read replica, no bridge". After stage 7, commerce
gets josh's order / payment / customer facts **only** through events (§2.2), and the one-off import / parity tools that
moved each group are gone. The variable `JOSH_DATABASE_URL`, the `JoshReplica` connection, and the Postgres read-only user
are deleted.

**Spec:** `docs/superpowers/specs/2026-10-06-josh-to-commerce-ownership-move-design.md` §1 ("ไม่ทำ: read replica …
สะพานอ่าน DB ของ josh"), §4.1 (shadow ~1 week per group, then switch; rollback = flag off). The spec has no "stage 7"
section of its own. Stage 7 is the cleanup that S5's plan (§5 "Done when") and S6's STATUS hand off to:
*"Stage 7 removes `JoshReplica`, the env var, the readonly-user scripts and the parity CLIs."*

**Sources for every D below:**
- commerce-s5 `docs/superpowers/plans/2026-10-08-stage5-data-jobs.md` §1.2 (26 readers, Move column), §1.3, §1.5, §5
- commerce-s5 `docs/runbooks/stage5-reports-copies.md` ("ยังต้องใช้ replica", "ถอด replica (S5-16)")
- commerce-s5 / -s6 / -g5 / -g9 `STATUS.md`
- this branch: `docs/runbooks/prod-data-from-josh.md` (post-switch parity rule), stage 1–4e runbooks

## Global constraints

- **No production breakage.** On this branch (master `a1730cd` + this work), S4f/S4g/S5/S6 are **not merged**. So
  every report reader here still reads **only** the replica, and none has a `*_SOURCE=copies` switch. Deleting
  `JoshReplica` here would empty ~15 commerce-admin pages and MCP tools. Hard deletes wait for the merge plus the ops gates.
- No cutover is recorded as done on prod (no runbook / STATUS says a `COMMERCE_OWNS_*` flag is on). The parity CLIs are
  also used **after** each switch ("parity หลังสลับใช้ดูว่า josh รับ snapshot ครบ", `prod-data-from-josh.md`), and the
  imports are the documented **rollback** aid ("ยกเว้นตอน rollback"). They stay until the last group's shadow + switch
  + rollback window has closed.
- Don't touch josh (webjosh-*), and don't touch the sibling commerce worktrees.
- Stage 6: **nothing staff-related is removed** (S6 STATUS: "Stage 7 should not remove anything staff-related";
  `admin-access` relay, `josh_staff`, `josh_staff_access` stay).
- Out of scope (not replica): `JOSH_MONGO_URL` (josh's log Mongo — ERP inbound log, push deliveries; S5 §1.1
  "separate concern"), `JOSH_API_URL` / `JOSH_EVENTS_SECRET` (relay + events — permanent), the `josh_*` copy tables and
  `josh-events` receiver (permanent; they are how commerce gets josh's facts).

## 1. Inventory (this branch, 2026-10-07)

`JOSH_DATABASE_URL` is read directly in 7 code files: `josh-replica.ts` and 6 CLIs. 24 runtime files import `JoshReplica`.
The env var also appears in `.github/workflows/deploy-ecr.yml`, `docker/docker-compose.prod.yml` (`${JOSH_DATABASE_URL:-}`,
already optional), `.env.example`, and the two read-only-user scripts.

Merges will add: S5 → `integration/winback/winback-reports.ts` + `winback-reports.controller.ts` (the
`WINBACK_REPORTS_SOURCE=replica` path); G5 → `cli/ordering-parity.ts` (+ `import-from-josh -- ordering`). S6 and G9 add none.

Legend for **Class**: A = report reader (S5 gives it a `*_SOURCE` switch or a `joshOnly` text) · B = copier / cutover
checker at runtime · C = cutover CLI · W = ops wiring · K = keep (not stage 7). **S5 row** = row # in S5 plan §1.2.

### A. Report readers (runtime, on the replica only on this branch)

| File (under `modules/integration/`) | S5 row | After S5 merge | Stage-7 action | Gate |
|---|---|---|---|---|
| `connector/josh/bestsellers-offload.job.ts` | 1 | `BESTSELLERS_SOURCE` | delete `replica` + `shadow` paths | S5 runbook #3 = `copies` on prod |
| `connector/josh/restaurant-places.ts` | 2 | `RESTAURANTS_SOURCE` | delete replica path + `/parity` | #2 = `copies` |
| `connector/josh/josh-insights.ts` `sales()` | 3 | `SALES_SOURCE` | delete replica path + `/sales/parity` | #4 = `copies` |
| `josh-insights.ts` `traffic()` | 4 | `joshOnly` text | **owner q2**: aggregate copy or delete page | owner |
| `josh-insights.ts` `orderTargetgroup()` | 5 | `joshOnly` text | **owner q5**: default josh-admin → delete page | owner |
| `josh-insights.ts` `failures()` / `system-health.ts` | 6, 21 | ERP part on copies | delete replica branch (josh-only parts already point to josh-admin) | #6 |
| `connector/josh/josh-orders.ts` | 7 | `ORDERS_SOURCE` | delete replica path | #6 = `copies` |
| `connector/josh/josh-customers.ts` | 8 | deferred | **owner q1** (KYC/credit) | owner |
| `growth/growth-data.service.ts`, `growth.service.ts` | 9, 10 | `GROWTH_SOURCE` | delete replica path; carts / per-company enrollments stay "not copied" or owner adds a group | #5 = `copies` |
| `connector/josh/josh-backoffice.ts` | 11 | `joshOnly` text | D: stays josh-admin's job → delete page + MCP tool (`segments` view already redundant with `/j/segments`) | owner q3 + 2a cutover done |
| `connector/josh/josh-marketing-workflows.ts` | 12 | `MARKETING_WORKFLOWS_SOURCE` | delete replica path | #8 |
| `connector/josh/josh-push-campaigns.ts` | 13 | `PUSH_CAMPAIGNS_SOURCE` | delete replica path (Mongo deliveries stay, `JOSH_MONGO_URL`) | #7 |
| `connector/josh/josh-products.ts` | 14 | `PRODUCTS_SOURCE` | delete replica path | #9 |
| `connector/josh/josh-prices.ts` | 15 | after G9 | R* for base/customer/contract; branch/shop/quotations owner | G9 merged + owner |
| `connector/josh/josh-promotions.ts` (+controller) | 16 | D → G9 | G9 owns product quantity rules only; mechanics / campaigns stay in josh → page becomes josh-admin-only | G9 cutover |
| `connector/josh/winback/*` (+controller, `josh-tables.ts`) | 22 | `WINBACK_REPORTS_SOURCE` | delete dir except `pii.helper.ts` (used by josh-orders / -customers / -backoffice); drop `JOSH_WINBACK_TABLES` from `JoshReplica` | #1 = `copies` |
| `integration/winback/winback-reports.ts` (S5) | 22 | – | delete its `replica` branch | #1 |
| `mcp/mcp.tools.ts` | 20 | follows readers | delete `NO_REPLICA` + replica tools that became josh-admin-only | all rows above |

### B. Copiers and cutover checkers (runtime)

| File | S5 row | Default | Stage-7 action | Gate |
|---|---|---|---|---|
| `connector/josh/pricing/price-shadow.ts` (+controller, `josh-pricing-tables.ts`, `pricing.resolver.ts` copy) | 17 | cron off (`CRON_PRICE_SHADOW_ENABLED`) | delete; stored results page can go with it | 4a switched + shadow week passed |
| `connector/josh/pricing/staff-prices.ts` **import** (cron + `POST /staff-prices/import`) | 18 | cron off | delete import + replica SKU fallback (S5-10 reads the catalog copy first) | 4a switched; staff prices owned |
| `connector/josh/jagota/jagota-shadow.ts` (+controller) | 25 | cron off | delete | ERP-gateway cutover done |
| `connector/josh/jagota/jagota-sync-history.ts` import | 24 | cron off | delete import (`jagota_sync.snapshot` feeds the table since S5-11) | S5-11 backfill `jagota_sync` checked |
| `connector/josh/orders/josh-order-copy.ts` (+controller, `placed` endpoint) | 23 | cron off | delete copier + `POST …/placed` (events cover it) + `POST /reports/order-copy/run`; **keep** `POST /reports/order-copy/backfill` (asks josh over the API, not the replica) | `order.snapshot` trusted (S5 #3–6 green) |
| `connector/josh/josh-catalog-sync.service.ts` | 19 | **cron ON by default** (`cronEnabled`), runs only with the URL set | delete replica sync; `syncSku`/`syncId` keep the local-copy path (stage 1) | `catalog` backfill + events trusted |
| `integration/winback/winback-mirror.ts` | 26 | cron off | delete | `WINBACK_OWNER=commerce` on prod |

### C. Cutover CLIs

| CLI | Needs the URL | Stage-7 action | Gate |
|---|---|---|---|
| `import-from-josh` (scopes research … images; G5 adds `ordering`) | yes | delete + `package.json` script | **every** group switched and its rollback window closed (no more re-import) |
| `price-parity`, `content-parity`, `category-parity`, `master-parity`, `image-parity`, (G5) `ordering-parity` | yes | delete + scripts | same group switched + "post-switch parity" clean for one shadow week |
| `competitor-parity`, `segment-parity` | **no** (commerce DB / josh API) | not replica work. Can go with their stage's cleanup, not required for stage 7 | – |
| `create-staff` | no | **K** | – |

### W. Ops wiring

| Item | Stage-7 action | Note |
|---|---|---|
| GitHub secret + `deploy-ecr.yml` (header comment, env, `.env` writer loop) | remove `JOSH_DATABASE_URL` | writer loop skips empty vars already → deleting the secret is enough to unset it on the next deploy |
| `docker/docker-compose.prod.yml:32` | remove line | already `:-` (optional) |
| `apps/commerce-platform/.env.example` | remove block (S5 rewrote it; take S5's text at merge) | |
| `scripts/josh-db-readonly-users.sh` | **remove the Postgres half only** | it also creates the Mongo `commerce_ro` user for `JOSH_MONGO_URL` (out of scope) |
| `scripts/josh-postgres-readonly-user.mjs` | delete | Postgres only |
| josh side: `DROP ROLE commerce_ro` on josh Postgres, close 5432 in josh-db SG to commerce | ops on josh-db | after the code is gone everywhere |

### K. Keep (explicitly not stage 7)

`josh-events` receiver + `josh_*` copies · `order-copy/backfill` · relay / `JoshActions` (`JOSH_API_URL`) ·
`JOSH_MONGO_URL` readers (`josh-erp-logs.ts`, `api-log/*`, push deliveries) · everything staff (S6) ·
`competitor-parity` / `segment-parity` (no replica).

## 2. Tasks

### S7-0 — Inventory + plan — DONE
- [x] Read spec, S5 plan / runbook / STATUS, S6 / G5 / G9 STATUS, stage 1–4e runbooks
- [x] Inventory this branch + diff the replica users of the four sibling branches (S5 +2, G5 +1)
- [x] This plan

### S7-1 — Guard: no new replica readers (safe now, this branch) — DONE
- [x] `apps/commerce-platform/src/replica-readers.spec.ts`: every non-spec file that imports `JoshReplica` or reads
      `JOSH_DATABASE_URL` must be in an allowlist that carries its class (A/B/C/W) and its gate. A new file fails the
      test. Removed files pass, because the check is a subset check. The S5/G5 files that will arrive are listed in advance,
      so the merges don't break it.
- [x] Second assertion: only `josh-replica.ts` and the CLIs read `process.env.JOSH_DATABASE_URL` (runtime code goes
      through `JoshReplica.configured`).
- Why this is the only code change: everything else on the D list is gated (see §1). This test keeps the list from
  growing while S4f–S6 merge and the shadow weeks run.

### S7-2 — Runbook — DONE
- [x] `docs/runbooks/stage7-replica-removal.md`: preconditions per class, the order of the steps, how to verify, rollback.

### S7-3 — After S4f / S4g / S5 / S6 are merged into master (code; not before)
- [ ] Rebase this branch. Resolve `.env.example` with S5's text. Re-run the S7-1 spec. Update the allowlist if a merge
      moved a file.
- [ ] Re-run the inventory grep (runbook §0). It must match §1.

### S7-4 — Retire class B (code; per row, only after its gate)
- [ ] For each row whose gate is met on prod (ops confirms in writing): delete the file(s), its cron entry in
      `config/cron.config.ts`, the `CRON_*` vars in `.env.example`, the controller routes, any commerce-admin button
      (`/reports/price-shadow`, `/erp/jagota-shadow` Run/Recheck), and the allowlist row.
- [ ] `josh-catalog-sync.service.ts` first needs ops to set `CRON_JOSH_CATALOG_SYNC_ENABLED=false` on prod for one week.
      The default is ON, so don't flip the default in code before that.

### S7-5 — Retire class A replica branches (code; per switch, after it's `copies` on prod for a week)
- [ ] Per S5 runbook row 1–9: delete the `replica` (and `shadow`) branch and its `/parity` route, keep the `copies`
      code, make the switch a no-op (still read, logged as ignored) for one release, then delete the env var.
- [ ] Owner-decision rows (traffic, order target group, customers KYC, backoffice, branch prices, promotions
      mechanics): do nothing until the owner answers. The default per S5 §4 is "josh-admin only" → delete the commerce page
      and MCP tool rather than leave a permanent `joshOnly` text.

### S7-6 — Retire class C (code; after the last cutover)
- [ ] Delete `import-from-josh.ts`, the replica parity CLIs, and their `package.json` scripts. Update
      `prod-data-from-josh.md` to say the imports are gone, and that backfill (events) is the only way to repair data.
- [ ] Remove the `import` / `parity` steps from the stage 1–4g runbooks (mark them "historical").

### S7-7 — Delete `JoshReplica` + wiring (code + ops; last)
- [ ] When the S7-1 allowlist is down to `josh-replica.ts` + `josh.module.ts`: delete `JoshReplica`, `JOSH_PRICING_TABLES`,
      the module provider, `NO_REPLICA` texts, and `joshOnly` texts that mention the replica.
- [ ] W rows: deploy workflow, compose, `.env.example`, scripts (Postgres half).
- [ ] ops: delete the GitHub secret, deploy, then `DROP ROLE commerce_ro` on josh Postgres and close the port.
- [ ] Delete the S7-1 spec (nothing left to guard), or keep it as "no file may import a replica".

### S7-8 — Verify
- [ ] Staging, then prod: the URL is unset for one week. Every commerce-admin page and MCP tool answers (S5-16 checklist).
- [ ] `grep -rn "JOSH_DATABASE_URL\|JoshReplica" apps libs scripts docker .github` → only historical docs.

## 3. Open questions (owner / ops)

1. **Is `JOSH_DATABASE_URL` set on commerce prod today?** The stage 1 plan says "commerce has no `JOSH_DATABASE_URL`
   in prod". S5 assumes it is set (switches default to `replica`, parity needs it). The runbook asks ops to check first.
2. S5 §4 q1–q5 (KYC, traffic, backoffice, one global switch, order target group) decide class A's owner rows.
3. How long is the rollback window after the **last** group switches before the imports are deleted? Suggested: 2 weeks
   (2 shadow lengths). Not decided.

## As built (2026-10-07)

- S7-0, S7-1, S7-2 done on `feat/stage7-cleanup`. No runtime code changed. Nothing removed: no class B/C/W row has its
  gate met as far as the repo knows (no cutover recorded), and class A has no `copies` path on this branch until S5 is
  merged.
