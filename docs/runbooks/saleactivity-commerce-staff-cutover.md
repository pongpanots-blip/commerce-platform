# saleactivity → commerce staff sign-in (`STAFF_AUTH=commerce`) — executable cutover runbook

Status: **prepared, not executed.** The user approved the switch itself; the operator (Grok Bot) runs it after the prep PRs pass
review. Nothing below has been run against prod. Every command is copy-paste; secrets come from env vars and are never echoed.

## What changes where

| Piece | Repo / PR | Effect |
|---|---|---|
| Commerce read endpoints | commerce-platform — restaurant-place PR | `GET /api/winback/restaurant-place[/:id]` for sale / sales_manager / admin (Market Explorer; was josh-only) |
| Runbook + backfill wrappers | commerce-platform — this PR | `ops/scripts/winback-staff-backfill-dry.cjs` (rescued from `ops/winback-staff-backfill-dry`) and `ops/scripts/winback-staff-backfill-apply.cjs`, both run the app's own `winback-staff-backfill` CLI through the existing **Ops platform** workflow |
| Same-origin proxy | Webjosh — branch `feat/commerce-staff-auth-proxy` | gate `COMMERCE_STAFF_PROXY=true` → `https://joshapp.io/api/commerce/…` forwards to commerce's **private** origin `http://172.31.40.66:3100` (from the existing `COMMERCE_PLATFORM_BASE_URL`). Allowlist: `POST admin/auth/{login,refresh,logout,password}` + `winback/*`; everything else 404 |
| App | saleactivity — app PR | `config/prod.json`: `COMMERCE_API_BASE_URL=https://joshapp.io/api/commerce`, `STAFF_AUTH` (stays `josh` until step 6) |

**No CORS change.** saleactivity ships as the iOS/Android app (josh no longer serves a `/sale` web build), and it calls
`joshapp.io` only. Native apps aren't subject to CORS, and the proxy keeps commerce's public host out of the app.
`COMMERCE_CORS_ORIGINS` is unchanged.

## Preconditions (read-only checks)

- Commerce flags: Ops platform → `action=status`. Need `WINBACK_OWNER=commerce` and `COMMERCE_OWNS_SALES_REPS=true` (the backfill refuses otherwise),
  `WINBACK_ACCEPT_JOSH_JWT` unset or `true` (keeps josh-mode installs working), and `RESTAURANTS_SOURCE=copies` or a configured replica (else restaurant-place → 503).
  ```sh
  gh workflow run ops-platform.yml -R pongpanots-blip/commerce-platform --ref main -f action=status
  ```
- Josh `prod.yml` already pins `WINBACK_VIA_COMMERCE=true` and `WINBACK_OWNED_BY_COMMERCE=true`. Nothing to change there.
- Staff accounts (read-only gap check 2026-10-08): 2 josh sales staff (1 `sale`, 1 `manager`), **both** have active commerce accounts
  (`sale`, `sales_manager`), both still `mustChangePassword`, ids differ (so the backfill links them). **0 missing.**

## 1. Merge + deploy order

1. **commerce restaurant-place PR**: merge → normal commerce deploy (tag/workflow as usual). It's additive with no migration.
   Check: `GET /api/winback/restaurant-place?limit=1` with a sale token → 200; with a cs token → 403.
2. **commerce runbook PR (this one)**: merge to main → normal commerce **platform deploy**. Merging puts both backfill scripts where the Ops platform
   workflow reads them (`--ref main`); the deploy ships the CLI's `--expect-links/--expect-rows` guard that the apply wrapper passes. Against an
   older image the CLI rejects those flags before connecting, so the apply refuses (exit 1) and writes nothing. No migration.
