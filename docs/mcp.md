# MCP server: ต่อ AI (Claude / ChatGPT) เข้ากับ commerce-platform

ให้ AI **อ่านและสรุป**ข้อมูลของ commerce ได้เหมือนต่อ connector ทั่วไป ส่วนการ**แก้ไขข้อมูล**ทำได้ไม่กี่อย่าง และต้องเปิดเองตอน login กับยืนยันทุกครั้ง (ดูหัวข้อ Tools ที่แก้ข้อมูล)

- **โปรโตคอล:** MCP แบบ Streamable HTTP ที่ `https://<commerce-host>/mcp` (stateless และตอบเป็น JSON)
- **การยืนยันตัวตน:** OAuth 2.1 แบบ PKCE + dynamic client registration ผ่าน MCP SDK ทางการ (`@modelcontextprotocol/sdk`)
- **ใครใช้ได้:** staff ของ commerce (`admin` / `marketing`) login ผ่านหน้าของเราเอง บัญชี developer ของ portal ใช้ไม่ได้
- **ไม่อยู่ใน josh** (§0.3 ของ `erp-integration-tasks.md`) โหลดจาก AI จึงไม่กระทบ shop

## วิธีเชื่อมต่อ

| แอป | ขั้นตอน |
|---|---|
| **Claude** (claude.ai / Desktop) | Settings → Connectors → Add custom connector → URL `https://<commerce-host>/mcp` → Connect → login ด้วยบัญชี staff |
| **ChatGPT** | Settings → Connectors (เปิด developer mode) → Create → MCP server URL `https://<commerce-host>/mcp`, Authentication = OAuth → login ด้วยบัญชี staff |
| **Claude Code** | `claude mcp add --transport http commerce https://<commerce-host>/mcp` แล้วพิมพ์ `/mcp` เพื่อ login |

ตัวอย่างคำถาม:
- "สรุปสินค้าที่เราแพงกว่าคู่แข่งเกิน 10%"
- "Makro ขายน่องไก่เท่าไหร่ เทียบกับ SKU ของเรา"
- "รายงาน research ล่าสุดเรื่องร้านอาหารญี่ปุ่นว่าอะไรบ้าง"
- "หาเทรนด์วัตถุดิบในกรุงเทพฯ ช่วง 14 วัน แล้วเสนอการทดลองที่เราควรทำพร้อมหลักฐาน"
- "ดูรายงานวิเคราะห์นี้ แล้วสร้างร่างแผน Growth จากข้อเสนอที่เลือก ให้ตรวจข้อความและกลุ่มก่อนส่งอนุมัติ"
- "เมื่อวาน ERP ส่งอะไรมาที่ fail บ้าง" (admin)

## Tools

เครื่องมืออ่านด้านล่างเป็น `readOnlyHint: true` และเห็นได้ตาม role ของบัญชีที่ login แบบเดียวกับ commerce-admin

