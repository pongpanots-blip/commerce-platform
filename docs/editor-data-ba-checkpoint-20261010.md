# Editor, product evidence, MER comparison and guided analysis checkpoint

Local review branch: `feature/editor-data-ba-checkpoint-20261010`. Preserved editor `1795e13` was merged normally with master `818508d` at `5cac03a`; neither branch was reset. No push, PR, deployment or production business operation is authorized by this checkpoint.

## Feature and URL mapping

| Task                                      | Canonical menu entry             | Action pages                                                                               | Scope retained                                                                                                 |
| ----------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Inspect and edit native unit prices / MOQ | Product prices `/product-prices` | `/product-prices/current`, exact-SKU inspect, `/edit`, `/review`, original request outcome | Existing admin/MER authority; ERP proposal approval and customer contract prices remain separate capabilities. |
| Inspect recorded cost, units and stock    | Product price inspection         | Read-only `GET /product-evidence/:sku`                                                     | Admin/MER only; recorded facts, missing contracts and ambiguous identity are explicit.                         |
| Compare reference prices                  | `/j/marketing/competitor-prices` | Existing capture, verification and request recovery pages                                  | MER gains reference capture and human match verification only.                                                 |
| Guided branch behavior analysis           | `/analysis/customer-behavior`    | `/templates/:id`, `/preview`, `/evidence`; numeric criteria in query                       | Admin/BA read-only; original validated templates and three-valued unknown semantics.                           |

Old deep links remain. Different scope capabilities were not declared duplicates. This checkpoint completes a bounded native-price editor and evidence slice; it does not replace the whole product form or complete advanced BA journeys, personalization or daily trends.

## Exact MER access change

- Workspace GET and canonical menu now include merchandising.
- Workspace actions validate the entire packet and allow MER only `capture` and `verify`, before service/vendor calls.
- Only legacy GET `review`, `overview`, `overview/export`, `suggestions/:catalogItemId` gain MER.
- Source creation/reassignment/settings/refresh/deletion, packaging/review markers and selling-price activation/approval rules retain prior authority.
- Pack planning has its original explicit admin/marketing/BA route policy; comparison access no longer implicitly grants it.
- UI direct actions, batch packets, retained requests and recovery use per-operation capabilities. Late successful commits preserve the original request until its validated receipt renders.

## Existing source adapters and limits

| Evidence                       | Source                                                                       | Limit                                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native prices                  | `product_prices` with price ownership enabled                                | Explicit nulls are authoritative; no delayed catalog fallback. Currency/tax normalization is absent.                                                         |
| Stored cost                    | `product_contents.fields.buying_price`                                       | Currency, cost UOM, tax and field observation time are absent. Disabled ownership labels archived native records.                                            |
| Selling/ordering unit and pack | Approved `product_masters.fields` when owned; otherwise one catalog snapshot | Missing/null native fields stay missing. Pending master proposals are excluded; no conversion inferred.                                                      |
| Stock                          | `products` identity + `inventory_levels` + warehouse ownership/sellability   | Duplicate SKU or missing organization scope is unavailable; no stock UOM/observation contract, no aggregate guess. Stored timestamps do not prove freshness. |
| Existing comparison planning   | Delayed catalog copy                                                         | Still explicitly unverified; normalized actual cost is unavailable. This checkpoint does not silently replace monetary planning rules.                       |

The evidence endpoint uses parameterized SQL in a read-only repeatable-read transaction. It excludes organization-scoped levels/warehouses where no trusted scope exists. Cost is not attached to marketing/BA comparison responses.

## Guided BA boundary and next slice

The registered pages use existing `approved_without_order` and `repeat_buyers_inactive` definitions, bounded AST semantics, confirmed-order identity, complete-history proofs and unknown membership. The production module has no source provider: counts and evaluation time stay null. Request capture time is not source freshness. Owned synthetic evaluation is available only through a test-only injection; production cannot turn fixture results into live audience counts.

Required next contracts: branch approval/birth/eligibility, canonical order acceptance and occurrence identity, server tenant/branch grants, complete-history/late-arrival watermarks, consent/retention/deletion and a trusted live projection. Personalization/daily-trend metrics need their own contracts. Journey work remains draft/preview only, with no contact/export/notification activation.

User UI acceptance is pending. Local intercepted browser fixtures verify interactions and screenshots; they do not establish production persistence or live audience accuracy. Native PostgreSQL tests separately verify transaction, receipt, source and membership behavior. See `/workspace/commerce-editor-checkpoint-20261010` for exact run logs/results and the final checkpoint result.

## Verified checks

- 366 tests across 14 selected backend suites, all passed without skips; these include 83 native PostgreSQL cases in owned synthetic databases.
- 283 tests across 11 selected frontend files, all passed, with one worker and file parallelism disabled.
- Nine local editor browser scenarios passed, covering actual app task routing, recovery, duplicate clicks, persistence-only success, 320px navigation and keyboard access. Three real local screenshots were captured.
- Sixteen guided-analysis browser checks passed against the built app and default controller/service, including eight roles, retry, URL history, English/Thai keyboard flows and 390/1920/2560 widths. No BA screenshot was captured.
- Admin typecheck, platform TypeScript compilation, admin production build and diff whitespace checks passed. The existing bundle-size advisory remains.

These are selected-scope results, not a claim that every repository test or production workflow was exercised. Final real UI acceptance remains with the user. The owned PostgreSQL container and preview server were stopped after verification.
