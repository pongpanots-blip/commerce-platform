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

## Branching

Trunk-based on `main`, same as `Webjosh` and `search-ai-josh`: branch `feat/<slug>`,
`fix/<slug>` or `chore/<slug>` off `origin/main`, PR back into `main`. `master` is retired.

## Deploy (ECR → EC2)

Same pattern as the `josh` monorepo: build+push images to ECR via GitHub Actions, then a
self-hosted runner on a dedicated EC2 instance pulls and restarts via `docker compose`.
Workflow: [.github/workflows/deploy-ecr.yml](.github/workflows/deploy-ecr.yml). Runs on tag
push (`v1.2.3` = all 3 services, `platform-v1.2.3`/`admin-v1.2.3`/`portal-v1.2.3` = single
service) or manual dispatch (`gh workflow run deploy-ecr.yml --ref main ...`). Cut tags from `main`.

**One-time setup (not yet done — separate infra from `josh`, needs your own AWS access):**

1. Create an ECR repo per service: `commerce-platform`, `commerce-admin`, `commerce-portal`
   (same AWS account/region as `josh`, or a new one — this repo intentionally doesn't assume
   either).
2. Provision an EC2 instance for this stack (Docker + docker compose installed).
3. On that EC2: run [docker/github-runner-setup.sh](docker/github-runner-setup.sh) to register
   it as a GitHub Actions self-hosted runner (labels `self-hosted, linux, commerce-platform`),
   then `sudo ./svc.sh install && sudo ./svc.sh start`.
4. Copy [docker/docker-compose.prod.yml](docker/docker-compose.prod.yml) and
   [docker/ec2-deploy.sh](docker/ec2-deploy.sh) to the EC2 deploy directory.
5. Set GitHub Secrets: `AWS_REGION`, `ECR_REGISTRY`, `AWS_ROLE_ARN` (or
   `ECR_AWS_ACCESS_KEY_ID`/`ECR_AWS_SECRET_ACCESS_KEY`), `EC2_DEPLOY_DIR`, and the app env vars
   listed at the top of the workflow file (`COMMERCE_DB_HOST`, `STOREFRONT_API_KEYS`, etc.).
6. Point Postgres/Redis at either a new instance or the existing `commerce_db` — needs a
   decision on whether this stack shares the `josh` DB host or gets its own.
7. First run: Actions → Run workflow → `deploy_service=all`, `skip_deploy=true` to test the
   build/push only, then run again with `skip_deploy=false`.

Domain routing (e.g. `commerce.joshapp.io`) and TLS aren't set up yet — `docker-compose.prod.yml`
publishes each service's port directly on the host for now.

## Notes

- `apps/backend` in the `josh` monorepo has the only network-facing coupling to this service
  (`apps/backend/src/app/commerce-platform/commerce-platform.client.ts`), over HTTP only.
