# Commerce Platform

**Admin/internal endpoints are still open — no authentication.** Do not expose
this beyond localhost/dev. (The storefront and developer-portal surfaces below
_are_ authenticated — API keys and portal JWTs respectively — but every
`/api/...` admin/CRUD route has no guard at all.)

Integration-first commerce platform (NestJS + TypeORM + BullMQ), separate from the
legacy `apps/backend`. Owns its own Postgres database (`commerce_db`) and migration
ledger. External systems (ERP, storefronts) are integrations behind connectors; the
platform is the source of truth. Admin console: `apps/commerce-admin` (Vite/React, :4403).
Developer portal: `apps/commerce-portal` (Vite/React, :4404) — self-service account
registration, API keys, and webhook subscriptions for external teams (see
"Developer Portal" below).

## Running locally — quickstart

Prereqs: Postgres on `localhost:5432`, Redis on `localhost:6379`, Node 22
(`source ~/.nvm/nvm.sh && nvm use 22`).

```bash
make cp-setup    # first time: checks Postgres/Redis, creates commerce_db, runs migrations
make cp-dev      # starts all three: API :3100 + admin :4403 + portal :4404 (background, logs in .commerce-logs/)
make cp-status   # what's up
make cp-stop     # stop everything
```

`make cp-dev` runs the platform with dev defaults: `STOREFRONT_API_KEYS=dev-key`,
`PORTAL_JWT_SECRET=dev-portal-secret`, `PORTAL_SELF_REGISTER=true`, `PORTAL_KEY_MINT_ACCOUNT_IDS=*`, CORS for :4403/:4404. Individual apps:
`npm run dev:cp` / `dev:cpadmin` / `dev:cpportal`.

<details>
<summary>Manual start (prod-like: build + node, no watch)</summary>

```bash
createdb commerce_db && npm run cp:migration:run   # first time only
npx nx build commerce-platform
COMMERCE_DB_HOST=localhost COMMERCE_DB_USERNAME=$USER COMMERCE_DB_NAME=commerce_db \
REDIS_HOST=localhost PORT=3100 COMMERCE_CORS_ORIGINS=http://localhost:4403,http://localhost:4404 \
node dist/apps/commerce-platform/src/main.js
npx nx serve commerce-admin    # :4403
npx nx serve commerce-portal   # :4404
```
</details>

Unit tests: `npx nx test commerce-platform` (includes the architecture fitness
test that enforces module dependency direction).

## Environment variables

Core (see `.env.example`): `COMMERCE_DATABASE_URL` *or* `COMMERCE_DB_HOST` /
`COMMERCE_DB_PORT` / `COMMERCE_DB_USERNAME` / `COMMERCE_DB_PASSWORD` /
`COMMERCE_DB_NAME` / `COMMERCE_DB_SSL` / `COMMERCE_DB_LOGGING`, `REDIS_HOST` /
`REDIS_PORT`, `PORT`, `COMMERCE_CORS_ORIGINS`.

### Cycle 2 (reservation + checkout saga)

| Variable | Default | Purpose |
|---|---|---|
| `RESERVATION_TTL_MINUTES` | `30` | How long a held reservation lives before an unpaid order is expired. Stamped provisionally at reserve time and re-stamped by the checkout saga. |
| `RESERVATION_SWEEP_MS` | `60000` | Interval of the expiry sweep worker that releases overdue holds and expires their orders (covers orders stuck in `reserving` too; never stomps paid orders). |
| `TO_ORDER_DEFAULT_LEAD_TIME_DAYS` | `7` | Fallback lead time for `to_order` lines when neither the product's `leadTimeDays` nor the `commerce/default_lead_time_days` setting is set. Promise date = order date + lead time. |
| `COMMERCE_RESERVATION_CONNECTOR` | `erp-stub` | Integration `type` the reservation gateway resolves to find the active connector. |
| `RESERVATION_TIMEOUT_MS` | `5000` | Hard timeout for every gateway call to the ERP connector. |
| `RESERVATION_BREAKER_THRESHOLD` | `5` | Consecutive gateway failures before the circuit breaker opens. |
| `RESERVATION_BREAKER_COOLDOWN_MS` | `30000` | How long the breaker stays open; calls during cooldown degrade to per-line `erp_unavailable` failures. |

### Cycle 3b (portal, API keys, ERP ingestion)