| Tool | Role | อ่านอะไร |
|---|---|---|
| `competitor_prices` | marketing, admin | `view: "matrix"` คืนหนึ่ง SKU พร้อมทุกร้านและทุกข้อเสนอในร้านเดียวกัน; `search`/`filter` เลือก SKU โดยเก็บคู่แข่งทั้งหมด, `limit`/`page` นับ SKU; ราคาที่เทียบไม่ได้ไม่มีส่วนต่างและร้านที่ไม่มีคู่คืน offers ว่าง ส่วน `view: "pairs"` (ค่าเดิม) ใช้ตรวจรายคู่ |
| `scraped_catalog_search` | marketing, admin | สินค้าและราคาที่เก็บจากเว็บคู่แข่ง |
| `scraping_sources` | marketing, admin | เว็บที่ตั้งให้เก็บ สถานะ และรอบล่าสุด |
| `research_topics` / `research_report` | marketing, admin | โจทย์ research และรายงานล่าสุดพร้อมหลักฐาน |
| `catalog_products` | marketing, admin | แค็ตตาล็อก josh (จากสำเนาใน commerce) ทั้ง SKU ชื่อ และราคาขาย |
| `josh_products` | marketing, admin | ตรวจสถานะสินค้า สินค้าที่ซ่อนหรือข้อมูลไม่ครบ ก่อนเลือก SKU ไปเสนอแคมเปญ |
| `shop_traffic` | marketing, admin | session/event funnel และคำค้น รวมคำค้นที่ไม่พบสินค้า เพื่อหาขั้นตอนที่ควรปรับและความต้องการที่ควรตรวจต่อ |
| `marketing_list` / `segment_preview` | marketing, admin | อ่าน coupon/segment/campaign/product set/promotion page ที่มี และลองนับกลุ่มก่อนบันทึก segment |
| `marketing_workflows` / `josh_promotions` / `push_campaigns` | marketing, admin | อ่าน workflow โปรโมชัน และผลส่งแคมเปญเดิม เพื่อปรับจากสิ่งที่มีและตรวจข้อผิดพลาดก่อนสร้างเพิ่ม |
| `restaurant_places` | marketing, admin | กรองข้อมูลร้านอาหารสำหรับสำรวจตลาดและ prospecting พร้อมจำนวนแยกประเภท/พื้นที่ |
| `growth_workspace` | marketing, admin | โอกาสจากยอดที่รับชำระจริง ตะกร้าค้าง รอบซื้อ และ workflow ที่ล้มเหลว พร้อมหลักฐาน ช่วงเวลา และข้อจำกัดของการเปิดส่ง |
| `growth_plans` | marketing, admin | อ่านแผนเต็มพร้อมข้อความ หลักฐาน งาน ประวัติ สถานะ เวอร์ชัน และ `canManage`; ไม่ส่ง id จะได้รายการแบบแบ่งหน้า (`page`, `limit`, `search`, `status`, `month`) |
| `growth_results` | marketing, admin | อ่าน funnel รายได้ที่ให้เครดิต holdout และงานที่ fail ของ `workflowId`; ใช้ตรวจผลและออกแบบการทดลองต่อ ไม่สรุปเป็นกำไรหรือยอดเพิ่มจากแคมเปญ |
| `market_analysis_reports` | marketing, admin | รายการรายงานของตน หรืออ่านหนึ่งรายงานด้วย id พร้อม facts/hypotheses ข้อเสนอ แหล่งอ้างอิง และ trace ของ MCP ที่อ่านจริง; admin อ่านรายงานของคนอื่นได้เมื่อระบุ id |
| `growth_timeline` | admin | ตรวจ 100 เหตุการณ์ออเดอร์ การติดต่อแบบ metadata และ workflow ล่าสุดใน 90 วันของ `companyId` |
| `erp_intake_summary` | admin | ERP ส่งอะไรมาใน N ชั่วโมง แยกตามสถานะ และรายการที่ fail |
| `webhook_failures` | admin | event ที่ส่งให้ platform (เช่น josh) ไม่สำเร็จ |
| `stock_levels` | admin | สต็อกและยอดจองของ SKU แยกตามคลัง |

## Tools ที่แก้ข้อมูล (scope `commerce.write`)

**ต้องเปิดเอง:** ตอน login ต้องติ๊ก "อนุญาตให้แก้ไขข้อมูลบางอย่างด้วย" ถ้าไม่ติ๊ก หรือ client ขอแค่ `commerce.read` ก็จะอ่านได้อย่างเดียวเหมือนเดิม และ tool ที่แก้ข้อมูลจะไม่ปรากฏเลย

**ยืนยันสองชั้นทุกครั้ง:**
1. **ขอดูก่อน:** เรียกครั้งแรกโดยไม่ใส่ `confirmCode` ระบบจะยังไม่ทำอะไร แค่ส่งกลับ `willDo` (สิ่งที่จะทำ) กับ `confirmCode`
2. **ยืนยัน:** AI ต้องแสดง `willDo` ให้ผู้ใช้ดู พอผู้ใช้ตกลงแล้วจึงเรียกซ้ำด้วย argument ชุดเดิมพร้อม `confirmCode`
   - code ใช้ได้ครั้งเดียว และหมดอายุใน 10 นาที
   - code ผูกกับบัญชี, แอป AI, tool และ argument ชุดนั้น ถ้าเปลี่ยน argument ต้องขอดูใหม่

