# Commerce Platform

Extracted from the `josh` monorepo (`apps/commerce-platform` + `apps/commerce-admin` +
`apps/commerce-portal`) on 2026-08-08. Integration-first SaaS commerce platform
(Shopify/Stripe-style), separate from the legacy `josh/apps/backend`.

Uses its own Postgres database `commerce_db` (shared connection details with the josh
monorepo's local dev Postgres instance — same physical DB, own migration ledger) and Redis
(BullMQ). `josh/apps/backend` talks to this service only over HTTP
(`COMMERCE_PLATFORM_BASE_URL`, `COMMERCE_PLATFORM_API_KEY`) — no build-time coupling.

## Apps

| App | Port | Purpose |
|---|---|---|
| `apps/commerce-platform` | 3100 | API (NestJS + TypeORM), Swagger at `/api/docs` |
| `apps/commerce-admin` | 4403 | Internal admin UI (Vite+React) |
| `apps/commerce-portal` | 4404 | Self-service developer portal (Vite+React) |

## Local dev

Prereqs: Postgres.app on `:5432` (user `$USER`, db `commerce_db`), Redis on `:6379`, node 22 (nvm).

```bash
make setup   # first time: create commerce_db if missing, run migrations
make dev     # start all three (backgrounded, logs in .commerce-logs/)
make status
make stop
```

## Migrations

```bash
npm run migration:show
npm run migration:generate -- apps/commerce-platform/src/migrations/MigrationName
npm run migration:run
npm run migration:revert
```

## Notes

- Not yet wired to a separate CI/CD pipeline or docker-compose — this repo currently only has
  the app source, Nx build config, and local-dev scripts ported over from the monorepo.
- `apps/backend` in the `josh` monorepo still has the only network-facing coupling to this
  service (`apps/backend/src/app/commerce-platform/commerce-platform.client.ts`).
