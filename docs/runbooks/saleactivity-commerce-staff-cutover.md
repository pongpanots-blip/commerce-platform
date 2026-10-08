# saleactivity → commerce staff sign-in (`STAFF_AUTH=commerce`) — cutover runbook

Status: **prepared, not executed.** Nothing here has been switched in prod. Every step below is an operator action that needs the
user's OK for the switch time.

## Pieces

| Piece | Where | What it does |
|---|---|---|
| App switch | saleactivity `config/prod.json` (`STAFF_AUTH`, `COMMERCE_API_BASE_URL`) | compile-time; `josh` today. In `commerce` mode the app signs in at commerce and sends the commerce token to commerce only |
| Same-origin proxy | Webjosh nginx, gate `COMMERCE_STAFF_PROXY=true` | `https://joshapp.io/api/commerce/…` → commerce **private IP** (origin of the existing `COMMERCE_PLATFORM_BASE_URL`, `http://172.31.40.66:3100`). Allowlist only: `POST admin/auth/{login,refresh,logout,password}` and `winback/*`; everything else under `/api/commerce/` is 404 |
| Commerce read endpoints | commerce `GET /api/winback/restaurant-place[/:id]` | Market Explorer browse for sale / sales_manager / admin (was josh-only) |
| Backfill | `npm run winback-staff-backfill` (CLI already on master) + `ops/scripts/winback-staff-backfill-dry.cjs` (this PR) | links Josh rep ids to commerce accounts and rewrites stored ids |

**No CORS change.** The saleactivity web build is served at `https://joshapp.io/sale` and now calls `https://joshapp.io/api/commerce/…`
(same origin); native apps are not subject to CORS. `COMMERCE_CORS_ORIGINS` stays as it is, and commerce's public host is not used by the app.

## Env changes

| Where | Change | When |
|---|---|---|
| josh web EC2 host `.env` (nginx) | add `COMMERCE_STAFF_PROXY=true` (reuses `COMMERCE_PLATFORM_BASE_URL`, unchanged) | step 3 |
| josh `prod.yml` | none (`WINBACK_VIA_COMMERCE=true`, `WINBACK_OWNED_BY_COMMERCE=true` are already pinned) | — |
| commerce | none required. Keep `WINBACK_ACCEPT_JOSH_JWT` on (default) so installs still on `STAFF_AUTH=josh` keep working. Confirm `WINBACK_OWNER=commerce` and `COMMERCE_OWNS_SALES_REPS=true` (needed by backfill `--apply`) and that `RESTAURANTS_SOURCE=copies` or the replica is configured (else restaurant-place answers 503) with ops-platform `status` | before step 4 |
| commerce `COMMERCE_CORS_ORIGINS` | **no change** | — |
| saleactivity `config/prod.json` | `STAFF_AUTH: "commerce"` (`COMMERCE_API_BASE_URL` is already `https://joshapp.io/api/commerce` after the app PR) | step 6 |

## Deploy order

1. **Commerce** — merge + deploy the restaurant-place endpoint PR (additive, no migration). Smoke: `GET /api/winback/restaurant-place?limit=1`
   with a sale token → 200; with a cs token → 403.
