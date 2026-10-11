# Design — Commerce admin

The design system for every commerce-admin page, including the josh pages copied into `src/josh-admin`.
Read this file before changing any page's look. If a page needs something this file doesn't allow, change
this file first; don't override it on one page.

## Genre
Modern-minimal (a B2B back office). Calm surfaces, one brand colour, and status colour only when it means something.

## Where the system lives
- Tokens: `libs/ui/theme.css` (`@theme`). The workspace shell (`apps/commerce-admin/src/app/commerce-workspace.css`,
  `[data-commerce-shell="tasks"]`) sets the brand colour family for the app.
- Components: `libs/ui/src/index.tsx` (`@cp/ui`) and `libs/ui/table.css` (every data table, commerce and josh).
- josh pages: `apps/commerce-admin/tailwind.config.cjs` maps josh's `primary`, `alert`, `blue` and `indigo`
  onto the same tokens. Restyle those pages there or in `@cp/ui`, not in the copied page files.

## Theme
| Token | Value | Use |
|---|---|---|
| `--color-primary` | `#125b61` (shell) | Links, primary buttons, current item |
| `--color-primary-dim` | `#0d474c` | Hover and pressed state of primary |
| `--color-primary-container` | `#e0f0f1` | Selected rows, current tab and page backgrounds |
| `--color-background` | `#eef2f5` (shell) | The page. One step darker than cards |
| `--color-surface-container-lowest` | `#ffffff` | Cards, tables, forms |
| `--color-surface-container-low` | `#f1f4fa` | Table heads, quiet fills |
| `--color-on-surface` / `-variant` | `#17243b` / `#52627a` | Text / secondary text |
| `--color-ok` / `-container` | `#157347` / `#e3f4e9` | Done, active, delivered |
| `--color-warn` / `-container` | `#8a5a00` / `#fdf1d6` | Waiting, needs a look |
| `--color-danger` / `-container` | `#c2333f` / `#fdeaec` | Failed, overdue, destructive |
| `--color-info` / `-container` | `#2044c5` / `#e8efff` | Neutral information |

Status text on its container keeps at least 4.5:1 contrast.

The Welcome Lead Email page (`/j/marketing/welcome-lead-email`) sits outside the shell's theme on purpose. It keeps
its original blue, `#365cf5`. Don't move it into the shell scope.

## Elevation
- `--shadow-card`: every card, table, panel, stat tile and button.
- `--shadow-raised`: hover on clickable cards, plus menus and popovers.
- Depth comes from page vs card (background vs white + shadow). Don't add coloured top or left borders to cards.

## Typography
Noto Sans Thai for everything; JetBrains Mono only for codes, ids and URLs. Headings are always upright, never italic.
- Page title: 24–28px semibold (`PageHeader`).
- Panel title: 15px semibold.
- Body: 13–14px.
- Chip: 11px semibold.

## Components
- **Status:** `StatusChip` (a dot plus a label) for a status. A plain `Chip` is for tags such as event names.
- **Tables:**
  - Amounts, numbers, dates in right-aligned or `tabular-nums` cells, and status pills stay on one line.
  - The table scrolls sideways instead of wrapping these.
- **Buttons:** one primary button per area. Use secondary for everything else and `danger` only for destructive actions.

## Motion
Colour and shadow transitions only, about 120–150 ms. `prefers-reduced-motion` turns them off (`theme.css`).

## Microinteractions
- Saving succeeds silently or shows a short inline message.
- A destructive action asks to confirm.
- The focus ring shows instantly.
