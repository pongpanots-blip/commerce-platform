# Canonical commerce-admin navigation and action flows

The current branch implements this mapping in the existing application. Navigation, routing and
behavior changes were explicitly authorized on 2026-10-09 at 06:52:14 UTC ("อนุญาติ"); Stitch
layout, theme and styles remain the visual reference. The 07:26 UTC instruction adds fluid responsive
layout requirements. The earlier archived task-directory implementation is not restored.

Branch: `redesign/admin-task-navigation`. Actual base: `69b13b2d188d4f7fb1d9bfbe5136fa693fc0bbf9`.
Expected `e4346b7687c196ba4a1a8ca276e74448b90c3317` is ten commits ahead, zero behind; no reset or
integration occurred. Reconcile its newer tables, login and backend changes before merging elsewhere.
No AGENTS.md or local SKILL.md was found in the checkout or available `.agents` / `.codex` directories.

## Implemented feature mapping

| Feature | Canonical menu entry | Retained actions, URLs and scope |
| --- | --- | --- |
| Customer service | `/cs` | Opens `/cs/orders/new`; original tab styling links to `/cs/samples` and admin-only `/cs/accounts/merge` |
| Sample requests | Customer service → `/cs/samples` | `/j/cs/sample-requests` redirects preserving query/hash; `/cs/samples/:id/:decision` opens the confirmation action |
| Stock movements | `/stock-moves` | Opens `/stock-moves/receive`; distinct `/count`, `/adjust`, `/transfer` actions preserve original task cards and business rules |
| Operational products | `/products` | `/products/new` opens the existing creation modal; merchandising/admin permission checked before reads |
| Contact records | `/customers` | Admin-only `/customers/new` opens the existing creation modal |
| Staff | `/settings/staff` | Admin-only `/settings/staff/new`; actual temporary-password handover remains in memory |
| Integrations | `/integrations` | Admin-only `/integrations/new`; secrets excluded from recovered drafts |
| Coupons | `/j/coupons` | `/josh/coupons` retains masked-record activation actions under “Other actions” |
| Suppliers | `/j/suppliers` | `/josh/suppliers` retains create/edit actions under “Other actions” |
| Credit applications | `/j/credit-terms` | `/josh/credit_terms` retains review/approval actions |
| Admin access | `/j/admin-access` | `/josh/admin_access` retains approval/role assignment |
| Shipments | `/j/shipments` | `/josh/shipments` retains its data-copy view |
| Payments | `/j/payment-transactions` | `/josh/payments` retains its data-copy view |
| Credit notes / credit backs | `/j/credit-notes`, `/j/credit-backs` | Corresponding `/josh/credit_notes`, `/josh/credit_backs` remain accessible |
| Invoices | `/j/invoices` | `/josh/invoices` remains accessible; `/j/billing` retains its different company/billing scope |
| Campaigns / segments / identity checks | `/j/promotions/campaigns`, `/j/segments`, `/j/kyc` | Corresponding `/josh/campaigns`, `/josh/segments`, `/josh/kyc` data-copy views remain accessible |
| Internal documents | `/josh/internal_docs` | Independent live create/delete capability remains in Settings |
| Add storefront product / import orders | Product/order feature actions | `/j/product/create`, `/j/order/import` remain routable and permission filtered |
| Operational products / shop catalog / product reports | `/products`, `/j/allproducts`, `/reports/products` | Separate responsibilities and role policies retained |
| Operational orders / storefront orders / order reports | `/orders`, `/j/order`, `/reports/orders` | Separate operational, storefront and reporting scopes retained |
| Contact records / companies / customer reports | `/customers`, `/j/company`, `/reports/customers` | Separate scopes retained |

The menu has 104 destinations, down from 119, by consolidating 15 verified aliases and contextual
create/import actions. Tests account for every legacy destination through a canonical menu entry or
an accessible feature action. Legacy deep links remain; only the verified sample duplicate redirects.
Data-copy routes are not redirected into live-only pages. Permissions are checked on the requested URL.

After role filtering, each sidebar section exposes at most six primary links. The rest remain under
Show more and menu search. Destination-number badges are removed from admin: they counted pages,
not completed work. Sample counts come from the returned request state, staff counts from returned
accounts, and queue feedback uses the exact backend approved/rejected count. Unknown/loading/error
states never invent a zero or completed status. Topbar contextual actions wrap within available width.

## Implemented interaction patterns

`TaskForm`, `TaskPanelForm`, named fields and the original searchable master-data picker provide
inline native/custom/explicit structured-server validation, focus on the first invalid field, keyboard
submission, duplicate locks and async abort handling. The opt-in `stitch` appearance preserves original
Input/Select sizing, field hints, typography and panel/modal structure. Default shared components retain
existing behavior; skeleton and retry options are additive.

Task drafts are scoped to the tab and staff identity. Secrets and temporary passwords are never saved.
Cancel/links/reload use the existing unsaved guard; browser Back is not trapped, and nonsecret values
recover on returning. An in-flight write remains locked across SPA route changes. Interrupted or
ambiguous outcomes require a fresh authoritative read and explicit operator acknowledgment before
retry. Stock actions share a lock; sample decisions share a request lock; staff mutations share a lock.
This does not provide server idempotency or prove that a lost response means the write failed.

Success requires a contract-specific receipt: applied stock ledger quantities, persisted resource IDs,
actual staff password response, documented orderIds, exact queue count, or freshly verified sample
status and submitted note. Merge success currently requires explicit `merged: true`; the live upstream
merge response contract remains unverified and must be confirmed before production acceptance.

## Remaining breadth and verification limits

This is a navigation consolidation plus implemented CS, stock, product/customer creation, staff,
integration and product-master queue slice. The remaining legacy workflows still need business-specific
migration and usability checks. The 175-route Stitch inventory is provenance evidence, not a fresh
all-page visual/state/device validation. SalesAssignment/MyWinback provenance remains uncertain;
their source files are unchanged. Browser APIs use intercepted fixtures; external persistence,
exactly-once writes, screen-reader behavior and Safari/Firefox are not verified.

See the [current review and evidence](../reviews/admin-task-navigation/README.md) for actual final
checks, screenshots and blockers. No push, PR, merge, deployment or production data changes occurred.