นอกจากนี้ tool เหล่านี้ตั้ง `readOnlyHint: false` ไว้ Claude และ ChatGPT จึงถามผู้ใช้ก่อนเรียกอยู่แล้ว

| Tool | Role | ทำอะไร |
|---|---|---|
| `market_analyse` | marketing, admin | ยืนยันโจทย์ `question`, `area`, `days` (1–90 วัน) และ `requestId` UUID แล้วอ่าน MCP กับเว็บสาธารณะเพื่อบันทึกรายงานพร้อมข้อเสนอ; การสร้างแผนเป็นอีกขั้นที่ผู้ใช้ต้องเลือกเอง |
| `growth_plan_save` | marketing, admin | `id` UUID โดยไม่ส่ง `version` สร้างร่างแบบ idempotent; ส่งเวอร์ชันล่าสุดเพื่อแก้แผนของตนหรือ admin พร้อม plan ตาม schema เดิม การแก้เนื้อหารีเซ็ต approval และ `analysisId` เชื่อมหลักฐานจากรายงานที่มีสิทธิ์อ่าน |
| `growth_plan_tasks` | marketing, admin | เปลี่ยนงานทั้งหมดด้วย `id`, `update: { version, tasks }`; เพิ่มเวอร์ชันโดยเก็บเนื้อหาที่อนุมัติไว้ |
| `growth_plan_action` | marketing, admin | `submit` ส่งตรวจ, `export` สร้าง workflow draft ที่ยังหยุดอยู่จากเนื้อหาที่อนุมัติ; admin เพิ่ม `approve` และ `reconcile` โดย `workflowId` ใช้เฉพาะ reconcile ผลส่งออกที่ยังยืนยันไม่ได้ |
| `marketing_save` / `marketing_workflow_pause` | marketing, admin | สร้าง/แก้ setup ที่ยังปิดอยู่ หรือหยุด workflow เดิม; ไม่เปิดส่งจาก MCP |
| `research_create_topic` | marketing, admin | สร้างโจทย์ research |
| `research_request_run` | marketing, admin | สั่งรันโจทย์ (ของตัวเอง ส่วน admin รันของทุกคนได้) |
| `competitor_record_price` | marketing, admin | บันทึกราคาคู่แข่งที่ผู้ใช้เห็นจากหน้าเว็บ **ยืนยันคู่สินค้าให้ไม่ได้** ยังต้องให้คนทำ |
| `scraping_update_source` | marketing, admin | เปิด/ปิดการเก็บข้อมูลอัตโนมัติ และเปลี่ยนรอบเก็บ (24 = วันละครั้ง, 168 = สัปดาห์ละครั้ง, 720 = เดือนละครั้ง) ถ้ากำลังเก็บอยู่ ตัวอย่างจะเตือนว่าการบันทึกจะหยุดรอบนั้น |
| `scraping_run` | marketing, admin | สั่งเริ่มเก็บตอนนี้ (เข้าเว็บคู่แข่งจริง และต้องยืนยันสิทธิ์เก็บข้อมูลของเว็บนั้นไว้แล้ว) หรือหยุด |
| `webhook_retry_delivery` | admin | ส่ง event ที่ dead-letter ซ้ำ |
| `erp_replay_ingest` | admin | ให้ระบบประมวลผลข้อมูลจาก ERP ที่ fail ใหม่อีกครั้ง |
| `stock_adjust` | admin | ปรับสต็อกแบบ `set` (ยอดที่นับได้) หรือ `add` (+รับเข้า / −เสียหาย) **ได้เฉพาะคลังที่ commerce เป็นเจ้าของสต็อก** (`stock_source = 'commerce'`) คลังของ ERP ปฏิเสธตั้งแต่ขั้นขอดู ให้ไปปรับใน ERP แทน ยอดหลังปรับต้องเป็นจำนวนเต็ม ไม่ติดลบ และไม่น้อยกว่ายอดที่ถูกจองไว้ ทุกครั้งบันทึกเป็น movement ใน ledger |

