# MCP server: ต่อ AI (Claude / ChatGPT) เข้ากับ commerce-platform

ให้ AI **อ่านและสรุป**ข้อมูลของ commerce ได้เหมือนต่อ connector ทั่วไป AI แก้ไข ลบ หรือสั่งงานอะไรไม่ได้

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

script นี้ทำตามลำดับเดียวกับ connector จริง: discovery → register → login ผิด/ถูก → PKCE → token → tools ของ marketing และ admin → refresh rotation → revoke (24 ข้อ)

## ทำทีหลัง

- tool ที่แก้ข้อมูลได้ เช่นส่ง dead-letter ซ้ำ หรือปรับสต็อกตอนเป็นระบบคลังเอง ต้องมี scope `commerce.write` แยก และให้ผู้ใช้ยืนยันก่อนทำ
- หน้าใน commerce-admin สำหรับดูและเพิกถอน AI ที่เชื่อมต่อแต่ละบัญชี
