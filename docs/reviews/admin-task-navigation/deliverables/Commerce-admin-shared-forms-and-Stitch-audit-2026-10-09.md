# Shared form components and Stitch protection audit

Branch: `redesign/admin-task-navigation`. Actual base:
`69b13b2d188d4f7fb1d9bfbe5136fa693fc0bbf9`; requested snapshot:
`e4346b7687c196ba4a1a8ca276e74448b90c3317`. The read-only GitHub
[comparison](base-comparison.json) confirms the requested snapshot is ten commits ahead,
zero behind, with the actual base as merge base. No reset or upstream integration occurred.
Reconciliation must preserve its newer table/UI, login and backend changes.

## Current scope and preservation

The user's latest instruction excludes anything already designed by Stitch. All 175 inventoried
routes have documented references: 170 fresh exports and five shared/composed patterns. `/home`
explicitly derives from the Stitch dashboard. SalesAssignment and MyWinback were added after that
inventory; three routes using these two components have uncertain provenance and remain held.
There are **zero confirmed eligible existing-page consumers**.

The [route matrix](route-protection.md) and [JSON](route-protection.json) separate evidence from
unrun browser dimensions. This is a complete provenance inventory, not a fresh visual review of every
route/state/device/language. Existing historical route validation was not rerun or claimed as ours.

The first navigation/CS/queue slice was archived and undone after this scope change. Its mapping remains
a [superseded proposal](../../design/admin-canonical-navigation.md), and its patch, added sources,
test record and four screenshots are in [superseded-first-slice](superseded-first-slice/manifest.json).
Those images do not represent the current branch. The [preservation check](preservation.json) confirms
150 protected source/reference files are byte-identical to HEAD. Shared index changes only add exports;
existing Input, Select, Loading, FormPanel, sidebar, theme, fonts, routes and permissions retain their
implementations. No global token, CSS or protected consumer replacement was made.

## Implemented opt-in API

The real shared library now provides `TaskInput`, `TaskSelect`, `TaskTextarea`, `TaskForm` and
`TaskSubmitButton`, exported through `@cp/ui`. Existing controls are unchanged.

| Component | API and behavior |
| --- | --- |
| `TaskInput` / `TaskSelect` / `TaskTextarea` | Native attributes and forwarded ref; `label`, `help`, `error`, `loading`, `loadingMessage`, `fieldClassName`; associated unique IDs; required native semantics; merged `aria-describedby`; inline `aria-invalid` errors; enabled/disabled/loading states; controlled or uncontrolled values |
| `TaskForm<Receipt>` | Localized `messages`; optional `validate(FormData)` returning field-name errors; async `onSubmit(FormData, AbortSignal)`; optional `onSuccess(receipt)`; native constraints plus actionable custom copy; synchronous duplicate lock; field and network errors kept separate |
| `TaskSubmitButton` | Native submitter name/value; disables during submission; 44px minimum target and visible focus |

`onSubmit` returns `{ok:true, receipt, message?}` only after its API adapter confirms persistence and
business success, or `{ok:false, fieldErrors?, formError?}`. A missing/null receipt, explicit false,
rejection or malformed result produces failure, never success. The component cannot establish real
external persistence itself: each consumer must validate its service response. Map server field names
explicitly only where its existing contract supplies structured errors; unknown fields fall back to a
form-level failure. No API contract or backend code was changed.

Values are never reset on failure or success. Submit focuses and scrolls the first invalid control;
typing corrections do not move focus. Existing client cross-field errors are recomputed, while
unrelated server errors remain until their field is corrected or the form is submitted again. Required
loading selects block submission. Unmount aborts the signal and suppresses subsequent success callbacks.
This does not provide server idempotency or recover a request after reload; consumers must reconcile
authoritative state for interrupted writes.

**Consumer coverage:** no production route is migrated. The only consumer is the checked-in browser
validation fixture under `apps/commerce-admin/e2e/fixtures/`. It exists to exercise the shared code,
not as a replacement application or a claim that existing workflows are redesigned.

## Validation and screenshots

All final checks passed on 2026-10-09, serialized with one test worker:

