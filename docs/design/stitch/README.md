# Stitch redesign — implementation guide

Design source: Stitch project "Commerce Platform — Admin + Portal refresh". Exported screens (HTML + PNG) are in this folder:

| File | Template it defines |
|---|---|
| `admin-overview.*` | Shell (sidebar + top bar), stat cards ("Needs attention" accent cards, "Data" cards), two-panel row with compact table and list |
| `admin-list-table.*` | List page: breadcrumb header + title badge + actions, filter panel (search, segmented status, date, select, clear, active filter chips, result count), table panel (sticky header, 40px rows, mono IDs, two-line cells, right-aligned money, status chips, status dots), footer pager |
| `portal-dashboard.*` | Portal shell, checklist panel, summary panels with icon heads, recent-deliveries table, docs side card with code block, info card |
| `portal-api-keys.*` | Success banner with one-time secret + copy, table with scope chips, revoked (muted) row, footnote hint |

## Rules

1. **Build every page from `@cp/ui`** (`libs/ui/src/index.tsx`): `Page`, `PageHeader`, `TitleBadge`, `Panel`, `PanelHead`, `SectionTitle`, `StatGrid`/`StatTile`, `Segmented`, `SearchInput`, `Input`/`Select`/`Textarea`/`Field`/`Checkbox`/`TogglePill`, `FilterChip`, `Table`/`THead`/`TH`/`TBody`/`TR`/`TD`/`Stack2`/`ExpandRow`/`ExpandToggle`, `Pager`, `Chip`/`StatusChip`/`StatusDot`/`Count`, `Button`/`ButtonLink`/`ArrowLink`/`IconButton`, `Alert`/`ErrorText`/`Empty`/`Loading`/`Hint`, `CodeBlock`/`CopyValue`, `BarList`/`StackedBars`, `FormPanel`/`Span`, `KeyValueGrid`, `DetailSection`, `DetailPanel`, `Modal`, `Icon` (Material Symbols names), `fmt` (num/baht/when/date/ago).
   Reference implementation: `apps/commerce-admin/src/app/pages/Dashboard.tsx`.
2. **No legacy classes** on redesigned pages (`panel`, `btn`, `badge`, `stat`, `page-head`, `hint`, `err`, `empty`, `row`, `field`, `pre.payload`, …) and **no `style={{}}`** except data-driven widths/heights. Use Tailwind utilities with the Stitch token names (`bg-surface-container-low`, `text-on-surface-variant`, `border-secondary-container`, `text-primary` …). `legacy.css` is deleted once every page is migrated.
3. **Same look everywhere**: page = `<Page>` → `<PageHeader crumbs={[group, page]} …/>` → filter `Panel` → table `Panel` with `Pager` footer. Tiles that filter a list are `StatTile onClick selected`. Expandable rows use `ExpandRow` + `CodeBlock` for JSON. Status text → `StatusChip` (tone from `toneOf`), override tone where the meaning is known. Money: `TD kind="money"` + `fmt.baht`. IDs/codes/SKUs/routes: mono. Breadcrumb first crumb = the sidebar group label.
4. **Behaviour is unchanged**: same API calls, params, actions, confirms, polling, URL params. Do not drop features. Thai/English copy stays as it is today (fix typos only).
5. **"Exactly like Stitch" includes the extras the screens show** (secondary figures under tiles, recent-activity panels, counts in segmented filters, result counts, page-size selector …). Fill them with **real data** — derive from data the page already loads, or add a small backend field/endpoint in the module that owns it (NestJS, with a unit test next to the service). Never show invented numbers.
6. Keep pages accessible: buttons are `<button>`, icon-only buttons have `title`/`aria-label`, inputs have labels (`Field`), tables keep `<th>`.
7. **Create / edit forms and detail views are part of the redesign, not optional.** Every "+ New / สร้าง / แก้ไข" form → `FormPanel` (title + icon + description, `Field` grid, `Span` for wide fields like JSON `Textarea`, footer Cancel + primary Submit, errors as `Alert`). Every detail (expanded row or record panel) → `ExpandRow` / `DetailPanel` containing `DetailSection`s: a `KeyValueGrid` of facts first, then sub-tables (`Table` inside), then `CodeBlock`s for payloads, with record actions in the section/panel header. Inline row editors use the same `FormPanel` (cols 2–4) inside the `ExpandRow`.
8. Verify: `./node_modules/.bin/tsc -p apps/commerce-admin/tsconfig.app.json --noEmit` (and portal) must be clean.

## Detail pages

A record opens on its own page (own URL), never an expanded row: `/reports/orders/:id`, `/reports/customers/:id`,
`/reports/products/:id`, `/orders/:id`, `/customers/:id`, `/products/:id`. Lists link the identifier cell with
`RowLink` (a real link — ctrl/cmd-click, keyboard) and keep filters/paging in the query string so going back
restores the list. Detail pages use `PageHeader back={…}` and the same `KeyValueGrid` / `DetailSection` / table parts.

## Checking a change

```bash
npm run seed:mock                         # local mock data + logins in scripts/.mock-credentials
node apps/commerce-admin/e2e/pages.mjs     # every admin + portal page and detail page; screenshots in .e2e-out/screens
```

The page e2e fails on console errors, 5xx responses, horizontal overflow, a missing `<h1>`, legacy CSS classes,
list rows without a detail link, and detail pages without a back link. Look at the screenshots too — it can't judge looks.
