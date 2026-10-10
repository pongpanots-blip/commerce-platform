# Admin features from the nopCommerce + Shopify research — audit log, scheduled tasks, saved views, company terms

Research: `docs/research/2026-10-10-nopcommerce-shopify-admin-gap.md` (#125). The user picked items 1, 2, 3 and 5 (5 cut down to terms + company prices). Items 4, 6, 7, 8, 9 and 10 were dropped.

## Shipped (all in prod)
- **#126 Audit log viewer.** `GET /audit-logs` + `/facets` (admin only) and the `/settings/activity-log` page.
  - Filters live in the URL. Reads (`mcp.tool_call`, GET through the josh relay) are hidden unless `includeReads`.
- **#127 Scheduled tasks.**
  - `@ScheduledCron` / `@ScheduledInterval` (`shared-kernel/infrastructure/scheduled-task.ts`) replace `@Cron` / `@Interval` at all 21 sites.
  - `TaskAwareLogger` (set in `main.ts`) flags a run as a problem when the job logs a warn or error.
  - `GET /scheduled-tasks` and `POST /scheduled-tasks/:name/run` (admin only, audited) back the `/scheduled-tasks` page.
- **#134 Saved views + column chooser.** `useTableViews` / `TableViewBar` next to the josh `Table`, plus a `hiddenKeys` prop.
  - Wired on `/j/order`, `/j/allproducts`, `/j/allusers` and `/j/company`.
- **#136 Company terms & prices.** `CompanyTermsPrices.tsx` on `/reports/customers/:id`, covering:
  - the credit term with presets, saved through the josh customer update (admin only)
  - branch terms, read-only
  - an open-application warning
  - company and branch staff prices (merchandising and admin only)
- **#128 / #129:** release-policy approval of `CommerceMarketingWorkflows1796300000000`, then the deployed tags.
  - Platform and admin went out at `5d258a7` in runs 38066041052 and 38066649210.
  - Admin went out at `3e0133a` in run 38073192223.
- **Follow-ups (this PR):**
  - The `/j/order` export CSV button now works; `@cp/ui` `downloadCsv` is shared with JoshCommerce.
  - The post-deploy gate accepts the release's own platform tag.
  - Admin `3e0133a` is recorded in `deployedTags`.

## Known limits / next
- **Scheduled-task run state is in memory.** It resets on deploy and assumes one platform container.
- **`audit_logs` has no `created_at` index.** Add one (migration + release approval) when the page gets slow.
- **Saved views are per user and per browser** (localStorage). Shared views need a table.
- **No per-company catalog.** It needs Josh storefront work.
- **Branch credit terms are read-only.** It is unknown whether Josh's branch update accepts `credit_term`.
- **Orders export runs client-side and caps at 5000 rows.**
- **Two tests already fail on master** (`replica-readers.spec.ts`, `task-navigation.spec.ts`). They are tracked as a separate task.
- **The gate's "shell preflight" test fails only on macOS**, because bash 3.2 lacks `${var^^}`. CI runs it on ubuntu.
- **Release prep:** the post-deploy check no longer needs the release's own platform tag in `deployedTags`. Admin and portal tags deployed outside a platform release still have to be recorded before the next platform deploy.
