# Commerce-admin combined-tree navigation and design review

The subsequent [release preparation](release-2026-10-09/README.md) reconciles current master7a6eae6 and records fresh local checks. Production deployment remains blocked before dispatch by unapproved stopped-container data deletion. Original evidence below retains its reviewed e4346b7 base.

Implemented in the existing application on `redesign/admin-task-navigation-upstream`, based on exact
requested `e4346b7687c196ba4a1a8ca276e74448b90c3317`. The original checkout was clean at
`69b13b2d188d4f7fb1d9bfbe5136fa693fc0bbf9`. Before integration all task changes were preserved in
local commit `30e1f788d12665b1e5b9b785ae70dadbe8561ff1` on `redesign/admin-task-navigation`.
The target object was absent locally, so the exact SHA was fetched from the existing origin. A new
branch at that target received the snapshot through cherry-pick `dbf5fe6`, with two manually resolved
content conflicts. No destructive reset, remote push, PR, merge, deployment or production changes occurred.
[Reconciliation evidence](upstream-reconciliation.json) lists the ten reviewed commits and resolutions.
57 of 59 upstream-changed files are byte-identical; the other two preserve upstream table behavior and
all upstream translation changes while adding the authorized redesign behavior.

## Current authorized scope

The user explicitly authorized navigation/routing/behavior changes at 06:52:14 UTC on 2026-10-09,
while preserving Stitch layout, theme and styles. The 07:26 UTC instruction requires fluid available
widths. Current changes use existing tokens, typography, panel/modal structures and searchable pickers;
there are no theme/CSS changes. New skeleton/retry/form/accessible table options are opt-in. Component
class/default parity tests and current screenshots support these choices; pixel equivalence is untested.

All 175 inventoried surfaces have references: 170 fresh exports and five composed/shared patterns.
`/home` explicitly derives from Stitch's dashboard. SalesAssignment and MyWinback contain three later
routes with uncertain provenance and their source files remain unchanged. The [191-record route matrix](route-protection.md)
includes these records plus 12 new action URLs inheriting existing components. It is provenance evidence,
not a fresh all-page state/device/language validation. [Source hashes](preservation.json) compare 148
unique inventoried sources and explicit shared visual dependencies: 142 unchanged, six approved behavior changes. Router, shared
components, helpers and ResourcePage are additionally changed and visible in the full patch; wrapper-file
identity does not mean their rendered dependencies are unchanged.

The first broad visual slice was archived and undone at the earlier scope change. Its [manifest](superseded-first-slice/manifest.json),
patch, source tarball, historical checks and screenshots remain outside runtime. The current slice
selectively implements authorized behavior with original visual structures; no archive is imported.
`historical-opt-in-*` evidence also describes an earlier phase, not the current consumer migrations.

## Every-page inventory and review limits

The [complete current inventory](every-page-inventory.md) and [machine-readable evidence](every-page-inventory.json)
enumerate 205 routes/families/concrete expansions from 183 router patterns. The automated source review
reads routed leaf/direct dependencies through TypeScript ASTs, records layouts/controls/feedback/API calls,
and compares exact hashes to the expected upstream. Family summaries were inspected as part of this
read-only audit. 174 records preserve their rendered source, 23 have changed behavior with family-level
tests, three retain uncertain visual provenance, and five are routing-only aliases/catchalls.
These classifications are bounded evidence: source equality does not establish pixel equivalence or
all-state visual correctness, and family-level tests do not exercise every possible URL/record/state.
The fresh local page sweep records 724 actual Thai/English desktop/phone visits across 181 page/action records, with zero layout issues and page errors.
The first sweep’s four sandboxed-frame fixture-injection errors are preserved as failed historical evidence;
top-level fixture scoping was corrected before the complete clean rerun.

An exact outer sample alias outranks the older nested sample page; the inventory records that shadowed
route rather than claiming the older sample component is mounted. Public login/register modes, routing
containers, conditional tables, all legacy mutation rules, assistive technology and live service contracts
remain explicitly distinct from the fixture layout and action-flow evidence.

## Implemented changes