ทุกครั้งที่แก้จริงจะบันทึกใน `audit_logs` เป็น `action = 'mcp.write'` และหน้า AI connectors แสดงว่าแต่ละ connection แก้ไขได้หรือไม่

## จากคำถามตลาดไปสู่แผนผ่าน MCP

1. อ่าน `growth_workspace`, `shop_traffic`, catalog และ research ที่มี เพื่อดูความพร้อม หลักฐาน และโจทย์ที่ควรตรวจต่อ
2. เรียก `market_analyse` โดยยังไม่ใส่ confirmCode ให้ผู้ใช้ดูโจทย์ พื้นที่ ช่วงวัน และข้อจำกัด แล้วเรียกซ้ำหลังผู้ใช้ยืนยัน รายงานใช้ MCP SDK client จริงผ่าน in-memory transport โดยไม่มี write scope และค้นเว็บสาธารณะตามสิทธิ์ของ provider
3. อ่าน `market_analysis_reports` แล้วเลือกข้อเสนอที่ต้องการทำ ใช้ `growth_plan_save` อย่างชัดเจนเพื่อสร้างร่าง และเชื่อม `analysisId` หากใช้หลักฐานรายงานนั้น ข้อเสนอในรายงานไม่สร้างแผนเอง
4. อ่านแผนเต็มด้วย `growth_plans` แล้ว `submit` → admin `approve` → `export` แต่ละครั้ง preview แสดงเนื้อหา หลักฐาน เวอร์ชัน และสถานะทั้งหมด การส่งออกสร้างเพียง workflow draft; การเปิดส่งต้องตรวจข้อจำกัดก่อน
5. ตรวจผลด้วย `growth_results` และปรับร่างใหม่ หากส่งออก timeout หรือไม่ทราบผล ให้ admin ตรวจ workflow ที่สร้างจริงแล้ว `reconcile`; ไม่ retry ส่งออกอัตโนมัติ

`shop_traffic` อ่าน `analytics_events`, `analytics_funnel_daily` และ search aggregates จาก Josh replica การนับ `purchase` event ไม่เท่ากับออเดอร์ที่รับชำระแล้ว และไม่ยืนยันว่า GTM/GA4 เก็บครบทุกช่องทาง ก่อนใช้ personalization ต้องตรวจ dataLayer → tag → ingestion, consent, identity, missing fields และ dedup ส่วนรายงานตลาดใช้เว็บสาธารณะ ไม่ใช่สิทธิ์เข้าถึง Facebook/Instagram/TikTok หรือ Google Trends API ครบทุกแหล่ง

ราคาที่ไม่ยืนยัน ต้นทุน กำไร และ coverage ที่ไม่ทราบต้องแสดงเป็นไม่ทราบ อ้างแหล่งข้อมูลพร้อมวันที่เก็บและข้อจำกัด ห้ามใช้ตัวเลขที่ AI คาดขึ้นแทนข้อมูลจริง

## ความปลอดภัย

- **Token:** code, access (1 ชั่วโมง) และ refresh (30 วัน) เก็บเป็น sha256 ใน `mcp_oauth_grants`
  - code และ refresh token ใช้ได้ครั้งเดียว refresh ทุกครั้งได้ token ชุดใหม่ (rotation)
  - เพิกถอนได้ที่ `/revoke`
- **ปิดบัญชีแล้วตัดทันที:** ทุก call ตรวจ `users.status` และ role ซ้ำ ปิดบัญชี staff เมื่อไร AI ใช้ token เดิมต่อไม่ได้ทันที
- **หน้า login:** ฟอร์มส่งแค่ request id ทึบ (ค่าต่างๆ เก็บไว้ฝั่ง server) จึงแก้ redirect_uri หรือ PKCE จากฟอร์มไม่ได้
  - escape ชื่อ client ที่มาจากการ register เอง
  - จำกัด 20 ครั้งต่อ 15 นาทีต่อ IP
- **Audit:** ทุก tool call บันทึกใน `audit_logs` (`action = 'mcp.tool_call'`) ว่าใคร ผ่าน AI client ไหน ใช้ tool อะไร และส่ง argument อะไร
- **client_secret:** client แบบ confidential เก็บ `client_secret` แบบ plain ใน `mcp_oauth_clients.info` เพราะ SDK เทียบค่าตรงๆ Claude และ ChatGPT ส่วนใหญ่ register เป็น public client (PKCE) ซึ่งไม่มี secret

