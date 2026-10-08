# commerce-admin: task-based navigation, plain menu names and a home page per role

> **Stacked on #82 (feat/auth-refresh-tokens)**; will be retargeted to master after #82 merges. Includes #82's head (c21f0ba, with master #83 sale role and #84 categories).
>
> **Navigation only.** Page bodies (page headers, filters, empty / loading / error states, confirm dialogs, inline help, form layouts) are handled in a separate PR; this PR touches no page body.

## Summary
Staff said the admin had too many menus and was confusing. This PR changes only the navigation **structure and copy**:

- **7 task sections instead of 7 "workspaces" with overview pages.** Products & Stock · Orders & Payments · Customers & Service · Marketing · Reports & Data · Settings & Staff · Settings › Advanced. Each section shows at most 10 items; less used ones sit behind a **"Show N more"** row. Ops tools, logs, test tools and the read-only store data copies are in **Advanced Settings**, which starts collapsed.
- **Plain task names in TH and EN.** No module or system names appear in the menu: no josh, commerce, replica, MCP, hub, stub, shadow, workspace, platform or "(ทดลอง)". A test enforces this. Every item also has a one-line purpose. It shows as the item's tooltip and in the menu-search results, and you can search by it.
- **A home page per role (`/home`, "What do you want to do today?").** It shows 3–6 big shortcuts to the role's main tasks. It makes no API call, so it cannot 403. Every role lands on it after sign-in. Admins keep the Dashboard (`/`) as their first shortcut and in the sidebar.
- **Each role sees only pages it can open.** The visible items are exactly ROLE_ACCESS. That list was audited against the backend guards (below), and the redesign widens no role. Empty sections are hidden.
- **Old URLs keep working.** No route was removed. The old `/workspaces/:id` pages redirect to the replacing section. Sub-pages (create / edit / detail) highlight their parent item.

