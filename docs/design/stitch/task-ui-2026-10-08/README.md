# Commerce Platform — UI ใช้งานง่าย แยกตามหมวด

Created live in [Stitch project 13919217234596972121](https://stitch.withgoogle.com/projects/13919217234596972121) on 2026-10-08. Authentication, remote generation, and all eight `COMPLETE` results were verified. The shared design-system asset is `assets/8866186635564433101`; it was supplied explicitly to each generation request.

| Work area | Generated screen ID | Application work |
| --- | --- | --- |
| สินค้าและสต็อก | `9e3c81c7e3364f6996a2b89cf3341ef7` | Task directory, current-page product search/status, create/edit dialogs, warehouse names, four stock tasks |
| ออเดอร์และการเงิน | `52592323c7dd46e1bacdcb7897d0a471` | Task directory, current-page order search/status, existing customer/product selectors and calculated form subtotal |
| ลูกค้าและบริการ | `4a7a841c5f2546afb7490b583d7ea0d2` | Task directory, current-page contact search/status, create/edit dialogs, contact facts and customer orders |
| การตลาด | `f38e516ea3e94075809bde82c91175f5` | Planning/research, promotions, communication, and tracking sections |
| รายงานและข้อมูล | `85c21d5d1e9d4b53b7a036856dd50a2b` | Business reports and system reports grouped by task |
| ระบบเชื่อมต่อ | `1b96f005f1f44d09b1734d4e0d4431c3` | Connections, incoming data, sync/deliveries, troubleshooting; list-first connection creation with masked signing secret |
| ตั้งค่าและทีมงาน | `950087d91b2a4cd1852458a87f1c9981` | Role-filtered task directory, staff list and creation dialog; existing role/status/reset actions retained |
| Developer Portal | `5f63cce2e8c844968dfd58cf22d03e39` | Active-resource checklist, creation dialogs, delivery filtering/refresh, local SVG documentation icon |

## References and implementation

`DESIGN.md` defines the visual language and supported workflows. Each `*.prompt.txt` records the exact generation request; `*.response.md` retains Stitch's design explanation. `screens.json` contains resource names, export URLs, statuses and suggested follow-on screens. Suggestions are references, not unsupported features to copy into the product.

All 114 original destinations remain available. Native screens use shared React components and real API data. The copied management pages retain their specialized workflows and adopt the common typography, spacing and error handling. Their individual inner workflows have not all received separate custom Stitch screens. Generated sample figures, notification buttons and other speculative controls were not added to the application.

Current-page filters explicitly search only loaded rows. Pagination remains available when filters produce no matches. Product inventory summaries and customer order values identify their displayed scope; order values are grouped by currency. Stock movement payloads and quantity rules are preserved, and transfer destinations exclude the source warehouse.

## Export access

All eight HTML exports and screenshots were downloaded successfully on 2026-10-08 after the environment network policy became unrestricted. The files are available beside their prompts. `python docs/design/stitch/task-ui-2026-10-08/download-assets.py` downloads the recorded exports again; it does not need an API key.

The earlier CONNECT 403 download blocker is resolved. The subsequent full-route redesign has a separate Stitch HTTP 401 authentication blocker; see [full UI and bilingual progress](../full-ui-bilingual/README.md). No additional network allowlist change is needed in the current environment.

## Implemented previews and checks

These captures show the running React application with isolated local mock data, not the generated Stitch images:

- [Admin overview](implemented/admin-overview.png)
- [Product work area](implemented/catalog-workspace.png)
- [Stock task form](implemented/stock-moves.png)
- [Phone product list](implemented/mobile-catalog.png)
- [Developer Portal](implemented/portal-overview.png)

Both app type checks and production builds passed. The browser runner completed 162 page visits with no JavaScript or horizontal-overflow failures. It verified navigation and complete task sections, role filtering, keyboard search, real local product/customer creation and editing, order creation, current-page filters, stock input constraints, masked integration input, staff dialog entry, Portal actions, and 390/768px layouts. Its temporary CRUD fixtures were removed.

Additional phone checks verified filters on all three native lists and five Admin/Portal creation dialogs. They checked dialog width, keyboard focus containment, Escape, and return focus to the trigger. This uncovered and fixed a native-dialog cleanup issue: React removed the dialog before the browser could restore focus, so the shared component now explicitly restores its connected trigger. The full browser runner and both builds passed again after that fix.

Stock mutation was not exercised: the seeded warehouses are ERP-owned. Thirty-five external/backend endpoints returned 503 and were recorded separately; their live Josh workflows remain unverified. Builds retain large-chunk warnings. See [workspace-redesign.md](../../workspace-redesign.md) for reproducible check commands.
