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