## หน้า AI connectors ใน commerce-admin (`/ai/connectors`)

- **วิธีเชื่อมต่อ:** URL ของ MCP พร้อมปุ่มคัดลอก และขั้นตอนสำหรับ Claude, ChatGPT และ Claude Code
- **AI ที่เชื่อมต่อ:** สถานะ, ใช้ล่าสุดเมื่อไร, เรียกข้อมูลไปกี่ครั้ง และปุ่ม**ยกเลิกการเชื่อมต่อ** (token ทุกตัวของ AI ตัวนั้นใช้ไม่ได้ทันที)
- **AI อ่านอะไรไปบ้าง:** 50 ครั้งล่าสุดจาก `audit_logs`
- **สิทธิ์:** marketing เห็นและยกเลิกได้เฉพาะของตัวเอง admin เห็นของทุกบัญชี
- API: `GET /api/mcp-connections`, `GET /api/mcp-connections/activity`, `POST /api/mcp-connections/:clientId/revoke`

## Deploy

```bash
MCP_PUBLIC_URL=https://<commerce-host>   # origin สาธารณะ (https) ไม่ตั้ง = MCP ปิด
TRUST_PROXY_HOPS=1                        # หลัง nginx เพื่อให้ rate limit เห็น IP จริง
OPENAI_API_KEY=…                         # สำหรับสร้างรายงานตลาด
MARKETING_ANALYST_MODEL=…                # โมเดลที่รองรับ Responses + web_search; fallback GROWTH_AI_MODEL
```

nginx ต้องส่ง path เหล่านี้ไปที่ commerce เพราะอยู่ที่ root ไม่ได้อยู่ใต้ `/api`:

```nginx
location ~ ^/(mcp|authorize|token|register|revoke|\.well-known/oauth-) {
  proxy_pass http://commerce_platform;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Migration: `1792500000000-McpOAuth` (สร้าง `mcp_oauth_clients` และ `mcp_oauth_grants`)

## ทดสอบ

```bash
MCP_BASE=http://localhost:3100 CP_ADMIN_EMAIL=… CP_ADMIN_PASSWORD=… CP_MKT_EMAIL=… CP_MKT_PASSWORD=… \
  node apps/commerce-platform/e2e/mcp-scenarios.mjs
```

script นี้ทำตามลำดับเดียวกับ connector จริง: discovery → register → login ผิด/ถูก → PKCE → token → tools ของ marketing และ admin → refresh rotation → revoke → ขอสิทธิ์แก้ไข → ขอดู/ยืนยัน (code ผิด, ใช้ซ้ำ, เปลี่ยน argument) พร้อมตรวจ inventory และ schema ของเครื่องมือ Growth/analysis การแก้ข้อมูล Growth และแหล่งเว็บจริงไม่ถูกสั่งรันจาก script นี้

```bash
npx jest --config apps/commerce-platform/jest.config.cts --runInBand \
  apps/commerce-platform/src/mcp/mcp.growth-tools.spec.ts \
  apps/commerce-platform/src/mcp/mcp.marketing-tools.spec.ts
```

ชุดทดสอบในหน่วยความจำใช้ MCP SDK จริง ตรวจ validation, scope/role, preview เต็ม, argument binding/one-use, การส่งต่อ approval/export/reconcile และ analyst client ที่ไม่มีเครื่องมือเขียน ไม่ยืนยัน provider, ข้อมูล replica หรือ tagging ในระบบจริง

## ทำทีหลัง

- ตอนนี้ยังไม่มีคลังไหนเป็น `stock_source = 'commerce'` พอ MER clean inventory เสร็จแล้วเปลี่ยนคลังเป็นของ commerce, `stock_adjust` ก็ใช้ได้ทันที และยอดใหม่ส่งไปให้ josh เองเป็น `inventory.qty.changed` (`source: "commerce"`, ดู `docs/event-contract.md`)