The [concrete feature mapping](../../design/admin-canonical-navigation.md) and [all 117 legacy feature records](feature-mapping.json) account for every legacy
menu destination. Canonical navigation consolidates 119 destinations into 104, preserving useful
scopes and all five JoshBackofficeActions capabilities. Each permission-filtered section initially
shows at most six primary links; Show more and search retain the remainder. Admin destination-count
badges are removed. Contextual actions live in the existing topbar and remain within viewport width.
Legacy URLs stay available; the verified sample duplicate redirects with query/hash preserved.

| Workflow | Current behavior |
| --- | --- |
| Customer service | Original styled tabs now navigate to order, sample and admin-only merge URLs; alias permissions checked before redirect; customer/product loading, error/retry and empty states |
| On-behalf orders | Recover nonsecret draft selections/lines; revalidate recovered customer identity and branch; require a fresh quote; confirm documented orderIds before success; retain confirmation and payload |
| Sample decisions | Pending approve/reject/fulfill and approved fulfill retained; confirmation and recovered notes; shared request lock across decisions; freshly verify persisted status **and note**; counts from successful API rows |
| Stock receive/count/adjust/transfer | Distinct action URLs, original task cards and owned searchable warehouse picker; count zero and signed corrections; warehouse/reserved/transfer rules preserved; applied ledger quantities required for success |
| Product/customer creation | Separate `/new` URLs in original modal/panel; required/email/options validation, inline focus and retained values; original optional-blank payload behavior; persisted ID before navigation/success |
| Staff | Separate create URL; confirmed actual temporary password shown in memory only; original reset/status/role confirmations and self-protection; lock all staff writes; authoritative account counts |
| Integrations | Separate create URL; backend length limits and payload preserved; nonsecret draft recovery; signing secret excluded from storage; confirmed ID before success |
| Product-master approval queue | Route guard before reads; loading/retry/empty states; exact requested backend result count; malformed/false counts rejected; interrupted outcomes require fresh data and reselection |

The reusable shared API includes TaskInput/Select/Textarea/MasterDataSelect, TaskForm, TaskPanelForm,
TaskSubmitButton, stale-response-safe reads and synchronous mutation guards. `stitch` appearance matches
original controls; the default task appearance has 44px controls. Named fields associate labels/help/errors,
use native constraints plus explicit structured server errors, focus the first invalid field on submit,
and support Tab/Enter. Existing shared defaults remain available. Native constraint wording follows the
browser language; custom/application copy supports Thai and English. Tables opt into a named keyboard
scroll region for localized horizontal comparison rather than document-wide overflow.

Drafts are tab/staff scoped and omit secrets. Existing unsaved guards cover Cancel/links/reload; browser
Back is not trapped, but nonsecret drafts recover on returning. In-flight locks survive SPA unmounts;
late callbacks cannot announce success or clear drafts. Pending/ambiguous writes recover as unknown,
requiring an authoritative read and explicit operator acknowledgment before retry. Read results do
not prove that a lost write failed. Backend idempotency is unchanged.

## Verification

Final receipts, exact commands and captured logs are in [current-checks.json](current-checks.json).
Heavy jobs were serialized, with one test worker. Evidence-local `.gitattributes` preserves raw patch context markers and exact Vite output; application source retains normal whitespace checks. The initial staged artifact check flagged those raw evidence spaces, and the final staged check passes with these narrow evidence rules.

| Check | Current result |
| --- | --- |
| Admin Vitest | 17 files, 272 tests passed |
| Portal Vitest | Three files, 34 tests passed |
| Backend business/relay/role regression suites | Six suites, 60 tests passed; includes upstream staff registration/auth and category-upload regressions; no database connection |
| Admin/Portal TypeScript and builds | Both passed; existing chunk warnings retained |
| Real-app Chromium runner | 46 scenarios passed, nine screenshots; intercepted local API fixtures |
| Shared component Chromium runner | Six scenarios passed, three screenshots; test-only fixture |
| Complete fixture-layout sweep | 724 views across 181 page/action records; zero layout issues and page errors; eight staff views rerun after the final count-refresh fix |
| Upstream catalog/brand/supplier workflows | 54 fixture checks passed on the combined build |
| Independent read-only review | No blocking reconciliation defect; inherited receipt/recovery gaps documented; no independent test rerun |
| Whitespace/archive boundary/source hashes | Passed; preservation evidence and 18 archived source hashes checked |
| Source patch replay | Combined patch checked against the exact upstream base in a temporary directory |