| Check | Verified result |
| --- | --- |
| Admin and Portal TypeScript | Both passed |
| Full Admin Vitest | 12 files, 187 tests passed; includes 20 new form tests |
| Admin and Portal production builds | Both passed; existing large-chunk warnings remain |
| Chromium component browser runner | 6 scenarios, 3 screenshots, 4 intercepted fixture submissions, zero page errors |
| Source preservation | 150 protected files byte-identical to HEAD; shared index only adds exports |
| Independent read-only review | No remaining blocking component defect after fixes; see [review](independent-review.md) |
| Tracked diff whitespace | Passed |

[Serial check receipts](current-checks.json) and browser results record the current runs. The new tests
cover native/custom client and structured server validation, multiple invalid fields, correction focus,
dependent errors, blank/unknown errors, controlled/select empty values, disabled/loading behavior,
native submitter data, duplicate submissions, failure/retry without lost values, missing receipts,
aborted unmounts and FormData failure recovery. Browser checks add actual Tab/Enter/select keyboard
behavior and long Thai label wrapping/44px controls/no horizontal overflow on phones.

All browser API responses are intercepted local fixtures; no service/database/prod calls were made. Screen-reader
announcements have not been tested with assistive technology.

- [English inline errors](current-form-components/form-errors-en.png)
- [English confirmed fixture response](current-form-components/form-success-en.png)
- [Thai long labels and inline errors on phone](current-form-components/form-phone-errors-th.png)
- [Machine-readable component browser results](current-form-components/results.json)

These are actual browser captures of the repository's shared components in a test-only consumer.
They are neither Stitch reference assets nor screenshots of redesigned protected pages.

## Reproduce

Run heavy jobs sequentially from the repository root:

```sh
./node_modules/.bin/tsc -p apps/commerce-admin/tsconfig.app.json --noEmit
./node_modules/.bin/tsc -p apps/commerce-portal/tsconfig.app.json --noEmit
./node_modules/.bin/vitest run --config apps/commerce-admin/vite.config.mts --maxWorkers=1 --no-file-parallelism
./node_modules/.bin/vite build --config apps/commerce-admin/vite.config.mts
./node_modules/.bin/vite build --config apps/commerce-portal/vite.config.mts
./node_modules/.bin/vite --config apps/commerce-admin/vite.config.mts --host 127.0.0.1 --port 4405 --strictPort
# Separate terminal, after builds have finished:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/chromium node apps/commerce-admin/e2e/task-form-components.mjs
```

## Scope blocker and next decision

Stock receive/count/adjust/transfer URLs, resource/staff/integration creation URLs, CS task URLs,
canonical navigation, authoritative action badges and reusable read skeletons all touch protected
surfaces. They are held, not completed. Clarify whether the exclusion freezes their behavior/navigation
as well as visual designs, and whether SalesAssignment/MyWinback are eligible. Do not infer an exception
from absent exports or newer source alone. After clarification, migrate permitted consumers to these
central components, preserving backend payloads, permissions, draft recovery and authoritative success.

The other agent's integration performance audit is independent and starts from the newer `e4346b7`
snapshot. This branch made no backend integration/performance changes or benchmark loads.
No push, PR, merge, deployment or production changes occurred.

## Library delivery blocker

The required batch-save route failed authorization in this selected environment before preparation
or any file write. A harmless Library read succeeded, so this does not establish that the user's Library
is disconnected. **Zero files were saved and zero Library IDs are confirmed.** The report, evidence ZIP
and three current screenshots remain available in the local `deliverables/` package and the screenshot
directory. [Delivery record](library-delivery.json) preserves the precise outcome.

The [Library SKILL.md](skill://plugin_connector_1p_1b8ff8edfc1481918b252c8277e23125/library/SKILL.md)
requires “Use the bundled prepared-upload helper below” for multiple files when both prepared tools
are available. Its required batch route was used and was not replaced with a different upload workflow.
Complete delivery from a working authorized batch-save environment, or have the coordinating parent
resolve an explicitly authorized fallback. No credentials from other tasks were sourced to work around it.
