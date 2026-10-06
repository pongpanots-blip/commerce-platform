# Growth planning implementation — 6 October 2026

Commerce now stores campaign plans with evidence, AI copy drafts, human tasks, revision history and admin approval. An approved revision can be exported to the existing Josh engine as a stopped workflow draft. Editing campaign content invalidates its approval.

## Implemented

- Growth Workspace reads paid sales, cart snapshots, reorder observations and workflow failures from the configured Josh replica. Missing sources remain unavailable instead of showing sample values.
- Plan studio supports cart recovery, reorder, winback and market briefs; audience/exclusions, product SKUs, schedule, budget, margin target, holdout and cooldown; two copy variants; explicit Apply and Save for AI suggestions.
- Stored Research reports can seed plans with their original scope, coverage, limitations and evidence links.
- Review queue, server-paginated plan list and Bangkok calendar; owner/admin mutations and admin-only approval; optimistic revision checks backed by database row locks.
- Company timeline and human tasks; campaign funnel and paid-order attribution. Contribution remains unavailable without verified costs. Experiment reports disclose enrollment-level randomization and conversion limitations.
- Draft export uses approved plain notification copy. Ambiguous remote writes enter `export_unknown`; admin reconciliation checks the graph, audience, schedule and notification copy before attaching an existing draft.

## Deployment prerequisites and limits

Apply `1793900000000-GrowthPlans.ts` with the existing migration command before serving the new routes. The Growth integration module follows the repository dependency direction and shares type declarations through `@cp/growth`.

Configure `JOSH_DATABASE_URL` for observations, `JOSH_API_URL` and `JOSH_EVENTS_SECRET` for draft export, and `OPENAI_API_KEY` plus `GROWTH_AI_MODEL` for AI drafts. AI output has no tools or sending capability. Without these providers, manual planning and approval remain available.

**Live campaign activation is blocked at the Commerce action boundary.** The Josh engine still needs send-time stock/margin/budget checks, channel consent and aggregate frequency enforcement, plus company-stable holdout and reliable conversion accounting. Direct actions in a separate Josh application are outside this boundary. No Josh repository changes or production deployment are included here.

## Validation

- Full backend Jest suite: 139 passed suites, 1 skipped; 1,086 passed tests, 4 skipped; 6 snapshots passed.
- Nx builds: commerce-platform, commerce-admin and commerce-portal passed. Existing admin bundle-size warnings remain.
- Isolated PostgreSQL database: all 24 migrations applied; Growth rollback/reapply passed.
- `scripts/check-growth.mjs`: real local API persistence, idempotency, owner/admin restrictions, concurrent stale edits, approval invalidation, unavailable providers and Bangkok-month pagination passed. It requires an isolated localhost API and test accounts `growth-admin@example.test` and `growth-marketing@example.test`; set `GROWTH_CHECK_PASSWORD` to their password.
- `ADMIN_URL=http://127.0.0.1:4414 node apps/commerce-admin/e2e/growth.mjs`: deterministic browser fixtures exercise planning, explicit AI application, tasks, review/approval, draft export/reconciliation, Research handoff, results, retry states, 241-plan pagination, calendar and mobile layouts. Screenshots in `.e2e-out/growth/` use test data.
- The actual localhost UI was inspected against the isolated database. OpenAI and Josh draft writes were verified with controlled test responses, not live provider calls.

Design source: [existing Stitch project](https://stitch.withgoogle.com/projects/1496073756723818126). Product scope: [workflow and AI recommendations](2026-10-06-commerce-workflow-ai-recommendations.md).
