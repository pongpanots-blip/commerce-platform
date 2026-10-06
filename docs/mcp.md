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
- "เมื่อวาน ERP ส่งอะไรมาที่ fail บ้าง" (admin)

## Tools

ทุกตัวเป็น `readOnlyHint: true` และเห็นได้ตาม role ของบัญชีที่ login แบบเดียวกับ commerce-admin

| Tool | Role | อ่านอะไร |
|---|---|---|
| `competitor_prices` | marketing, admin | คู่ SKU ของเรากับสินค้าคู่แข่ง ราคาต่อกก. และส่วนต่าง กรองได้ เช่น `we_are_more_expensive` |
| `scraped_catalog_search` | marketing, admin | สินค้าและราคาที่เก็บจากเว็บคู่แข่ง |
| `scraping_sources` | marketing, admin | เว็บที่ตั้งให้เก็บ สถานะ และรอบล่าสุด |
| `research_topics` / `research_report` | marketing, admin | โจทย์ research และรายงานล่าสุดพร้อมหลักฐาน |
| `catalog_products` | marketing, admin | แค็ตตาล็อก josh (จากสำเนาใน commerce) ทั้ง SKU ชื่อ และราคาขาย |
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
| `research_create_topic` | marketing, admin | สร้างโจทย์ research |
| `marketing_workflow_create` | marketing, admin | ร่าง marketing workflow ใหม่บน josh — บันทึกเป็น **draft** เสมอ ยังไม่ส่งอะไรถึงลูกค้าจนกว่าคนจะกด activate ใน commerce-admin › Marketing workflows (ต้องตั้ง `JOSH_API_URL` + `JOSH_EVENTS_SECRET`) |
| `research_request_run` | marketing, admin | สั่งรันโจทย์ (ของตัวเอง ส่วน admin รันของทุกคนได้) |
| `competitor_record_price` | marketing, admin | บันทึกราคาคู่แข่งที่ผู้ใช้เห็นจากหน้าเว็บ **ยืนยันคู่สินค้าให้ไม่ได้** ยังต้องให้คนทำ |
| `scraping_update_source` | marketing, admin | เปิด/ปิดการเก็บข้อมูลอัตโนมัติ และเปลี่ยนรอบเก็บ (24 = วันละครั้ง, 168 = สัปดาห์ละครั้ง, 720 = เดือนละครั้ง) ถ้ากำลังเก็บอยู่ ตัวอย่างจะเตือนว่าการบันทึกจะหยุดรอบนั้น |
| `scraping_run` | marketing, admin | สั่งเริ่มเก็บตอนนี้ (เข้าเว็บคู่แข่งจริง และต้องยืนยันสิทธิ์เก็บข้อมูลของเว็บนั้นไว้แล้ว) หรือหยุด |
| `webhook_retry_delivery` | admin | ส่ง event ที่ dead-letter ซ้ำ |
| `erp_replay_ingest` | admin | ให้ระบบประมวลผลข้อมูลจาก ERP ที่ fail ใหม่อีกครั้ง |
| `stock_adjust` | admin | ปรับสต็อกแบบ `set` (ยอดที่นับได้) หรือ `add` (+รับเข้า / −เสียหาย) **ได้เฉพาะคลังที่ commerce เป็นเจ้าของสต็อก** (`stock_source = 'commerce'`) คลังของ ERP ปฏิเสธตั้งแต่ขั้นขอดู ให้ไปปรับใน ERP แทน ยอดหลังปรับต้องเป็นจำนวนเต็ม ไม่ติดลบ และไม่น้อยกว่ายอดที่ถูกจองไว้ ทุกครั้งบันทึกเป็น movement ใน ledger |

ทุกครั้งที่แก้จริงจะบันทึกใน `audit_logs` เป็น `action = 'mcp.write'` และหน้า AI connectors แสดงว่าแต่ละ connection แก้ไขได้หรือไม่

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

script นี้ทำตามลำดับเดียวกับ connector จริง: discovery → register → login ผิด/ถูก → PKCE → token → tools ของ marketing และ admin → refresh rotation → revoke → ขอสิทธิ์แก้ไข → ขอดู/ยืนยัน (code ผิด, ใช้ซ้ำ, เปลี่ยน argument) → write tool ทุกตัว (53 ข้อ เมื่อตั้ง `MCP_SKU`, `MCP_FAILED_DELIVERY`, `MCP_FAILED_INGEST`, `MCP_SOURCE_ID`, `MCP_STOCK_SKU`/`MCP_OWN_WH`/`MCP_ERP_WH` ตามที่อธิบายไว้หัวไฟล์)

## ทำทีหลัง

- ตอนนี้ยังไม่มีคลังไหนเป็น `stock_source = 'commerce'` พอ MER clean inventory เสร็จแล้วเปลี่ยนคลังเป็นของ commerce, `stock_adjust` ก็ใช้ได้ทันที และยอดใหม่ส่งไปให้ josh เองเป็น `inventory.qty.changed` (`source: "commerce"`, ดู `docs/event-contract.md`)
