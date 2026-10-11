# 2026-10-11 · commerce-admin: remove duplicate pages

Audit of all ~107 admin menu destinations for true duplicates. Most "look-alike" pages read different stores
(commerce tables vs josh) and were kept. Removed / merged (old URLs redirect, `FEATURE_HOMES` aliases keep legacy mapping):

| Removed | Now | Why |
|---|---|---|
| `/erp-ingest` (ErpIngest.tsx) | `/erp/inbound-log` | same API and UI |
| `/erp/webhook-platforms` (WebhookPlatforms.tsx) | `/subscriptions` (+ enable/disable/delete) | same `/webhook-subscriptions` |
| `/j/invoices` (InvoicesOverdue.tsx) | `/j/billing` (overdue list of all companies until one is picked) | subset |
| `/j/active-offers` (ActiveOffersAdmin.tsx) | `/prices/staff` | read-only subset |
| `/j/marketing-links` (MarketingLinksPage.tsx) | `/j/smart-links` | smart links do more; inline link fields kept |
| josh CompetitorPricesPage + 3 helpers | — | dead: app.tsx `/j/marketing/competitor-prices/*` always matched first |

Also: `/j/marketing/workflows` (josh `ADMIN_ROUTES.marketingWorkflows` links) redirected to `/marketing/workflows` (was landing on `/`).
`/products` menu text no longer claims product approval. Welcome Lead Email page untouched.

Kept on purpose: `/products` vs `/j/allproducts` (commerce vs josh store), shadow tools (stage 7), credit notes/backs, staff vs josh-staff.

Verify: `npx vitest run src` in apps/commerce-admin → 881 pass; fails: task-navigation.spec "does not grant inaccessible indexes"
(pre-existing on 3e0133a) and an app.spec timeout under load (passes alone). `vite build` ok.

## Part 2 · feature groups (same day)

`FEATURE_GROUPS` (navigation.ts): 28 groups of pages that do one job. A section's task index shows one card per
group with a link to each member (admin: 109 cards → 41), and every member page gets the same tab strip on top
(`FeatureTabs`, rendered once in CommerceWorkspace; not on the Welcome Lead Email page). Routes, permissions and
⌘K search unchanged; a role sees only members it may open. Checked in the browser at 1400px and 375px.
Spec: `app/feature-groups.spec.tsx`.

## Part 3 · design system and every page (same day)

- #142: one brand colour (josh Tailwind primary/blue/alert → tokens), page vs card depth (shadow-card), status tokens,
  table polish. `design.md` at the repo root is the locked system; its "Page rules" are the checklist for any page.
- #144 + #145: every admin page brought to the page rules by section (raw codes → labels, lists first, Thai headers,
  StatusChip, right-aligned numbers, confirms on destructive actions, detail pages with KeyValueGrid), ~1,500 new TH/EN
  strings. No API call, route or permission changed. Welcome Lead Email untouched (outside the shell theme, stays blue).
- How it was checked: tsc, full vitest (only the pre-existing task-navigation failure), portal tests, build, a scan
  that every token class used in josh files exists in the built CSS (josh-admin is outside the Tailwind v4 scan), and
  a browser pass against a local mock API. The workflow editor internals were not opened in a browser.