2. **Webjosh nginx** — the change is prepared on Webjosh branch `feat/commerce-staff-auth-proxy`
   (template `docker/nginx/snippets/commerce-staff-proxy.conf.template`, entrypoint gate `COMMERCE_STAFF_PROXY`, compose wiring,
   render tests + mock-upstream smoke, `docs/nginx-commerce-staff-proxy.md`). Merge it, cut an `nginx-v*` tag, deploy nginx with the
   gate **off** (rendered config is byte-identical to today). The exact block it renders when the gate is on (origin = the existing
   `COMMERCE_PLATFORM_BASE_URL` without `/api`) is in [Appendix A](#appendix-a--nginx-block-rendered-when-commerce_staff_proxytrue).
3. **Enable the proxy** — host `.env` `COMMERCE_STAFF_PROXY=true`, rerun Prod for nginx with the same tag and `env_diff_only=false`
   (recreate, not reload). Check:
   - `curl -s -o /dev/null -w '%{http_code}' -X POST https://joshapp.io/api/commerce/admin/auth/login -H 'content-type: application/json' -d '{"email":"nobody@example.com","password":"x"}'` → `401` (commerce's `invalid credentials`)
   - `curl -s -o /dev/null -w '%{http_code}' https://joshapp.io/api/commerce/winback/me` → `401`
   - `curl -s -o /dev/null -w '%{http_code}' https://joshapp.io/api/commerce/admin/staff` → `404` (not proxied)
   - `https://joshapp.io/api/auth/login` still answers from josh.
4. **Accounts** — every active Josh sales rep needs an active commerce `sale` / `sales_manager` account with the temporary password
   already changed (read-only gap check 2026-10-08: 2 Josh sales staff, both have commerce accounts, both still `mustChangePassword`;
   0 missing). Use the existing commerce-admin flow; `npm run winback-staff-accounts-plan -- --json` is the dry-run planner.
5. **Backfill** (maintenance window, ~15 min, sales app writes paused):
   1. Dry run: ops-platform `action=script script=winback-staff-backfill-dry` (read-only). The 2026-10-08 run gave **2 links, 37 rows**;
      review any change in counts, unmatched, ambiguous or ineligible entries before going on.
   2. Apply on the commerce host: `npm run winback-staff-backfill -- --apply --json` (refuses unless `WINBACK_OWNER=commerce` and
      `COMMERCE_OWNS_SALES_REPS=true`; locks, rolls back on any conflict).
   3. Re-run the dry run → **0 planned rewrites, 0 new links**. Wait 60 s for identity caches (or restart platform workers).
   Josh-token sessions keep working after this (links resolve Josh subjects to the commerce id).
6. **Flip the app** — saleactivity `config/prod.json` `STAFF_AUTH: "commerce"`; build and deploy the web build (`joshapp.io/sale`)
   and ship the mobile builds. Existing sessions are from the other issuer and are discarded → everyone signs in again with the commerce account.
7. **Smoke** (below). Keep `WINBACK_ACCEPT_JOSH_JWT` on until every installed mobile build is on commerce mode.

## Smoke checks (after step 6)

- **Login as sale** (the `sale` account): temporary password → change-password step → workspace; `/winback/me` role `sale`, sale UI.
- **Login as sales_manager**: manager UI (team, dashboard, assignment).
- **List**: pool, My Day and opportunities load; Market Explorer browse + place preview load (commerce restaurant-place).
- **Handoff**: manager assigns a test lead to the sale account → it shows in the sale's list; the sale gets the lead-assigned push.
- **Collab log**: open an opportunity, send a collaboration request/message → it appears in `/collaboration/logs` for both users.
- Refresh: leave the app > 15 min idle, then use it — silent token refresh, no logout.
- Josh-only by design in commerce mode: notification history/preferences show an "unavailable with this sign-in" notice (push still arrives).

## Rollback

1. App: set `STAFF_AUTH: "josh"` again, rebuild + redeploy web (and mobile if shipped). Users sign in again with Josh accounts
   (the issuer check discards commerce sessions). Josh tokens are still accepted by commerce winback (`WINBACK_ACCEPT_JOSH_JWT` on).
2. nginx: optional — set `COMMERCE_STAFF_PROXY=false` (or remove it) and recreate nginx; the route disappears.
3. Commerce endpoint: additive, leave it.
4. Backfill: not reverted. Links keep Josh subjects resolving to the commerce ids, so josh-mode users still see their rows.

## Appendix A — nginx block rendered when `COMMERCE_STAFF_PROXY=true`

Appended to josh nginx `snippets/proxy-paths.conf` by the entrypoint (never hand-edit prod nginx; recreate the container).
Non-POST on the auth routes → 405 `Allow: POST`; anything else under `/api/commerce` → 404 without contacting commerce.

```nginx
location = /api/commerce {
  return 404;
}

location ^~ /api/commerce/ {
  location ~ ^/api/commerce/admin/auth/(login|refresh|logout|password)$ {
    limit_req zone=api_auth burst=15 nodelay;

    set $commerce_origin http://172.31.40.66:3100;
    if ($request_method != POST) {
      add_header Allow POST always;
      return 405;
    }
    rewrite ^/api/commerce/admin/auth/(login|refresh|logout|password)$ /api/admin/auth/$1 break;

    proxy_pass $commerce_origin;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $forwarded_proto;
    proxy_set_header X-Client-Id "";
    proxy_set_header X-Client-Secret "";
    proxy_connect_timeout 5s;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
  }

  location ^~ /api/commerce/winback/ {
    limit_req zone=api_general burst=50 nodelay;

    set $commerce_origin http://172.31.40.66:3100;
    rewrite ^/api/commerce/(winback/.*)$ /api/$1 break;
    return 404;

    proxy_pass $commerce_origin;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $forwarded_proto;
    proxy_set_header X-Client-Id "";
    proxy_set_header X-Client-Secret "";
    proxy_connect_timeout 5s;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
  }

  return 404;
}
```