| Variable | Default | Purpose |
|---|---|---|
| `PORTAL_JWT_SECRET` | *(dev fallback `dev-portal-secret`)* | Signs/verifies developer-portal JWTs (`PortalAuthService`, `PortalJwtGuard`). **Required in `NODE_ENV=production`** — register/login and every `PortalJwtGuard`-protected route fail closed (`503`/`401`) without it, rather than silently falling back to the public dev secret. |
| `PORTAL_SELF_REGISTER` | *(unset = off)* | `true`/`1` opens developer self-signup (`POST /api/v1/portal/auth/register`). Off: register is `403` (no account created, no `409` for a known email); existing developer accounts, login, refresh and API keys work as before. |
| `PORTAL_KEY_MINT_ACCOUNT_IDS` | *(unset = nobody)* | Admin approval for minting storefront keys: comma-separated developer account ids allowed to `POST /api/v1/portal/keys`; others get `403`. `*` = any account (dev/e2e only). Listing/revoking keys and every key already issued (josh's included) are unaffected — the storefront guard never reads this. |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS` | `900` (15 min) | Lifetime of the access JWT returned by staff (`/api/admin/auth/login`) and portal (`/api/v1/portal/auth/login`) sign-in and refresh. The shared `JwtModule` default (12 h) is unchanged for other signers. |
| `AUTH_REFRESH_TOKEN_TTL_DAYS` | `30` | Lifetime of the opaque refresh token (sliding: every rotation issues a fresh one with the full TTL, up to the family cap below). Only its sha256 is stored (`auth_refresh_token`). |
| `AUTH_REFRESH_TOKEN_FAMILY_MAX_DAYS` | `90` | Absolute cap on one sign-in (a refresh-token family) counted from the password login: successors never expire later than this, and a refresh past it is refused (`401`, family revoked as `family_expired`). |
| `STOREFRONT_API_KEYS` | *(unset)* | Still supported as a bootstrap/e2e fallback for `StorefrontApiKeyGuard` — see "API keys" below for how it now interacts with DB-backed keys. |
| `STOREFRONT_TRUSTED_KEY_IDS` | *(unset)* | Comma-separated `api_keys.id` values treated as **trusted** on josh-only storefront routes (`@TrustedStorefrontKey()`: everything except `catalog`). `STOREFRONT_API_KEYS` env keys are always trusted. Not a secret (ids, not keys). |
| `STOREFRONT_TRUSTED_KEYS_MODE` | `warn` | `warn`: an untrusted key on a josh-only route is allowed and logged (key id only, once per key per hour). `enforce`: it gets `403`. Only the exact value `enforce` refuses. |

## Endpoints

Global prefix: `/api`. Standard CRUD (`GET`/`POST`/`GET :id`/`PATCH :id`/`DELETE :id`)
exists for `customers`, `products`, `inventory`; plus the platform surfaces below.

### Orders & checkout
- `POST /api/orders` — create draft order with lines (`{ customerId, lines: [{ productId, qty, unitPrice }] }`). `order.total` = sum of rounded line totals.
- `GET /api/orders/:id/full` — order + lines + fulfillments + reservations + payment.
- `POST /api/orders/:id/checkout` — run the checkout saga. Requires an `Idempotency-Key` header; replaying the same key returns current state, a different key on a non-draft order gets `409`.

### Payments (simulated gateway)
- `GET /api/payments?orderId=...` — list payments.
- `POST /api/payments/:id/pay` — mark paid → reservations confirmed, order `confirmed`.
- `POST /api/payments/:id/fail` — mark failed → reservations released, order `failed`.

### Reservations
- `GET /api/reservations?page=&pageSize=&status=&orderId=` — list holds.
- `POST /api/reservations/:orderId/release` — manual admin release of an order's holds.

### ERP stub (simulated Oracle ERP)
- `GET /api/erp-stub/stock` — list stub stock rows.
- `PUT /api/erp-stub/stock` — upsert `{ sku, qty }` (stage test scenarios).

### Integrations & platform plumbing
- `GET|POST /api/integrations`, `GET /api/integrations/:id`
- Webhooks in/out, sync jobs, admin console API (`/api/admin/...`) — see the
  respective module controllers under `src/modules/`.

## Storefront API (josh)

Separate, versioned surface for the `josh` storefront (and any other
consumer-facing storefront) under `/api/v1/storefront/*`. Kept apart from the
admin CRUD endpoints above so storefront auth/versioning can evolve
independently.

**Auth:** every route requires header `X-Api-Key: <key>` (`StorefrontApiKeyGuard`,
DB-first as of Cycle 3b):

1. **DB lookup** — hash the provided key (SHA-256) and look it up in `api_keys`
   (issued via the developer portal, see "Developer Portal" below). A hit that
   is `active` and not revoked → allow, with a throttled `lastUsedAt` update.
   An in-memory positive cache (~30s TTL, keyed by the raw key string) avoids a
   DB round-trip on every request — see the revoke caveat below.
2. **Env fallback** — if the DB lookup misses, fall back to the comma-separated
   `STOREFRONT_API_KEYS` env var (bootstrap/e2e compatibility):
   ```bash
   STOREFRONT_API_KEYS=e2e-key,another-key   # comma-separated, no spaces
   ```
3. **Fail-open bootstrap** — with no key supplied, no env var set, and **no
   `ApiKey` row ever created**, the guard allows all requests outside
   `NODE_ENV=production` (logs one warning). The moment any `ApiKey` row
   exists (even a revoked one from a different account) the surface **fails
   closed** — a missing key is always `401` from then on. Always fails closed
   in production regardless.
4. **Trusted keys (josh-only routes)** — customers, checkout, orders, `jagota/*`, `josh-orders/*`, `winback/*`,
   `dbd/*` and `livechat/*` also need a trusted key: an env key from step 2, or a DB key whose id is in
   `STOREFRONT_TRUSTED_KEY_IDS`. `catalog/*` stays open to any valid key. See `STOREFRONT_TRUSTED_KEYS_MODE`.

**Revoke has a ≤30s window:** because of the guard's positive cache, a key
revoked via `POST /v1/portal/keys/:id/revoke` can still authenticate for up to
~30s afterward if it was used recently (the cache entry hasn't expired yet).
`e2e/portal-ingest-scenarios.sh`'s P5 scenario asserts against
`GET /v1/portal/keys` (DB truth: `active: false`) rather than sleeping 31s or
racing an immediate re-call.

### `POST /v1/storefront/customers` — upsert
Identity resolution is deterministic on normalized email/phone (no
probabilistic merge), then a best-effort round-trip through the `erp`
connector to fetch a customer code (see below; degrades to `null` on failure,
never blocks the request).

Request (`StorefrontCustomerDto`):
```json
{ "name": "Somchai Jaidee", "email": "somchai@example.com", "phone": "0812345678", "taxId": "1234567890123" }
```
Response:
```json
{ "customerId": "8f2b...-uuid", "customerCode": "MOCK-CUST-8f2b...-uuid" }
```
`customerCode` is `null` when no active `erp` integration exists, or the ERP
call fails/errors. `400` if neither `email` nor `phone` is given.

### `GET /v1/storefront/catalog/products?search=&page=&pageSize=`
### `GET /v1/storefront/catalog/products/:id`
Read-only product listing. `pageSize` capped at 100.

Response item (`CatalogProductRow`, wrapped in `{ items, total, page, pageSize }`
for the list route):
```json
{
  "id": "uuid", "sku": "SKU-1", "name": "Product 1", "description": null,
  "status": "active", "fulfillmentMode": "on_hand", "leadTimeDays": null,
  "price": "150.00", "stock": 3
}
```
**`price` and `stock` are display caches only** — `price` is the most recent
`PriceListItem` (`null` if none exists yet), `stock` is on-hand minus reserved
summed from `InventoryLevel` (note: this is a *separate* table from the
`erp-stub` stock rows used by `checkout-scenarios.sh`, so seeding one does not
populate the other). Neither is authoritative: real price resolution follows
the pricing hierarchy in `CLAUDE.md`, and real availability is decided at
reserve time by the reservation gateway (a storefront cart can still fail to
check out even if `stock > 0` here, e.g. a concurrent buyer wins the last unit).

### `POST /v1/storefront/checkout`
Creates the draft order and runs the checkout saga in one call. Requires an
`Idempotency-Key` header — **rejected with `400` before any order row is
created** if missing (stricter than the admin `/api/orders/:id/checkout`,
which 400s inside the saga after the draft already exists).

Request (`StorefrontCheckoutDto`):
```json
{
  "customerId": "uuid", "currency": "THB",
  "lines": [{ "productId": "uuid", "qty": 1, "unitPrice": 150 }]
}
```
Response (`CheckoutResult`):
```json
{
  "orderId": "uuid", "status": "pending_payment", "paymentId": "uuid",
  "lines": [ { "orderLineId": "uuid", "status": "held", "failReason": null } ]
}
```
`status` is `pending_payment` (reserved, awaiting payment) or `failed`
(reservation failed — check each line's `status`/`failReason`).

### `POST /v1/storefront/checkout/:orderId/payment-result`
Simulated payment callback — same effect as `POST /api/payments/:id/pay|fail`
but addressed by order instead of payment ID (looks up the order's pending
payment for you).

Request (`PaymentResultDto`):
```json
{ "result": "paid" }
```
`result` is `"paid"` or `"failed"`. `404` if the order has no pending payment.

### `GET /v1/storefront/orders/:id`
Stitched single-order view: order + per-line fulfillment status + promised
date + payment status, assembled from `OrderService.getFull`.

Response (money/quantity fields are `numeric` columns, serialized as strings):
```json
{
  "orderId": "uuid", "status": "confirmed", "currency": "THB", "total": "150.0000",
  "payment": { "id": "uuid", "status": "paid" },
  "lines": [
    {
      "orderLineId": "uuid", "productId": "uuid", "qty": "1.0000",
      "unitPrice": "150.0000", "lineTotal": "150.0000",
      "fulfillment": { "mode": "on_hand", "status": "confirmed", "promisedDate": null }
    }
  ]
}
```

### `GET /v1/storefront/orders?customerId=&page=&pageSize=`
Paginated order history for one customer (`customerId` required).

## ERP integration skeleton

A real ERP (e.g. Oracle) is modeled as an `Integration` row with
`type: "erp"` (distinct from the simulated `erp-stub` used by
`checkout-scenarios.sh`). It's registered and safe to create today —
while its `config.liveMode` is anything other than `true`, every call
returns a canned mock in the *same shape* as a live response, so nothing
downstream (call sites, mappings, storefront customer sync) has to change
when the real ERP goes live.

**Config keys** (`Integration.config`, all optional until `liveMode: true`):

| Key | Type | Purpose |
|---|---|---|
| `baseUrl` | `string` | Root URL of the real ERP's REST API. |
| `apiKey` | `string` | Sent as `X-Api-Key` on every outbound call. |
| `liveMode` | `boolean` | `true` → make real HTTP calls; anything else (including unset) → return mocks. |

### Outbound: `ErpHttpClient` endpoint table

The single place that knows the real ERP's wire format (`src/modules/integration/connector/erp/erp-http.client.ts`).
Every method is mock-gated by `cfg.liveMode` individually — flipping the flag
is the only change needed to go live, call sites never change.

| Client method | Verb + path | Mock (liveMode off) |
|---|---|---|
| `reserve(lines)` | `POST /api/v1/reservations` | `{ ok: true, reservationRef: "MOCK-RSV-<idempotencyKey>" }` per line |
| `confirmReservations(refs)` | `POST /api/v1/reservations/confirm` | `{ ok: true }` |
| `releaseReservations(refs)` | `POST /api/v1/reservations/release` | `{ ok: true }` |
| `createOrder(payload)` | `POST /api/v1/orders` | `{ ok: true, erpOrderRef: "MOCK-ORD-<platformOrderId>" }` |
| `cancelOrder(erpOrderRef)` | `POST /api/v1/orders/:erpOrderRef/cancel` | `{ ok: true }` |
| `upsertCustomer(payload)` | `PUT /api/v1/customers` | `{ ok: true, customerCode: "MOCK-CUST-<platformCustomerId>" }` |
| `fetchProducts(sinceIso)` | `GET /api/v1/products?since=` | `[]` |
| `fetchStock(skus)` | `GET /api/v1/stock?skus=` | `skus.map(sku => ({ sku, qty: 0 }))` |

`ErpConnector` (`type: "erp"`) is the adapter that maps canonical reservation
gateway / sync-job ports onto these client calls — it does **not** replace
`erp-stub` as the reservation authority unless `COMMERCE_RESERVATION_CONNECTOR=erp`
is set explicitly (see the env var table above).

### Inbound: `POST /webhooks/erp`

The real ERP posts events to the generic webhook entrypoint using the
integration's slug (defaults to `erp`, i.e. `POST /webhooks/erp`). The
pipeline verifies the signature (if `signingSecret` is set on the integration),
persists the raw event, retries on failure, and emits
`integration.webhook.received`. `ErpEventProcessor` then translates the raw
`event_type` into a canonical platform event; unknown types are logged and
skipped (never poison the pipeline):

| Raw `event_type` | Canonical platform event |
|---|---|
| `sale_order.created` | `erp.sale-order.created` |
| `stock.changed` | `inventory.updated` |
| `product.changed` | `product.updated` |
| `customer.changed` | `customer.updated` |

### Go-live procedure

Flipping from mock to the real ERP is one step: create (or update) the
integration row with `type: "erp"` and `config.liveMode: true`, pointing
`baseUrl`/`apiKey` at the real system:

```bash
curl -X POST http://localhost:3100/api/integrations \
  -H 'Content-Type: application/json' \
  -d '{"name":"ERP (Oracle)","type":"erp","config":{"baseUrl":"https://erp.example.com","apiKey":"...","liveMode":true}}'
```

Optionally, to make `erp` the reservation authority instead of `erp-stub`,
set `COMMERCE_RESERVATION_CONNECTOR=erp` on the platform process and restart.
No call-site or mapping code changes either way.

**`signingSecret` is not optional in practice — it's the only way in.**
`WebhookReceiverService`/`SignatureVerifier` reject a request unless **both** a
`signingSecret` is configured on the integration row **and** a matching
`X-Signature` header (`HMAC-SHA256` hex over the raw body) is sent; an
integration row with no `signingSecret` accepts **nothing**, signed or
unsigned (verified live — a plain unsigned `POST /webhooks/erp` against an
integration row with an empty `signingSecret` returns `401 Invalid webhook
signature`, it does not fall back to open). There is currently no `PATCH`
endpoint to set `signingSecret` on an existing row — set it at creation
(`POST /api/integrations` body includes `signingSecret`) or directly via
`UPDATE integrations SET signing_secret = '...' WHERE id = '...'` for a row
created earlier without one (`e2e/portal-ingest-scenarios.sh` does the latter,
idempotently, for its fixtures).

### ERP order push (outbound, Cycle 3b §1)

`ErpOrderPushSubscriber` listens for the platform's own `order.confirmed`
event (fired when a payment lands `paid`) and pushes the confirmed order to
the ERP via the same mock-gated `ErpHttpClient.createOrder`:

- No active `erp` integration → debug log, skip (never blocks the order).
- Client failure/throw → warned and swallowed — **push is a side effect; the
  order is already confirmed and is never rolled back or blocked by ERP
  availability.** No auto-retry this cycle (a retry queue is backlog).
- Success → `MappingService.link(erpIntegrationId, 'order', orderId,
  erpOrderRef)`, so the ERP reference lands in `order_mappings`. With
  `liveMode` off (the default), `erpOrderRef` is `MOCK-ORD-<platformOrderId>`:
  ```sql
  select external_id from order_mappings where platform_id = '<orderId>';
  -- MOCK-ORD-<orderId>
  ```

## Developer Portal (`apps/commerce-portal`, :4404)

Self-service onboarding for external teams (CRM, other storefronts, etc.) —
register → create a key → subscribe to webhooks, with **no human/DB
intervention**. Same placement pattern as `src/storefront/`: `src/portal/`,
thin controllers delegating to `core/auth` and `core/api-key`.

**Auth** (`PORTAL_JWT_SECRET` — see env var table above):
- `POST /api/v1/portal/auth/register` — **off unless `PORTAL_SELF_REGISTER=true`**
  (else `403`, checked before any lookup). `{ email, password (≥8 chars) }` →
  bcrypt-hashed, `core/user` row with `role: 'developer'`. `409` on a
  duplicate email (also correct under a concurrent double-register — the
  unique index on `email` is the real arbiter, not the pre-check).
- `POST /api/v1/portal/auth/login` — `{ email, password }` → `{ accessToken,
  role, mustChangePassword, refreshToken, expiresIn, refreshExpiresIn }`
  (JWT signed with `PORTAL_JWT_SECRET`, `sub`/`email`/`role` claims, 15 min by
  default). Every route below requires `Authorization: Bearer <accessToken>`
  (`PortalJwtGuard`).
- `POST /api/v1/portal/auth/refresh` — `{ refreshToken }` → the same shape as
  login with a NEW `refreshToken`; the old one is spent (single use). Showing a
  spent token again revokes the whole sign-in (reuse detection). Any failure is
  a generic `401 invalid refresh token`. Staff tokens are refused here and portal
  tokens on `POST /api/admin/auth/refresh` (same contract for commerce-admin).
- `POST /api/v1/portal/auth/logout` — `{ refreshToken }` → `{ ok: true }`
  (always, also for unknown tokens); ends that sign-in. No access token needed.
  Staff: `POST /api/admin/auth/logout`.

**API keys** (`GET|POST /api/v1/portal/keys`, `POST /api/v1/portal/keys/:id/revoke`)
— account-scoped, no cross-account access:
- `POST` needs an approved account: its id must be in `PORTAL_KEY_MINT_ACCOUNT_IDS`
  (else `403`; see the env table).
- `POST` `{ name }` → `{ id, name, keyPrefix, scope, fullKey }`. **`fullKey`
  (format `ck_live_<32 hex chars>`) is returned exactly once, at creation** —
  only its SHA-256 hash and an 16-char display `keyPrefix` persist. The portal
  UI must show it in a copy-once modal; there is no way to retrieve it again.
- `GET` → list of own keys (name, prefix, scope, `active`, `lastUsedAt`,
  `revokedAt` — never the key itself).
- `POST :id/revoke` → sets `active: false`. See "Revoke has a ≤30s window"
  above — the storefront guard's positive cache means a just-revoked key can
  still authenticate briefly; the keys list is the source of truth, not an
  immediate re-call.

**Webhooks** (`GET /api/v1/portal/events`, `GET|POST|PATCH /api/v1/portal/webhooks`,
`POST /api/v1/portal/webhooks/:id/test`) — account-scoped self-service
subscriptions (`webhook_subscriptions.account_id`; admin-created rows keep
`account_id: null` and stay invisible to portal accounts):

Event catalog (`GET /api/v1/portal/events`):

| `type` | Thai description | Example payload shape |
|---|---|---|
| `order.created` | มีการสร้าง order ใหม่ในแพลตฟอร์ม | `{ id }` |
| `order.confirmed` | order ชำระเงินสำเร็จและยืนยันแล้ว (จองสต๊อกสำเร็จ) | `{ id }` |
| `order.cancelled` | order ถูกยกเลิก | `{ id }` |
| `customer.created` | ลูกค้าใหม่ถูกสร้าง | `{ id }` |
| `customer.updated` | ข้อมูลลูกค้าเปลี่ยน (รวม customer code จาก ERP) | `{ id }` |
| `product.updated` | ข้อมูลสินค้าเปลี่ยน | `{ id }` |
| `inventory.updated` | สต๊อกเปลี่ยน (จาก ERP หรือในแพลตฟอร์ม) | `{ id, quantity, reserved }` |
| `price.updated` | ราคาเปลี่ยน | `{ id }` |
| `erp.sale-order.created` | sale ฝั่ง ERP สร้าง order ตรง (demand visibility) | `{ webhookEventId, order }` |

- `POST /webhooks` — `{ name, targetUrl, eventTypes: [...], secret? }`.
  `eventTypes` must all be known catalog types (`400` otherwise). `targetUrl`
  goes through an SSRF guard (rejects loopback/private/link-local hosts in
  production unless `WEBHOOK_ALLOW_PRIVATE_TARGETS=1`; permissive outside
  production so a `localhost` e2e sink works).
- `PATCH /webhooks/:id` — partial update (`targetUrl`/`eventTypes`/`secret`/`active`).
- `POST /webhooks/:id/test` — fires the catalog example payload at
  `targetUrl` immediately (`{ type, test: true, payload }`) and returns the
  real delivery result: `{ ok, status, error? }`. **Note the actual HTTP
  status of this endpoint is `201`** (Nest's default for a bare `@Post`, no
  `@HttpCode` override) — don't assume `200`. `ok: false` / `status: null` for
  a target that refuses the connection (e.g. nothing listening) is a normal,
  correctly-reported result, not a bug.

## API docs (Swagger)

`GET /api/docs` serves interactive Swagger UI with **try-it** (real requests,
not just documentation) for the public v1 contract only — storefront
(`X-Api-Key` security scheme) + developer-portal auth. Admin/internal
endpoints are deliberately excluded (`SwaggerModule.createDocument(..., {
include: [StorefrontModule, PortalModule] })`); the raw spec is at
`GET /api/docs-json`.

## ERP data ingestion (inbound, Cycle 3b §5)

"เอามากรองก่อน แล้วค่อย apply" — every inbound ERP payload lands in a staging
table **before** anything touches a platform table. Receiving line is the
same `POST /webhooks/erp` covered above (signature-verified, persisted,
retried); `ErpIngestService` subscribes to the resulting canonical events,
parses, stages, and (per policy) applies.

**Staging table (`erp_ingest_records`)**: `integrationId`, `entityType`
(`product` | `stock` | `customer` | `sale_order`), `externalId`, `rawPayload`
(jsonb, verbatim — never lost even on a parse failure), `parsedPayload` (jsonb,
mapped fields), `status` (`received` → `applied` | `failed` | `skipped`),
`error`, `appliedAt`. A malformed payload lands as a `failed` row (never
throws back to the webhook caller).

**Apply policy** (default; configurable via `SettingsService` key
`integration.erp_auto_apply`): `product`, `stock`, `customer` auto-apply
immediately; `sale_order` is **store-only this cycle** — staged for demand
visibility only, always resolves straight to `skipped`, and creates **no
platform order row and no `order_mappings` entry** (a deliberate scope cut;
see the class doc on `ErpIngestService.apply()`).

**Field ownership** (enforced in the appliers, mirrors the pricing/promotion
"one source of truth" rule in the top-level `CLAUDE.md`):
- **Product**: ERP owns `status` and `leadTimeDays` on a synced SKU and always
  overwrites them; ERP **never** overwrites `name` after creation (or
  `description`/images/categories/publish status, which ERP doesn't send at
  all) — those are merchandising-owned. `LIST_PRICE` appends a new
  `PriceListItem` only on an actual change (an unchanged price is a no-op, not
  a duplicate row).
- **Stock**: warehouses auto-create by `SUBINVENTORY_CODE`; `ON_HAND_QTY`
  always overwrites `InventoryLevel.quantity` for that product/warehouse.
- **Customer**: ERP owns `code` (`ACCOUNT_NUMBER`) and always overwrites it on
  a synced customer; `email`/`phone` are **fill-only** (never clobber a value
  already entered on the platform side). Symmetrically, the storefront's own
  `POST /v1/storefront/customers` upsert (mock ERP round trip) **never**
  overwrites an existing `code` — once a customer carries a code, from either
  direction, it's ERP-owned and no other path may touch it again.

**Admin review** — commerce-admin's **ERP Ingest** page: list with
`entityType`/`status` filters (`GET /api/admin/erp-ingest?entityType=&status=&page=&pageSize=`),
raw + parsed payload viewer, per-row **Apply/Retry** button
(`POST /api/admin/erp-ingest/:id/apply` — idempotent; a no-op on rows already
`applied`/`skipped`, re-runs the applier for `received`/`failed`).

### The 4 Oracle example payloads (representative — confirm with the ERP team)

Verbatim from the design spec (`docs/superpowers/specs/2026-07-18-commerce-platform-portal-erp-ingest-design.md`
§5) and used as-is by `e2e/portal-ingest-scenarios.sh`'s I1–I4:

```json
// product.changed
{ "event_type": "product.changed", "item": {
  "INVENTORY_ITEM_ID": 10001, "SEGMENT1": "FISH-SALMON-1KG",
  "DESCRIPTION": "Salmon Fillet 1kg", "PRIMARY_UOM_CODE": "KG",
  "INVENTORY_ITEM_STATUS_CODE": "Active", "FULL_LEAD_TIME": 3,
  "LIST_PRICE": 590.00 } }

// stock.changed
{ "event_type": "stock.changed", "onhand": {
  "INVENTORY_ITEM_ID": 10001, "SEGMENT1": "FISH-SALMON-1KG",
  "SUBINVENTORY_CODE": "BKK-MAIN", "ON_HAND_QTY": 42 } }

// customer.changed
{ "event_type": "customer.changed", "account": {
  "CUST_ACCOUNT_ID": 5001, "ACCOUNT_NUMBER": "JGT-00871",
  "PARTY_NAME": "Somchai Restaurant Co., Ltd.",
  "EMAIL_ADDRESS": "ap@somchai.co.th", "PHONE_NUMBER": "02-123-4567",
  "TAX_REFERENCE": "0105561234567" } }

// sale_order.created
{ "event_type": "sale_order.created", "order": {
  "HEADER_ID": 7001, "ORDER_NUMBER": "SO-2026-045121",
  "ORDERED_DATE": "2026-07-18T09:30:00Z", "SOLD_TO_ACCOUNT": "JGT-00871",
  "LINES": [ { "LINE_NUMBER": 1, "SEGMENT1": "FISH-SALMON-1KG",
    "ORDERED_QUANTITY": 10, "UNIT_SELLING_PRICE": 550.00 } ] } }
```

Sending the `product.changed` + `stock.changed` payloads above (HMAC-signed,
see the `signingSecret` note above) makes `FISH-SALMON-1KG` show up in
`GET /v1/storefront/catalog/products?search=FISH-SALMON-1KG` with
`price: "590.00"` and `stock: 42`.

## Running the e2e scenarios

`e2e/checkout-scenarios.sh` proves the four saga paths against a **live** platform:

- **A** happy path: reserve → pay → confirmed, stub stock decremented
- **B** last-piece race: stock=1, two concurrent checkouts → exactly one winner
- **C** payment failure: holds released, stock restored
- **D** TTL expiry: unpaid order expires via the sweep, stock restored

One-time setup: the script needs `jq` and an active `erp-stub` integration row —
check `GET /api/integrations` first, create once with:

```bash
curl -X POST http://localhost:3100/api/integrations \
  -H 'Content-Type: application/json' \
  -d '{"name":"ERP Stub","type":"erp-stub"}'
```

**TTL split (important):** scenario D needs `RESERVATION_TTL_MINUTES=0` and
`RESERVATION_SWEEP_MS=2000` to expire fast — but running A–D in a single pass
against a TTL=0 platform is flaky *by design of scenario B*: B deliberately leaves
its winning order unpaid in `pending_payment` so it can assert "exactly one
winner", and under TTL=0 that leftover hold is immediately expiry-eligible. The
background sweep later reaps it and credits the shared SKU back mid-scenario-D,
double-crediting stock (observed: D sees qty 2 instead of 1). So run A–C against
a default-TTL launch and D against a TTL=0 launch, selected via `SCENARIOS`:

```bash
# Launch 1: default TTL → scenarios A-C
COMMERCE_DB_HOST=localhost COMMERCE_DB_USERNAME=$USER COMMERCE_DB_NAME=commerce_db \
REDIS_HOST=localhost PORT=3100 node dist/apps/commerce-platform/src/main.js &
SCENARIOS=ABC bash apps/commerce-platform/e2e/checkout-scenarios.sh
kill %1

# Launch 2: fast expiry → scenario D
COMMERCE_DB_HOST=localhost COMMERCE_DB_USERNAME=$USER COMMERCE_DB_NAME=commerce_db \
REDIS_HOST=localhost PORT=3100 RESERVATION_TTL_MINUTES=0 RESERVATION_SWEEP_MS=2000 \
node dist/apps/commerce-platform/src/main.js &
SCENARIOS=D bash apps/commerce-platform/e2e/checkout-scenarios.sh
kill %1
```

Each pass ends with `ALL SCENARIOS PASS`. `SCENARIOS` defaults to `ABCD`;
`API` overrides the base URL (default `http://localhost:3100/api`).

`e2e/storefront-scenarios.sh` proves the storefront gateway end-to-end against
a **live** platform: auth (`X-Api-Key`) → customer upsert (mock ERP customer
code) → catalog visibility → checkout → payment-result → the stitched order
view. Needs `jq`, and `STOREFRONT_API_KEYS` must include the key the script
sends (default `e2e-key`) — otherwise the S0 "no key rejected" assertion is
meaningless since the guard is open by default outside production. The script
creates the active `erp` integration row itself if one doesn't already exist
(idempotent).

```bash
COMMERCE_DB_HOST=localhost COMMERCE_DB_USERNAME=$USER COMMERCE_DB_NAME=commerce_db \
REDIS_HOST=localhost PORT=3100 STOREFRONT_API_KEYS=e2e-key \
node dist/apps/commerce-platform/src/main.js &
bash apps/commerce-platform/e2e/storefront-scenarios.sh
kill %1
```

Ends with `ALL STOREFRONT SCENARIOS PASS`. `KEY` overrides the API key sent
(default `e2e-key`); `API` overrides the base URL as above.

`e2e/portal-ingest-scenarios.sh` proves the Cycle 3b surfaces end-to-end
against a **live** platform: the developer-portal loop (P), ERP inbound
ingestion of the 4 Oracle payloads (I), and ERP order push (O). Needs `jq`,
`curl`, `openssl`, and `psql` (reachable at `$PGHOST`/`$PGUSER`/`$PGDATABASE`,
default `localhost`/`pongpanot_s`/`commerce_db`) — used both for the O
scenario's `order_mappings` check and to set a known `signingSecret` on the
`erp` integration row (idempotently — see "signingSecret is not optional in
practice" above for why this is required, not optional, for the I scenarios).

```bash
COMMERCE_DB_HOST=localhost COMMERCE_DB_USERNAME=$USER COMMERCE_DB_NAME=commerce_db \
REDIS_HOST=localhost PORT=3100 STOREFRONT_API_KEYS=e2e-key PORTAL_JWT_SECRET=e2e-secret PORTAL_SELF_REGISTER=true PORTAL_KEY_MINT_ACCOUNT_IDS='*' \
node dist/apps/commerce-platform/src/main.js &
bash apps/commerce-platform/e2e/portal-ingest-scenarios.sh
kill %1
```

Ends with `ALL PORTAL/INGEST SCENARIOS PASS`. Safe to re-run against the same
database repeatedly — every assertion targets end-state values (catalog
price/stock, the newest staged ingest row per `externalId`) rather than "a row
was created just now", since the Oracle example fixtures (`FISH-SALMON-1KG`,
`JGT-00871`, `SO-2026-045121`) are fixed, not randomized. `API`/`KEY` override
as above; `ERP_SIGNING_SECRET` overrides the signing secret used for the I
scenarios (default `e2e-erp-secret`).
