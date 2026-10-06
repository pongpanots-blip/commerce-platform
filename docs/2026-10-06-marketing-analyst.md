# Marketing Analyst, price intelligence and behaviour analytics

Marketing should ask in the app: “หาเทรนด์วัตถุดิบช่วง 14 วันนี้ แล้วเสนอว่าเราควรทำอะไร”. The analyst reads allowed internal tools through the actual MCP SDK, searches public web sources, retains evidence and the tools it read, and proposes actions relevant to confirmed catalog SKUs. Recommendations are drafts. Creating a Growth plan requires an explicit action; audience, prices, stock, costs and approval remain subject to the existing checks.

## Delivery scope

- Extend the existing MCP server with Growth workspace/list/detail/results/timeline, plan/task writes and review/export actions using the existing preview/confirmation mechanism and Growth services.
- In-app analyst: Thai question, area and recent period; stored report; source trace and evidence links; facts versus hypotheses; recommendations with next step, success metric and catalog SKU checks; explicit “สร้างร่างแผน”.
- MCP `market_analyse` exposes the same analysis flow to external AI clients. Reads stay available through a read-only connection; analysis and mutations require the existing write opt-in and confirmation.
- Add three screens in the existing Stitch project: Price Intelligence Dashboard, Business Analytics Dashboard and Marketing Analyst. Designs use prototype data. Existing price capture/matching logic is reused; redesigns and future analytical models are distinct from verified production functionality.

## Business Analytics features and purpose

| Feature | Business question / next action |
|---|---|
| Paid sales by SKU, category, company and branch | Where did revenue change? Investigate the specific product/customer group rather than infer a cause from a total. |
| Verified competitor price gaps | Are the same grade, pack, unit, VAT and eligibility being compared? Inspect evidence before drafting an offer. |
| GTM / shop behaviour funnel | Where do visitors stop: view_item → add_to_cart → begin_checkout → purchase? Prioritize the affected step; event counts are not paid orders. |
| Search demand and searches with no results | What are people trying to buy? Check catalog availability and content before proposing a product or landing page. |
| Cohort retention and reorder timing | Which first-purchase groups return, and which businesses passed their usual reorder interval? Draft a measured winback test. |
| Basket affinity and product mix | Which products are bought together? Propose a small bundle test; association does not prove uplift. |
| Stock runway and contribution | Can the proposed demand be served profitably? Show unavailable until stock/lead time and actual costs are sufficient. |
| Event quality and identity coverage | Can behavioural evidence support targeting? Track missing IDs, duplicates, consent and delayed events before personalization. |

The current `shop_traffic` MCP tool reads `analytics_events`, `analytics_funnel_daily` and search aggregates from the Josh replica. GTM is the collection mechanism; stored/queryable events are the analytical input. Do not assume all GTM events reach this store or that a fired purchase event represents a successful payment.

## Personalization next

Use the existing GA4 ecommerce taxonomy and server-side identity joins: anonymous device/session → authenticated user → company/branch. Keep event IDs and transaction IDs for deduplication, event time distinct from ingestion time, and channel/consent status explicit. Never merge two people solely because they share a company/device. Start with explainable interest/reorder segments, then compare personalized content against a control. Current-period views/searches, confirmed purchases and current catalog availability have separate meanings. Prices/offers are selected by the server's existing pricing and audience rules.

First verify the GTM dataLayer → GTM tag → GA4 dimension/metric registration → internal event ingestion mapping, including consent, DebugView/preview, missing values and purchase deduplication. Live tagging and a storefront personalization engine require separately authorized Josh work. This task prepares the analysis path and designs, without claiming those integrations are verified.

## Implemented boundary and validation

The public web phase receives the question, area and dates, without internal tool snapshots. The internal phase receives bounded MCP snapshots and public citations but has no web-search tool. The final structured report has no tools. Stored internal excerpts match the bounded snapshots sent to the model. Unknown evidence IDs/SKUs and facts supported only by unavailable snapshots are rejected; this validates provenance, not the truth of every AI claim. Public citation publication dates remain unverified. Web excerpts are labeled AI summaries rather than source quotations.

Configure `OPENAI_API_KEY` and `MARKETING_ANALYST_MODEL` (fallback `GROWTH_AI_MODEL`) with a model supporting Responses, web search and structured outputs. The current pilot allows three concurrent analyses per process, one per staff member, with a 30-second cooldown and 180-second deadline. Add shared limits before running several analyst replicas. Successful requests replay the immutable stored report by request ID; a changed question or owner cannot reuse the ID.

Designs are saved in the existing [Commerce Platform Stitch project](https://stitch.withgoogle.com/projects/1496073756723818126). The price, business-analytics and analyst prototypes include unavailable states, GTM versus paid-order distinctions and a personalization-readiness panel. Their example figures are not live evidence. Price capture already exists; this task does not claim the dashboard redesign, cohort/basket models or personalization engine are implemented.

Verified locally on 6 October 2026: 1,114 backend tests passed, four skipped; builds of platform/admin/portal passed; 50 OAuth/MCP checks passed with isolated staff and database; report migration down/up, persisted report ownership/replay and explicit report-to-plan citation linkage passed. Browser fixtures cover analyst retries/history/safe citations and responsive layouts; Growth editing retains `analysisId`. Live OpenAI responses, Josh replica data, GTM/GA4 tagging and production deployment remain unverified.

Run the report boundary test with `npx jest --config apps/commerce-platform/jest.config.cts --runInBand --runTestsByPath apps/commerce-platform/src/mcp/market-analyst.service.spec.ts`. `scripts/check-marketing-analyst.mjs` checks a real isolated API/database using an explicitly synthetic saved-report fixture; it does not present that fixture as an AI result.

## Sources

- [Shopify reports](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/new-analytics/new-reports): period comparisons, dimensions, cohort retention and drilldown inform the feature priorities; these are our product recommendations, not a Shopify integration.
- [Google Trends API alpha](https://developers.google.com/search/apis/trends): access requires approval; public web search is not Google Trends API or full social coverage.
- [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search) and [function calling](https://developers.openai.com/api/docs/guides/function-calling): implementation protocol and source attribution.
