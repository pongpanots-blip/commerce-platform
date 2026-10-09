# Reference review for eligible future surfaces

Read-only review on 2026-10-09. These are reference principles and proposed applications, not evidence
that protected commerce screens were changed. Existing Stitch palette/fonts/tokens remain untouched.

| Official source | Relevant principle | Proposed application after eligibility is confirmed |
| --- | --- | --- |
| [Linear design refresh](https://linear.app/now/behind-the-latest-design-refresh) | Supporting navigation should carry less visual emphasis than the active work; soften unnecessary structure | A quiet page header and predictable task actions; consolidate only verified same-scope features |
| [Shopify index table](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/index-table) | Collections need search, filters, sorting, pagination and bulk selection | Lead with records and preserve useful scoped actions; add accessible responsive presentation rather than dropping capabilities |
| [SAP cozy/compact density](https://www.sap.com/design-system/fiori-design-web/v1-120/foundations/visual/cozy-compact) | Density should match input methods and working context | Compact working lists with comfortable touch controls on phones; avoid rigid desktop density everywhere |
| [Stripe communicating state](https://docs.stripe.com/stripe-apps/patterns/communicating-state) | Communicate progress, success and problems clearly with contextual feedback | Pending feedback, field errors, separate form/network failure, and success only after an actual API confirmation |
| [Stripe empty state](https://docs.stripe.com/stripe-apps/patterns/empty-state) | Empty states should explain the situation and provide a useful next step | Separate no data, filtered no match and failed reads; provide create/reset/retry where appropriate |
| [WCAG 2.2 target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | The AA criterion requires 24×24 CSS pixels or a qualifying exception; larger targets help touch/motor access | New opt-in form controls use a 44px minimum height as a design choice, not a claim that 44px is this criterion's AA minimum |

Our specific 14/22 working typography, 24/32 headings, 4/8/12/16/24/32 spacing, 44–48px working rows
and restrained panels are implementation recommendations from this audit. They are not quotations
or universal mandates from the references. Apply them only to explicitly eligible opt-in surfaces.

The current controls validate long Thai wrapping, native keyboard access, associated inline errors and
phone width. The per-route matrix explicitly marks the larger loaded/long/empty/loading/failure and
create/edit/detail visual review dimensions as unrun in this session.