Tests cover route/deep-link/query/hash/back/forward behavior, roles and denied pre-read actions,
duplicate clicks, loading/read failure/retry, native/client/explicit server errors, invalid receipts,
business count/stock rules, success only after checked responses, authoritative counts, interrupted
cross-route writes, stale readings, unknown outcome reconciliation, empty data and mobile navigation.
Browser layouts include 320px phone, 768px tablet, 1440px desktop and 640 CSS pixels at scale 2 (a
200%-zoom-equivalent width check), Thai/English long input and contextual menu bounds. This is not an
actual browser zoom-control test. All browser `/api` requests are intercepted and unexpected APIs
fail; screenshots show fixture data and do not prove external service persistence.

Actual application captures:

- [Stock receipt and original task layout](current-app-browser/stock-receive-success-en.png)
- [Thai phone creation errors](current-app-browser/customer-phone-errors-th.png)
- [Staff receipt/password handover using fixture data](current-app-browser/staff-success-en.png)
- [Samples on Thai phone](current-app-browser/samples-phone-th.png)
- [Interrupted stock reconciliation](current-app-browser/stock-recovered-en.png)
- [English shared field errors](current-form-components/form-errors-en.png)
- [Thai shared long-label fixture](current-form-components/form-phone-errors-th.png)

## Remaining blockers and next steps

This is a coherent navigation and action-flow slice, not a redesign of the entire 104-destination app.
Remaining legacy editors/lists need feature-by-feature migration and real business workflow validation.
Screen-reader behavior, Safari/Firefox, actual service/database persistence, and complete 175-route
visual/state/device checks have not been run. Full reload/lost responses do not have exactly-once
write guarantees; operator reconciliation remains necessary.

An inherited upstream shop-catalog gap remains: bulk approval/rejection in AllProduct.tsx shows green
success on HTTP resolution and defaults missing receipt counts to zero. Its unchanged workflow is
not covered by the redesigned operational queue’s receipt/unknown-outcome guarantees. The five
backoffice live-action consumers also retain their existing implementations and still need their own
receipt/recovery acceptance; their capabilities and permissions were preserved.

The live upstream account-merge response contract could not be verified from local server code or
an authorized read-only upstream lookup (404). The adapter conservatively requires explicit
`merged: true`; confirm the documented live receipt and adjust its adapter/test before production
acceptance. Do not infer success from any arbitrary response. The newer
expected snapshot is now reconciled and its table/auth changes retained. Expand the same patterns
only after feature-specific service-contract and workflow acceptance checks. No backend/performance changes or
benchmark loads were added; the separate integration benchmark remains independent.

The [current reconciled source patch](deliverables/reconciled-implementation.patch) replays cleanly against the exact upstream in a temporary directory. [Changed-source hashes](changed-files.json) identify the validated tree. Older deliverable names and non-combined logs are historical pre-integration evidence; [the latest manifest](deliverables/latest-deliverables.json) selects the current report and bundle.

## Library delivery

Zero Library files or IDs were saved. The required bundled private batch helper failed during initial
read-only tools/list discovery, before preparation, transfer, finalization or writes. Exact sanitized
error: `library upload failed: hosted apps tools/list request failed with HTTP status 401`.
This was an authentication failure, **not** an automatic-approval/sandbox rejection. A harmless Library
read succeeded later, so this does not establish that the account is disconnected. No alternate route,
credentials or retry was used. [Delivery record](library-delivery.json) preserves the earlier five-file
batch and precise failure; the current local package supersedes that earlier opt-in batch.

The [Library SKILL.md](skill://plugin_connector_1p_1b8ff8edfc1481918b252c8277e23125/library/SKILL.md)
required “Use the bundled prepared-upload helper below” for the multiple-file operation. The coordinating
parent requested no further Library attempts. Local report, source patch, genuine screenshots and
machine-readable evidence remain in `deliverables/` for review. Secure recovery requires a fresh authorized Library batch-save session in this execution environment and explicit renewed delivery authorization, using the required bundled helper. The current no-retry instruction remains in effect.