3. **Webjosh nginx PR**: merge → cut `nginx-v<x.y.z>` → deploy nginx with the gate **off** (the rendered config is byte-identical to today's).
4. **Enable the proxy**: add `COMMERCE_STAFF_PROXY=true` to the josh web host `.env` (`EC2_WEB_DEPLOY_DIR`) and rerun **Prod** with the same nginx tag and
   `env_diff_only=false`. That recreates the container; a reload isn't enough. Check:
   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://joshapp.io/api/commerce/admin/auth/login -H 'content-type: application/json' -d '{"email":"nobody@example.com","password":"x"}'   # 401 (commerce)
   curl -s -o /dev/null -w '%{http_code}\n' https://joshapp.io/api/commerce/winback/me          # 401
   curl -s -o /dev/null -w '%{http_code}\n' https://joshapp.io/api/commerce/admin/staff         # 404 (not proxied)
   curl -s -o /dev/null -w '%{http_code}\n' -X GET https://joshapp.io/api/commerce/admin/auth/login   # 405
   ```
5. **Backfill**: see §3.
6. **Flip the app**: see §2.
7. **Smoke**: see §4.

## 2. Where `STAFF_AUTH` lives, how to switch, one-step rollback

- It's a **compile-time** value in saleactivity `config/prod.json` → `"STAFF_AUTH": "josh" | "commerce"`. `tool/build.sh` injects it with
  `--dart-define-from-file=config/prod.json`. Its sibling `"COMMERCE_API_BASE_URL": "https://joshapp.io/api/commerce"` is already set by the app PR.
- **Switch**: on saleactivity master, set `"STAFF_AUTH": "commerce"` in `config/prod.json` in a one-line PR → merge →
  `tool/build.sh ipa` (TestFlight) and `tool/build.sh appbundle` (Play) → distribute. On first launch the app discards the stored josh session
  (issuer check), and users sign in with their commerce account. A temporary password forces the change-password step.
- **Rollback (one step)**: in TestFlight / Play, re-release the **previous josh-mode build**. Keep it available and don't expire it until the switch is
  confirmed. No server change is needed, because commerce keeps accepting josh tokens while `WINBACK_ACCEPT_JOSH_JWT` is on. The code
  equivalent is setting `"STAFF_AUTH": "josh"` back and rebuilding. Users sign in again with josh accounts. The nginx gate and the commerce endpoint can stay;
  they're inert for josh-mode builds. The backfill isn't reverted, and links keep josh subjects resolving to the same commerce ids.

## 3. Backfill (2 links, 37 rows): app-level CLI via the existing Ops platform workflow

Both scripts run the app's own `src/cli/winback-staff-backfill.js` inside the running platform container. There's **no hand-written SQL, no
direct DB session from the operator, and no JWT minting**. The workflow only supplies the container env it already has.

- **Dry run** (read-only, repeatable-read transaction; ids and counts only):
  ```sh
  gh workflow run ops-platform.yml -R pongpanots-blip/commerce-platform --ref main -f action=script -f script=winback-staff-backfill-dry
  gh run watch -R pongpanots-blip/commerce-platform "$(gh run list -R pongpanots-blip/commerce-platform --workflow ops-platform.yml -L1 --json databaseId -q '.[0].databaseId')"
  ```
  Expect `counts.links = 2`, rows (sum of `rowsChanged`) `= 37`, `ambiguous = 0`. Review `unmatched` and `ineligible`.
- **Real run** (maintenance window of about 15 min; ask reps to pause app writes):
  ```sh
  gh workflow run ops-platform.yml -R pongpanots-blip/commerce-platform --ref main -f action=script -f script=winback-staff-backfill-apply -f args='apply links=2 rows=37'
  ```
  What the wrapper actually guarantees (pinned to the reviewed plan; `ops/scripts/winback-staff-backfill-apply.test.cjs`):
  - `args` must be exactly `apply links=2 rows=37`. **Any other value exits 2 and the CLI is never started** (no dry run, no apply).
    The 2 and 37 are constants in the script, not read from `args`.
  - It runs the dry run first. If that report has no numeric `counts.links`, `counts.ambiguous` or `rowsChanged`, it exits 2.
    If it already plans **0 links / 0 rows / ambiguous 0** (the backfill was already applied), it **exits 0 without `--apply`**, so a rerun is safe.
    Any other plan than exactly 2 links / 37 rows / ambiguous 0 exits 1 without `--apply`.
  - Then `--apply --expect-links=2 --expect-rows=37`. The CLI refuses unless `WINBACK_OWNER=commerce` and `COMMERCE_OWNS_SALES_REPS=true`, then
    takes the table locks and **re-checks 2 / 37 / ambiguous 0 inside that locked transaction, before any write**. If the plan drifted after the dry
    run, it throws there and the transaction **rolls back; nothing is committed**. It also rolls back on any link/key conflict.
  - Last, a second dry run must plan **0 links / 0 rows**. This check is post-commit: it can fail the run but **cannot undo** the apply, and
    there is no automatic undo of a committed backfill (the app rollback in §2 doesn't revert it either).
  Wait 60 s for identity caches before reopening the app. Josh-mode installs keep working afterwards.
  (Before the runbook PR is merged, use `--ref feat/saleactivity-commerce-cutover` instead of `--ref main`.)

## 4. Smoke checks (read-only apart from the sign-in itself)

Accounts: **sale** = `pongpanot_s2@jagota.com` (commerce `sale`), **manager** = `pongpanot_s@jagota.com` (commerce `sales_manager`).
Both still have a temporary password, so the owner must sign in once in the app (or commerce-admin) and set a real password first. No password
is stored in this repo. Export it locally without echoing (`read -rs SMOKE_PW`).

```sh
B=https://joshapp.io/api/commerce
login() { curl -s -X POST "$B/admin/auth/login" -H 'content-type: application/json' \
  -d "$(jq -nc --arg e "$1" --arg p "$SMOKE_PW" '{email:$e,password:$p}')" | jq -r '.accessToken // .data.accessToken // empty'; }
read -rs SMOKE_PW; T=$(login pongpanot_s2@jagota.com); unset SMOKE_PW      # sale
curl -s -H "authorization: Bearer $T" $B/winback/me | jq '.data // . | {role, isManager}'                 # role sale, isManager false
curl -s -o /dev/null -w 'opportunities %{http_code}\n' -H "authorization: Bearer $T" "$B/winback/opportunities?limit=5"
curl -s -o /dev/null -w 'pool %{http_code}\n'          -H "authorization: Bearer $T" "$B/winback/pool?limit=5"
curl -s -o /dev/null -w 'my-day %{http_code}\n'        -H "authorization: Bearer $T" "$B/winback/my-day"
curl -s -o /dev/null -w 'places %{http_code}\n'        -H "authorization: Bearer $T" "$B/winback/restaurant-place?limit=5"
curl -s -o /dev/null -w 'sales-users %{http_code}\n'   -H "authorization: Bearer $T" "$B/winback/sales-users"    # 403 for a sale
read -rs SMOKE_PW; T=$(login pongpanot_s@jagota.com); unset SMOKE_PW       # manager
curl -s -H "authorization: Bearer $T" $B/winback/me | jq '.data // . | {role, isManager}'                 # sales_manager, true
curl -s -o /dev/null -w 'opportunities %{http_code}\n' -H "authorization: Bearer $T" "$B/winback/opportunities?limit=5"
curl -s -o /dev/null -w 'team-stats %{http_code}\n'    -H "authorization: Bearer $T" "$B/winback/team-stats"
curl -s -o /dev/null -w 'collab logs %{http_code}\n'   -H "authorization: Bearer $T" "$B/winback/collaboration/logs"
unset T
```
All 200 except the sale's `sales-users` (403). In the app, the same two sign-ins should show the sale and manager home screens, the
opportunities list and Market Explorer. Notification history shows the "not available with this sign-in" notice by design, and push still arrives.
Optional write checks (handoff, collaboration message) need a test lead and the user's OK; they're not part of the read-only smoke.

## Appendix A — nginx block rendered when `COMMERCE_STAFF_PROXY=true`

Appended to josh nginx `snippets/proxy-paths.conf` by the entrypoint (never hand-edit prod nginx; recreate the container).
Allowlist, same as Webjosh #558: `POST /api/commerce/admin/auth/{login,refresh,logout,password}` and `/api/commerce/winback/*` only.
Non-POST on the auth routes → 405 `Allow: POST`; anything else under `/api/commerce` (including `/api/commerce`, `/api/commerce/winback`
without the slash, `…/login/`, `/api/commerce/admin/staff`) → 404 without contacting commerce. This shows the routing only; the template in
Webjosh #558 (`docker/nginx/snippets/commerce-staff-proxy.conf.template`) is the source of truth for rate-limit zones and proxy headers.
Checked with nginx 1.26 against a local echo upstream: every allowlisted route reaches commerce as `/api/…`; all the paths above are 404.

```nginx
location = /api/commerce {
  return 404;
}

# Without this, nginx answers the slash-less prefix of `^~ /api/commerce/winback/` (a proxied location) with a 301.
location = /api/commerce/winback {
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
    # Gate before the rewrite (a `return` after `rewrite ... break` never runs). The gate and the rewrite use the
    # same pattern, so a URI the rewrite can't map (e.g. a decoded %0A) is 404 here and never reaches commerce.
    if ($uri !~ "^/api/commerce/winback/.*$") {
      return 404;
    }
    rewrite ^/api/commerce/(winback/.*)$ /api/$1 break;

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