## Stitch design unchanged
The Google Stitch design (docs/design/stitch, `libs/ui/theme.css`, the shell and sidebar look) is untouched:
- `libs/ui/theme.css`: no change. `libs/ui/src/icons.ts`: no change.
- `libs/ui/src/index.tsx` has **structural changes only**. No new class, token, color, spacing or typography.
  - `NavItem` gains `description` (rendered as the sidebar link's `title` tooltip and appended to the menu-search result's existing second line), `activeFor` (sub-page highlighting) and `more`.
  - `navMatchLength` / `currentNavItem` choose the active item (longest match). Sidebar links are now `Link` instead of `NavLink`, with the **same** `linkCls` / `subLinkCls` classes and the same active dot.
  - **"Show N more / Show less"** is a row built from the existing sub-item classes (`subLinkCls`, the grey dot, the group's chevron icon). It looks like any other item. This is the only new element in the sidebar.
- `PageHeader` is byte-for-byte the Stitch original (aea5407). The page-kit components from the first draft (purpose line, EmptyState, FilterBar, ConfirmDialog, HelpText) were removed.
- RoleHome (`apps/commerce-admin/src/app/pages/RoleHome.tsx`) is composed from `Page` + `PageHeader` and the **Dashboard's section-picker cards** (Stitch admin-overview), with the same markup and classes and a 3-column grid.
- The Dashboard's section picker (same markup) now lists the new sections instead of the old workspaces.
- Shell copy only: the top-bar eyebrow is now "You are here", the fallback crumb is "Home", and the brand subtitle is "Team back office".

## New section structure
| Section | What's in it (main items; "more" = behind Show more) |
|---|---|
| Home | role home page (every role) · Dashboard (admin) |
| Products & Stock | Shop products, Products by SKU, Categories, Brands, Upload product images, Suppliers, Product prices, Approve product data changes, Receive/adjust/transfer stock, Stock by warehouse · more: Add product, Upload product videos, Customer & contract prices, Supplier order periods |
| Orders & Payments | Orders, Shipments, Payments, Overdue invoices, Billing, Credit applications, Credit notes, Credit refunds, Returns & refunds, Delivery schedules · more: Import orders, Print stickers, Order payments & stock holds, Stock holds at checkout |
| Customers & Service | Customer companies, Customer users, Customer service, Customer chat, Sample requests, Price requests, Verify customer identity, Customer win-back, Team opportunities, Assign sales reps · more: My opportunities and leads, Active price offers, Membership tiers, Categories movable in cart, Customer contacts |
| Marketing | Plan growth, Promotion campaigns, Coupons, Discount rules, Promotion product sets, Promotion pages, Customer segments, Push notifications, Automated messages, Compare competitor prices · more: plans & calendar, analysis assistant, research, restaurant market, message templates, lead welcome email, tracked links, link builder, competitor products, 3 chatbot pages |
| Reports & Data | Sales, Orders, Products, Customers & companies, Selling prices, Target groups, Shop visits, System health (a rep sees "My sales / My orders / My customers"; a sales manager sees "Team sales and rep performance") |
| Settings & Staff | Staff accounts, Store staff accounts, Back-office access requests, Change password |
| Settings › Advanced | connections, logs, test tools, marketing monitoring, store data copies (list below) |

### Old menu item → new place

| # | Old group | Old label | New section | New label (TH / EN) | Roles |
|---|---|---|---|---|---|
| 1 | Reports & Data | Sales reports | Reports & Data | รายงานยอดขาย / Sales reports | admin, sale, sales_manager, business_analyst |
| 2 | Reports & Data | Product reports | Reports & Data | รายงานสินค้า / Product reports | admin, marketing, merchandising |
| 3 | Reports & Data | Order reports | Reports & Data | รายงานออเดอร์ / Order reports | admin, sale, sales_manager, business_analyst |
| 4 | Reports & Data | Customer & Company Report | Reports & Data | รายงานลูกค้าและบริษัท / Customer & Company Report | admin, sale, sales_manager, business_analyst |
| 5 | Reports & Data | Selling price reports | Reports & Data | รายงานราคาขาย / Selling price reports | admin, sale, sales_manager, business_analyst |
| 6 | Reports & Data | Compare Commerce prices (experimental) | Advanced Settings | เทียบราคาที่คำนวณใหม่ / Compare recalculated prices | admin |
| 7 | Products & Stock | Customer and contract prices (Commerce) | Products & Stock · show more | ราคาเฉพาะลูกค้าและราคาสัญญา / Customer & contract prices | admin, merchandising |
| 8 | Reports & Data | Traffic | Reports & Data | การเข้าชมร้านค้า / Shop visits | admin, marketing |
| 9 | Reports & Data | System health | Reports & Data | สุขภาพระบบ / System health | admin, sales_manager, business_analyst |
| 10 | Reports & Data | Target customer groups | Reports & Data | กลุ่มลูกค้าเป้าหมาย / Target customer groups | admin, sales_manager, business_analyst |
| 11 | Reports & Data | Team opportunities | Customers & Service | โอกาสของทีม / Team opportunities | admin, sales_manager, business_analyst |
| 12 | Reports & Data | My opportunities and leads | Customers & Service · show more | โอกาสและลีดของฉัน / My opportunities and leads | admin, sale |
| 13 | Customers & CRM | Assign sales reps | Customers & Service | มอบหมายพนักงานขาย / Assign sales reps | admin, sales_manager |
| 14 | Customers & CRM | Customer win-back | Customers & Service | ติดตามลูกค้าเก่า / Customer win-back | admin, sales_manager, business_analyst |
| 15 | Customers & CRM | KYC request records | Advanced Settings | ข้อมูลคำขอ KYC / KYC request records | admin |
| 16 | Orders & Finance | Apply for credit | Advanced Settings | ข้อมูลคำขอเครดิต / Credit application records | admin |
| 17 | Customers & CRM | Admin access requests | Advanced Settings | ข้อมูลคำขอใช้งานหลังร้าน / Back-office access request records | admin |
| 18 | Orders & Finance | Shipment records | Advanced Settings | ข้อมูลการจัดส่ง / Shipment records | admin |
| 19 | Orders & Finance | Payment records | Advanced Settings | ข้อมูลรายการชำระเงิน / Payment records | admin |
| 20 | Orders & Finance | Credit note records | Advanced Settings | ข้อมูลใบลดหนี้ / Credit note records | admin |
| 21 | Orders & Finance | Credit refund records | Advanced Settings | ข้อมูลคืนเครดิต / Credit refund records | admin |
| 22 | Orders & Finance | Invoices | Advanced Settings | ข้อมูลใบแจ้งหนี้ / Invoice records | admin |
| 23 | Marketing | Coupon records | Advanced Settings | ข้อมูลคูปอง / Coupon records | admin |
| 24 | Marketing | Campaign records | Advanced Settings | ข้อมูลแคมเปญ / Campaign records | admin |
| 25 | Marketing | Customer segment records | Advanced Settings | ข้อมูลกลุ่มลูกค้า / Customer segment records | admin |
| 26 | Products & Stock | Supplier records | Advanced Settings | ข้อมูลซัพพลายเออร์ / Supplier records | admin |
| 27 | Settings & Staff | Internal documents | Advanced Settings | เอกสารภายใน / Internal documents | admin |
| 28 | Integrations | Josh API log | Advanced Settings | บันทึกการเรียก API ร้านค้า / Store API log | admin |
| 29 | Marketing | Marketing analysis assistant | Marketing · show more | ผู้ช่วยวิเคราะห์การตลาด / Marketing analysis assistant | admin, marketing |
| 30 | Marketing | Plan growth | Marketing | วางแผนการเติบโต / Plan growth | admin, marketing, business_analyst |
| 31 | Marketing | Plans and calendar | Marketing · show more | แผนและปฏิทิน / Plans and calendar | admin, marketing |
| 32 | Marketing | Market research | Marketing · show more | งานวิจัยตลาด / Market research | admin, marketing |
| 33 | Marketing | Explore the restaurant market | Marketing · show more | ค้นหาตลาดร้านอาหาร / Explore the restaurant market | admin, marketing |
| 34 | Marketing | Marketing workflows | Marketing | ข้อความอัตโนมัติ / Automated messages | admin, marketing |
| 35 | Marketing | Manage coupons | Marketing | คูปองส่วนลด / Coupons | admin, marketing |
| 36 | Marketing | Promotion product sets | Marketing | ชุดสินค้าโปรโมชัน / Promotion product sets | admin, marketing, merchandising |
| 37 | Marketing | Promotion mechanics | Marketing | กติกาส่วนลด / Discount rules | admin, marketing, merchandising |
| 38 | Marketing | Promotion pages | Marketing | หน้าโปรโมชัน / Promotion pages | admin, marketing |
| 39 | Marketing | Manage campaigns | Marketing | แคมเปญโปรโมชัน / Promotion campaigns | admin, marketing |
| 40 | Marketing | Manage customer segments | Marketing | กลุ่มลูกค้าสำหรับแคมเปญ / Customer segments | admin, marketing |
| 41 | Marketing | Push campaigns | Marketing | ส่งแจ้งเตือนถึงลูกค้า / Push notifications | admin, marketing |
| 42 | Marketing | Notification catalog | Advanced Settings | ประเภทการแจ้งเตือนทั้งหมด / Notification types | admin, marketing |
| 43 | Marketing | Notification log | Advanced Settings | ประวัติการแจ้งเตือน / Notification history | admin, marketing |
| 44 | Marketing | Notification delivery stats | Advanced Settings | สถิติการส่งแจ้งเตือน / Notification delivery stats | admin, marketing |
| 45 | Marketing | Product notify funnel | Advanced Settings | ผลการแจ้งเตือนสินค้า / Product alert results | admin, marketing |
| 46 | Marketing | Compare competitor prices | Marketing | เทียบราคาคู่แข่ง / Compare competitor prices | admin, marketing, business_analyst |
| 47 | Marketing | Web scraping settings | Advanced Settings | ตั้งค่าเว็บคู่แข่งที่เก็บข้อมูล / Competitor sites to collect | admin, marketing |
| 48 | Marketing | Competitor web catalogue | Marketing · show more | สินค้าจากเว็บคู่แข่ง / Competitor products | admin, marketing |
| 49 | Customers & CRM | Customer service | Customers & Service | งานบริการลูกค้า / Customer service | admin, cs |
| 50 | Customers & CRM | Customer chat | Customers & Service | แชตกับลูกค้า / Customer chat | admin |
| 51 | Customers & CRM | Bot · intent rules | Marketing · show more | แชตบอต: เข้าใจคำถาม / Chatbot: question rules | admin, marketing |
| 52 | Customers & CRM | Bot · workflows | Marketing · show more | แชตบอต: ลำดับการตอบ / Chatbot: reply flows | admin, marketing |
| 53 | Customers & CRM | Bot · templates | Marketing · show more | แชตบอต: ข้อความสำเร็จรูป / Chatbot: ready replies | admin, marketing |
| 54 | Products & Stock | Manage products | Products & Stock | สินค้าบนร้านค้า / Shop products | admin, marketing, merchandising, graphic |
| 55 | Products & Stock | Add product | Products & Stock · show more | เพิ่มสินค้า / Add product | admin, marketing, merchandising |
| 56 | Products & Stock | Upload product videos | Products & Stock · show more | อัปโหลดวิดีโอสินค้า / Upload product videos | admin, marketing, merchandising |
| 57 | Products & Stock | Upload product images in bulk | Products & Stock | อัปโหลดรูปสินค้า / Upload product images | admin, marketing, merchandising, graphic |
| 58 | Products & Stock | Manage suppliers | Products & Stock | ซัพพลายเออร์ / Suppliers | admin, marketing, merchandising |
| 59 | Products & Stock | Brands | Products & Stock | แบรนด์ / Brands | admin, marketing, merchandising, graphic |
| 60 | Products & Stock | Categories | Products & Stock | จัดการหมวดหมู่ / Categories | admin, merchandising |
| 61 | Customers & CRM | Manage users | Customers & Service | ผู้ใช้ของลูกค้า / Customer users | admin |
| 62 | Customers & CRM | Membership tiers | Customers & Service · show more | ระดับสมาชิก / Membership tiers | admin |
| 63 | Customers & CRM | Manage companies | Customers & Service | บริษัทลูกค้า / Customer companies | admin |
| 64 | Customers & CRM | Verify customer identity | Customers & Service | ตรวจสอบตัวตนลูกค้า / Verify customer identity | admin |
| 65 | Customers & CRM | Sample requests | Customers & Service | คำขอสินค้าตัวอย่าง / Sample Requests | admin, cs |
| 66 | Orders & Finance | Delivery schedules | Orders & Payments | ตารางรอบส่ง / Delivery schedules | admin, cs |
| 67 | Customers & CRM | Categories movable in cart | Customers & Service · show more | หมวดที่ย้ายของในตะกร้าได้ / Categories movable in cart | admin, cs |
| 68 | Products & Stock | Price requests | Customers & Service | คำขอราคา / Price requests | admin |
| 69 | Products & Stock | Active price offers | Customers & Service · show more | ข้อเสนอราคาที่ใช้งาน / Active price offers | admin |
| 70 | Customers & CRM | Admin access requests | Settings & Staff | คำขอใช้งานหลังร้าน / Back-office access requests | admin |
| 71 | Orders & Finance | Manage orders | Orders & Payments | คำสั่งซื้อ / Orders | admin, cs |
| 72 | Orders & Finance | Manage shipments | Orders & Payments | การจัดส่งสินค้า / Shipments | admin, cs |
| 73 | Orders & Finance | Manage payments | Orders & Payments | รายการชำระเงิน / Payments | admin |
| 74 | Orders & Finance | Import orders | Orders & Payments · show more | นำเข้าออเดอร์ / Import orders | admin |
| 75 | Orders & Finance | Print stickers | Orders & Payments · show more | พิมพ์สติกเกอร์ / Print stickers | admin |
| 76 | Orders & Finance | KBank testing console | Advanced Settings | ทดสอบชำระเงิน KBank / Test KBank payments | admin |
| 77 | Orders & Finance | Overdue invoices | Orders & Payments | ใบแจ้งหนี้ค้างชำระ / Overdue invoices | admin |
| 78 | Orders & Finance | Manage credit notes | Orders & Payments | ใบลดหนี้ / Credit notes | admin, cs |
| 79 | Orders & Finance | Manage credit refunds | Orders & Payments | คืนเครดิตให้ลูกค้า / Credit refunds | admin, cs |
| 80 | Orders & Finance | Credit applications | Orders & Payments | ใบสมัครเครดิต / Credit applications | admin |
| 81 | Orders & Finance | Billing | Orders & Payments | วางบิล / Billing | admin |
| 82 | Orders & Finance | Returns and refunds | Orders & Payments | คืนสินค้าและคืนเงิน / Returns and refunds | admin |
| 83 | Orders & Finance | Jagota payment testing | Advanced Settings | ทดสอบชำระเงิน Jagota / Test Jagota payments | admin |
| 84 | Integrations | Test store ERP events | Advanced Settings | ทดสอบส่งข้อมูล ERP ไปร้านค้า / Test ERP events to the store | admin |
| 85 | Marketing | Message templates | Marketing · show more | แม่แบบข้อความ / Message templates | admin, marketing |
| 86 | Marketing | Smart links | Marketing · show more | ลิงก์ติดตามผล / Tracked links | admin, marketing |
| 87 | Marketing | Marketing links | Marketing · show more | สร้างลิงก์การตลาด / Marketing link builder | admin, marketing |
| 88 | Marketing | Lead welcome email | Marketing · show more | อีเมลต้อนรับลีด / Lead welcome email | admin, marketing |
| 89 | Marketing | Marketing settings | Advanced Settings | ตั้งค่าการตลาด / Marketing settings | admin, marketing |
| 90 | Marketing | Marketing queue | Advanced Settings | คิวงานการตลาด / Marketing queue | admin, marketing |
| 91 | Marketing | Journey funnel | Advanced Settings | เส้นทางของลูกค้า / Customer journey funnel | admin |
| 92 | Marketing | Review offers | Advanced Settings | ตรวจข้อเสนอ / Review offers | admin, marketing |
| 93 | Integrations | AI connections | Advanced Settings | เชื่อมต่อผู้ช่วย AI / AI assistant connections | admin, marketing |
| 94 | Integrations | Incoming data log | Advanced Settings | บันทึกข้อมูลขาเข้าจาก ERP / ERP incoming data log | admin |
| 95 | Integrations | josh ERP Logs | Advanced Settings | บันทึกการเรียก ERP ของร้านค้า / Store ERP call log | admin |
| 96 | Integrations | Failed deliveries | Advanced Settings | รายการส่งไม่สำเร็จ / Failed deliveries | admin |
| 97 | Integrations | Destination platforms | Advanced Settings | ระบบปลายทางที่รับข้อมูล / Systems receiving our data | admin |
| 98 | Products & Stock | Inventory per warehouse | Products & Stock | สต็อกแต่ละคลัง / Stock by warehouse | admin, sale, merchandising, business_analyst |
| 99 | Integrations | Test ERP connections | Advanced Settings | ทดสอบการเชื่อมต่อ ERP / Test ERP connections | admin |
| 100 | Integrations | Send orders through Commerce (experimental) | Advanced Settings | ทดลองส่งออเดอร์เข้า ERP / Trial: send orders to ERP | admin |
| 101 | Integrations | Connections | Advanced Settings | ระบบที่เชื่อมต่อ / Connected systems | admin |
| 102 | Integrations | Incoming events | Advanced Settings | เหตุการณ์ขาเข้า / Incoming events | admin |
| 103 | Integrations | Outgoing event delivery | Advanced Settings | การส่งเหตุการณ์ขาออก / Outgoing event delivery | admin |
| 104 | Integrations | Sync jobs | Advanced Settings | งานซิงก์ข้อมูล / Sync jobs | admin |
| 105 | Products & Stock | ERP stub stock | Advanced Settings | สต็อกจำลองสำหรับทดสอบ / Test stock levels | admin |
| 106 | Integrations | ERP ingest | Advanced Settings | ข้อมูลที่รับจาก ERP / Data received from ERP | admin |
| 107 | Customers & CRM | Platform customers | Customers & Service · show more | ข้อมูลติดต่อลูกค้า / Customer contacts | admin |
| 108 | Products & Stock | Platform Catalog | Products & Stock | สินค้าตาม SKU / Products by SKU | admin, sale, merchandising, graphic |
| 109 | Products & Stock | Stock Movements | Products & Stock | รับเข้า ปรับ และโอนสต็อก / Receive, adjust & transfer stock | admin, merchandising |
| 110 | Products & Stock | Product Prices | Products & Stock | ราคาสินค้า / Product Prices | admin, merchandising |
| 111 | Products & Stock | ERP product queue | Products & Stock | อนุมัติข้อมูลสินค้าที่เปลี่ยน / Approve product data changes | admin, merchandising |
| 112 | Products & Stock | Supplier ordering schedules | Products & Stock · show more | รอบสั่งซื้อจากซัพพลายเออร์ / Supplier order periods | admin, merchandising |
| 113 | Orders & Finance | Platform Orders | Orders & Payments · show more | ชำระเงินและการจองของออเดอร์ / Order payments & stock holds | admin, business_analyst |
| 114 | Orders & Finance | Reservations | Orders & Payments · show more | การจองสต็อกตอนชำระเงิน / Stock holds at checkout | admin |
| 115 | Settings & Staff | Staff accounts | Settings & Staff | บัญชีทีมงาน / Staff accounts | admin |
| 116 | Settings & Staff | Store staff accounts | Settings & Staff | บัญชีทีมงานร้านค้า / Store staff accounts | admin |
| 117 | Settings & Staff | Change Password | Settings & Staff | เปลี่ยนรหัสผ่าน / Change Password | admin, sale, marketing, merchandising, cs, sales_manager, business_analyst, graphic |

Old workspace overview pages `/workspaces/{catalog,orders,customers,marketing,reports,connections,settings}` redirect to the first page of the replacing section the role can open (connections → Settings › Advanced), else to the role home.

### Per role

| Role | Items before → after | Sections (items) | Home shortcuts |
|---|---|---|---|
| admin | 125 → 119 | Products & Stock (14, 4 under show more); Orders & Payments (14, 4 under show more); Customers & Service (15, 5 under show more); Marketing (22, 12 under show more); Reports & Data (8); Settings & Staff (4); Advanced Settings (40) | Dashboard · Shop products · Orders · Customer companies · Promotion campaigns · Staff accounts |
| marketing | 47 → 41 | Products & Stock (6, 2 under show more); Marketing (22, 12 under show more); Reports & Data (2); Settings & Staff (1); Advanced Settings (9) | Plan growth · Promotion campaigns · Coupons · Customer segments · Push notifications · Compare competitor prices |
| merchandising | 22 → 19 | Products & Stock (14, 4 under show more); Marketing (2); Reports & Data (1); Settings & Staff (1) | Products by SKU · Shop products · Product Prices · Approve product data changes · Receive, adjust & transfer stock · Categories |
| cs | 12 → 10 | Orders & Payments (5); Customers & Service (3, 1 under show more); Settings & Staff (1) | Customer service · Orders · Shipments · Sample Requests · Credit notes |
| sale | 11 → 9 | Products & Stock (2); Customers & Service (1); Reports & Data (4); Settings & Staff (1) | My sales · My opportunities and leads · My customers · My orders · Products by SKU · Selling price reports |
| sales_manager | 13 → 11 | Customers & Service (3); Reports & Data (6); Settings & Staff (1) | Team sales and rep performance · Team opportunities · Customer win-back · Assign sales reps · Customer & Company Report |
| business_analyst | 19 → 14 | Products & Stock (1); Orders & Payments (1); Customers & Service (2); Marketing (2); Reports & Data (6); Settings & Staff (1) | Sales reports · Order reports · Customer & Company Report · Plan growth · Stock by warehouse · Compare competitor prices |
| graphic | 7 → 6 | Products & Stock (4); Settings & Staff (1) | Upload product images · Shop products · Brands · Products by SKU |

### Settings › Advanced

- Connected systems (`/integrations`) — admin
- Incoming events (`/webhooks`) — admin
- Outgoing event delivery (`/subscriptions`) — admin
- Sync jobs (`/sync-jobs`) — admin
- Systems receiving our data (`/erp/webhook-platforms`) — admin
- Data received from ERP (`/erp-ingest`) — admin
- AI assistant connections (`/ai/connectors`) — admin, marketing
- ERP incoming data log (`/erp/inbound-log`) — admin
- Failed deliveries (`/erp/webhook-dead-letter`) — admin
- Store ERP call log (`/erp/josh-logs`) — admin
- Store API log (`/josh-api-logs`) — admin
- Test ERP connections (`/erp/simulator`) — admin
- Test ERP events to the store (`/j/erp/webhook-simulator`) — admin
- Test stock levels (`/erp-stock`) — admin
- Test KBank payments (`/j/kbank/testing-console`) — admin
- Test Jagota payments (`/j/jagota/payment-testing`) — admin
- Trial: send orders to ERP (`/erp/jagota-shadow`) — admin
- Compare recalculated prices (`/reports/price-shadow`) — admin
- Marketing settings (`/j/marketing/settings`) — admin, marketing
- Marketing queue (`/j/marketing/queue`) — admin, marketing
- Review offers (`/j/marketing/offers-check`) — admin, marketing
- Customer journey funnel (`/j/marketing/journey-funnel`) — admin
- Notification types (`/j/cs/notification-catalog`) — admin, marketing
- Notification history (`/j/cs/notification-log`) — admin, marketing
- Notification delivery stats (`/j/cs/notification-stats`) — admin, marketing
- Product alert results (`/j/cs/product-notify-funnel`) — admin, marketing
- Competitor sites to collect (`/j/marketing/scraping-sources`) — admin, marketing
- KYC request records (`/josh/kyc`) — admin
- Credit application records (`/josh/credit_terms`) — admin
- Back-office access request records (`/josh/admin_access`) — admin
- Shipment records (`/josh/shipments`) — admin
- Payment records (`/josh/payments`) — admin
- Credit note records (`/josh/credit_notes`) — admin
- Credit refund records (`/josh/credit_backs`) — admin
- Invoice records (`/josh/invoices`) — admin
- Coupon records (`/josh/coupons`) — admin
- Campaign records (`/josh/campaigns`) — admin
- Customer segment records (`/josh/segments`) — admin
- Supplier records (`/josh/suppliers`) — admin
- Internal documents (`/josh/internal_docs`) — admin

Sections: Products & Stock · Orders & Payments · Customers & Service · Marketing · Reports & Data · Settings & Staff · Advanced Settings


"Items before" counts the old sidebar including its 7 workspace-overview links.

## Role access audit
ROLE_ACCESS (navigation.ts) was checked against the backend: `@StaffRoles` / `@AnyStaff` / `READ_ONLY_STAFF_ROLES` in apps/commerce-platform, and for `/j/*` pages the josh admin-call relay `AREAS` (josh-admin-call.controller.ts). I also checked the API calls each page makes when it opens; the tutorial inventory covered this for the 7 original roles, and I checked #83's sale / sales-manager pages by hand.
- **Visibility fix:** `/j/marketing/journey-funnel` was shown to **marketing**. The page reads josh `/analytics/funnel`, which the relay allows for admin only (josh-admin-call.controller.ts:31). It is now hidden from marketing, and deep links to it send marketing to their home. Admin still has it under Advanced.
- **No other mismatch** for admin, marketing, merchandising, cs, graphic, business_analyst, sales_manager or sale. Checked for sale: `/reports/{sales,orders,customers,prices}` (shop-reports.controller.ts:76/212–240, `...SHOP, 'sale'`), `/products` (product.controller.ts:19/25), stock by warehouse (inventory-overview.controller.ts:18) and `/reports/winback/my/*` (winback-reports.controller.ts:42/47). The sales-rep filter only calls `/cs-admin/sales-reps` for admin and sales_manager (sales-reps.controller.ts:13).
- **Known page / backend issue, listed only (no backend change in this PR):** `/cs` (the CS desk, cs's own page; it stays in cs's menu) has two search boxes that call endpoints `cs` may not use:
  - customer search → `GET /reports/customers` and `/reports/customers/:id` (CsDesk.tsx:65–66). The guard is `@StaffRoles(...SHOP, 'sale')` (shop-reports.controller.ts:227/231), so cs gets **403**.
  - product search → `GET /reports/products` (CsDesk.tsx:114). The guard is `@StaffRoles('marketing', 'merchandising')` (shop-reports.controller.ts:200), so cs gets **403**.
  These need either a backend decision (give cs read access) or a page change.
- No backend guard was changed. apps/commerce-platform is untouched by this PR.

## Landing per role
Every role (admin, marketing, merchandising, cs, sale, sales_manager / sale_manager, business_analyst, graphic) lands on **`/home`** (`role-home.ts` ROLE_HOME, re-exported by landing.ts as ROLE_LANDING). This is an intentional change from #82 / #83, where each role landed on a task page; that page is now the role's first home shortcut. #82's deep-link handling is unchanged: an allowed `?redirect=` still wins, and `normalizeInternalPath`, `..` / encoded-dot refusal and open-redirect checks are all kept. Unknown roles still fall back to `/account/password`. `/` is still the admin Dashboard; other roles who open `/` go to `/home`.

## Screenshots
Both builds were made locally (BEFORE = #82 head c21f0ba, AFTER = this branch) and served on 127.0.0.1. Every `/api` call was faked by the tutorial fixture, and prod hosts were aborted. Every shot carries the "Example from a test build, not prod" label, and the 1440×900 shots are EN unless marked.
Some BEFORE landing pages (admin Dashboard, marketing growth, sale / sales-manager sales report) crash on the generic fake data and blank the whole app. For those, the BEFORE shot shows the same shell on `/account/password`. The AFTER landings are all `/home`, which needs no data. Script: `docs/admin-redesign/shots.mjs`.

| Role | Before (#82 head) | After |
|---|---|---|
| admin | ![](docs/admin-redesign/screenshots/before/admin-en-landing.png) | ![](docs/admin-redesign/screenshots/after/admin-en-landing.png) |
| merchandising | ![](docs/admin-redesign/screenshots/before/merchandising-en-landing.png) | ![](docs/admin-redesign/screenshots/after/merchandising-en-landing.png) |
| marketing | ![](docs/admin-redesign/screenshots/before/marketing-en-landing.png) | ![](docs/admin-redesign/screenshots/after/marketing-en-landing.png) |
| cs | ![](docs/admin-redesign/screenshots/before/cs-en-landing.png) | ![](docs/admin-redesign/screenshots/after/cs-en-landing.png) |
| sale | ![](docs/admin-redesign/screenshots/before/sale-en-landing.png) | ![](docs/admin-redesign/screenshots/after/sale-en-landing.png) |
| sales_manager | ![](docs/admin-redesign/screenshots/before/sales_manager-en-landing.png) | ![](docs/admin-redesign/screenshots/after/sales_manager-en-landing.png) |
| admin, TH | — | ![](docs/admin-redesign/screenshots/after/admin-th-landing.png) |

Whole sidebar, every group opened (300 px clips): 
| Role | Before | After |
|---|---|---|
| admin | ![](docs/admin-redesign/screenshots/before/admin-en-sidebar-all.png) | ![](docs/admin-redesign/screenshots/after/admin-en-sidebar-all.png) |
| merchandising | ![](docs/admin-redesign/screenshots/before/merchandising-en-sidebar-all.png) | ![](docs/admin-redesign/screenshots/after/merchandising-en-sidebar-all.png) |
| marketing | ![](docs/admin-redesign/screenshots/before/marketing-en-sidebar-all.png) | ![](docs/admin-redesign/screenshots/after/marketing-en-sidebar-all.png) |
| cs | ![](docs/admin-redesign/screenshots/before/cs-en-sidebar-all.png) | ![](docs/admin-redesign/screenshots/after/cs-en-sidebar-all.png) |
| sale | ![](docs/admin-redesign/screenshots/before/sale-en-sidebar-all.png) | ![](docs/admin-redesign/screenshots/after/sale-en-sidebar-all.png) |
| sales_manager | ![](docs/admin-redesign/screenshots/before/sales_manager-en-sidebar-all.png) | ![](docs/admin-redesign/screenshots/after/sales_manager-en-sidebar-all.png) |
| admin, TH | — | ![](docs/admin-redesign/screenshots/after/admin-th-sidebar-all.png) |

## Tests and checks
| Check | Result |
|---|---|
| `npx tsc --noEmit -p apps/commerce-admin/tsconfig.app.json` | pass (there is no tsconfig.spec.json) |
| `npx tsc --noEmit -p apps/commerce-portal/tsconfig.app.json` (libs/ui changed) | pass |
| `npx vitest run src/app/navigation.spec.ts src/lib/landing.spec.ts src/lib/role-home.spec.ts src/app/app.spec.tsx src/lib/auth.spec.ts --maxWorkers=2` (apps/commerce-admin) | 5 files, **140 tests pass** |
| `npx vitest run src/app/app.spec.tsx --maxWorkers=2` (apps/commerce-portal) | 4 tests pass |
| `nice -n 10 npx nx build commerce-admin --parallel=1` | pass |

What the tests cover:
- `navigation.spec.ts`
  - Per role: every visible item is allowed and in ROLE_ACCESS, with no empty or duplicate groups. Admin sees everything. There are ≤ 7 sections and ≤ 10 main items per section. Advanced appears only for admin and marketing.
  - Per-role counts.
  - Every old item has a new home and the redesign widened no role (against the frozen old menu, `navigation.legacy.ts`). Old `/workspaces/:id` redirects.
  - **Every nav item, home shortcut, old item and old workspace URL matches a registered route** (app.tsx + the josh-admin router).
  - Sub-pages highlight their parent.
  - TH + EN parity, placeholders and no Thai in EN.
  - **No module jargon in any menu copy.**
  - Home shortcuts: 3–6 per role, each allowed and in the role's sidebar.
  - #83's sale / sales-manager assertions, adapted only for the new Home item.
- `landing.spec.ts` / `role-home.spec.ts`: landing is `/home` for every role and alias; the first shortcut is the role's main page and is never behind "show more"; #82's deep-link and normalisation tests are unchanged except that the fallback is now `/home`.
- `app.spec.tsx`
  - The sign-in gate lands on `/home`, and old workspace links redirect.
  - The sidebar shows sections, the current item and its tooltip.
  - `/home` renders the role's shortcuts **without any API call**.

## Files touched (vs #82 head c21f0ba)
```
 apps/commerce-admin/src/app/app.spec.tsx         |  36 ++-
 apps/commerce-admin/src/app/app.tsx              |  16 +-
 apps/commerce-admin/src/app/navigation.legacy.ts | 283 +++++++++++++++++++++
 apps/commerce-admin/src/app/navigation.spec.ts   | 194 ++++++++++++++-
 apps/commerce-admin/src/app/navigation.ts        | 568 ++++++++++++++++++++----------------------
 apps/commerce-admin/src/app/pages/Dashboard.tsx  |  10 +-
 apps/commerce-admin/src/app/pages/RoleHome.tsx   |  28 +++
 apps/commerce-admin/src/app/pages/Workspace.tsx  |  70 +-----
 apps/commerce-admin/src/lib/landing.spec.ts      |  82 +++---
 apps/commerce-admin/src/lib/landing.ts           |   6 +-
 apps/commerce-admin/src/lib/role-home.spec.ts    |   5 +-
 apps/commerce-admin/src/lib/role-home.ts         |  21 +-
 libs/ui/src/index.tsx                            |  81 ++++--
 libs/ui/src/locales/ui-messages.json             | 712 +++++++++++++++++++++++++++++++++++++++++++++++++++++
 14 files changed, 1664 insertions(+), 448 deletions(-)

plus docs/admin-redesign/ (this PR body, shots.mjs, nav-tables.ts, screenshots/before + after: 26 PNGs)
```

## Open questions
- Should `cs` get read access to `/reports/customers` and `/reports/products` so the CS desk searches work (see audit), or should the desk use other endpoints?
- Admins now land on `/home`, with the Dashboard as the first shortcut. If admins prefer the Dashboard as their landing, change `ROLE_HOME.admin` to `/`.
- "Show more" groups: are the main/more splits right for each team (e.g. Marketing keeps 10 main items and 12 under "more")?
