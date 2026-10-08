I have designed and generated the **Developer Portal** screen (`นักพัฒนา & API — Developer Portal`) for the Commerce Platform, fully adhering to your design brief and the established visual language:

### Key Design Implementation:
1. **Visual Language & Shell Continuity**:
   - Built on the clean `#f6f8fc` canvas with `#ffffff` cards and subtle `#e1e7f0` borders.
   - Preserved the 256px sidebar featuring Developer Portal sub-navigation (ภาพรวม / Overview, คีย์เชื่อมต่อ / API Keys, เว็บฮุก / Webhooks, บันทึกส่งข้อมูล / Delivery Logs, คู่มือ & API Reference) with a back navigation link to the main commerce management platform.
   - Primary blue `#365cf5`, dark ink text `#17243b`, and secondary text `#52627a`.

2. **Actionable 3-Step Setup Onboarding**:
   - **Step 1 (Completed)**: Create an active API key.
   - **Step 2 (In Progress)**: Add a webhook endpoint (configured 2 endpoints).
   - **Step 3 (Pending)**: Test delivery ping with signature verification.

3. **Secure API Key Management**:
   - Table presenting key names, purposes, environments (`Production`, `Staging`), creation dates, and last usage.
   - Security rule enforced: Only prefixes are shown (`cp_live_9a4f••••••••`), accompanied by explicit security warning text.

4. **Webhook Subscriptions & Realistic Delivery Logs**:
   - Configured endpoints display listening event topics (`order.created`, `order.paid`, `inventory.updated`) and real-world health status (including a realistic `Failing (504 Timeout)` indicator).
   - Delivery log panel includes working status filters (**All**, **Success 2xx**, **Failed 4xx/5xx**), latency metrics, status badges, and actionable `Retry` triggers for failed events.

5. **Developer Next-Step & Authentication Docs Card**:
   - Compact cURL authentication snippet showing exact `Bearer` token authorization headers and direct links to OpenAPI v2.4 specifications and Postman collection downloads.