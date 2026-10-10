# BA: ข้อตกลงข้อมูลและขั้นตอนเชื่อมข้อมูลจริง

เอกสารนี้อธิบายสิ่งที่ทีมต้องทำต่อเพื่อให้หน้าวิเคราะห์ BA ใช้ข้อมูลจริงได้ โดยอ้างอิงโค้ดใน PR นี้และ `master` ที่ตรวจเมื่อ 10 ตุลาคม 2026 (`f1f2a48`) คำว่า **data contract หรือข้อตกลงข้อมูล** หมายถึงนิยามที่ระบบต้นทางและระบบวิเคราะห์ใช้ร่วมกัน เช่น “ออเดอร์สำเร็จเมื่อใด” “รหัสนี้เป็นรหัสสาขาหรือบัญชี” และ “ข้อมูลครบถึงเวลาใด” ไม่ใช่สัญญาทางกฎหมาย และไม่ให้สิทธิ์ใช้ข้อมูลหรือส่งข้อความเพิ่มขึ้น

ทีมพัฒนาควรเริ่มจาก API, event, ตาราง และนโยบายที่มีอยู่ แล้วตรวจหลักฐานจากเจ้าของระบบ ไม่จำเป็นต้องให้ผู้ใช้ร่างเอกสารใหม่หรือเดาชื่อ field ที่ยังไม่ทราบ รายการที่ระบุว่า “ยังไม่ยืนยัน” ด้านล่างเป็นงานค้นหาและตรวจสอบของทีม ก่อนเปิดใช้ข้อมูลจริง

## สิ่งที่มีแล้ว และสิ่งที่ยังไม่มี

| เรื่อง | มีแล้วในโค้ด | ขอบเขตที่ยังขาด |
| --- | --- | --- |
| หน้าวิเคราะห์ BA | `/analysis/customer-behavior` มีหน้าเลือกเกณฑ์, preview และหลักฐาน พร้อม URL แยก, loading, error/retry และสิทธิ์ admin/BA | production ไม่มี live source provider; จำนวนสาขาและเวลาประเมินเป็น `null` ไม่ใช่ศูนย์ |
| กลุ่มตัวอย่าง | สองเกณฑ์: สาขาที่อนุมัติแล้วแต่ยังไม่มีออเดอร์ และสาขาที่เคยซื้อซ้ำแต่ไม่ซื้อช่วงล่าสุด | การอนุมัติ/วันเริ่มสาขา/สิทธิ์สาขาและประวัติครบยังไม่มี adapter จริง |
| ขั้นตอน Journey ใน BA | แสดงสามขั้นตอนคงที่เพื่ออธิบายการตรวจสิทธิ์ → ประเมินเกณฑ์ → อ่านเหตุผล | เป็น **static guided preview** ไม่ใช่ journey builder; เพิ่ม/เชื่อม/บันทึก step จริงหรือเปิดใช้งานไม่ได้ |
| พื้นฐานการคำนวณ | schema แบบจำกัด, SQL แบบ parameterized, ผลเข้าเกณฑ์/ไม่เข้าเกณฑ์/ยังยืนยันไม่ได้ และการทดสอบฐานข้อมูลสังเคราะห์ | ยังไม่มี authenticated producer/collector และ live projection สำหรับ BA; fixture ไม่ใช่แหล่งข้อมูลลูกค้าจริง |
| ราคา/ต้นทุน/หน่วย/สต็อก | มี read-only product evidence และ editor ของราคาหรือข้อความสินค้าตามสิทธิ์เดิม | currency, tax, cost UOM, stock UOM, เวลา observation และขอบเขตองค์กรบางส่วนยังไม่ยืนยัน; BA ไม่ได้รับสิทธิ์ดูต้นทุนจากงานนี้ |
| Personalization และ daily trends | มีรายการ contract ที่ต้องเติมในหน้า BA | ยังไม่มีตัวเลือก/ผลลัพธ์จากข้อมูลจริง ไม่มีการทำนาย churn หรือการปรับเนื้อหาจริง |

`master` มี **marketing workflow editor แยกต่างหาก** ที่ `/marketing/flows/:id` จาก PR #122 อยู่แล้ว พร้อม engine และ API ของงาน marketing เรื่องนี้ไม่ทำให้หน้า BA กลายเป็น builder และไม่ได้เชื่อมผล BA เข้ากับการส่งข้อความ สิทธิ์ admin/marketing ของ editor นั้นคงเดิม ไม่เพิ่มสิทธิ์ BA หรือ MER ใน PR นี้ ดู [FlowEditorPage](../apps/commerce-admin/src/app/pages/marketing-workflow/FlowEditorPage.tsx) และ [MarketingWorkflowController](../apps/commerce-platform/src/modules/integration/marketing-workflow/presentation/marketing-workflow.controller.ts)

จุดตรวจสถานะ BA ปัจจุบันคือ [GuidedAnalysisModule](../apps/commerce-platform/src/modules/integration/guided-analysis/guided-analysis.module.ts), [GuidedAnalysisService](../apps/commerce-platform/src/modules/integration/guided-analysis/guided-analysis.service.ts) และ [GuidedAnalysisWorkspace](../apps/commerce-admin/src/app/pages/guided-analysis/GuidedAnalysisWorkspace.tsx) เอกสาร [ba-foundation-contracts.json](ba-foundation-contracts.json) เป็น checkpoint ของ foundation ก่อนมีหน้า integrated จึงต้องอ่านร่วมกับโค้ดและ [editor checkpoint](editor-data-ba-checkpoint-20261010.md)

## 1. ตัวตนและหน่วยที่นับ: สาขา บัญชี บริษัท และ Journey

เกณฑ์สองชุดปัจจุบันนับที่ **สาขา** ภายใต้ tenant/company ที่ได้รับอนุญาต ไม่ใช่ “หนึ่งคนต่อหนึ่ง device” หรือยอดรวมของ user โดยอัตโนมัติ ต้องกำหนด mapping ของ `tenantId`, `companyId`, `branchId`, customer/account และ canonical order ID จากแหล่งที่เซิร์ฟเวอร์ยืนยัน พร้อมจัดการรหัสซ้ำระหว่างองค์กร

ทุกเหตุการณ์ต้องเก็บบริษัทและสาขา **ณ เวลาที่เกิดเหตุการณ์** การเปลี่ยน active branch ภายหลังต้องไม่ย้ายออเดอร์เก่าไปสาขาใหม่ แยก `subject` ซึ่งเป็นลูกค้าที่เกี่ยวข้อง ออกจาก `actor` ซึ่งอาจเป็นพนักงานสั่งแทน ห้ามนำ staff login มาใช้เป็นตัวตนลูกค้า และห้ามใช้ browser/device/shared account เป็นหลักฐานว่าเป็นคนเดียวกัน

สำหรับ Journey จริงในอนาคต ต้องกำหนด journey/rule version, step ID, enrollment ID และ subject grain ให้ชัดก่อนบันทึกหรือรัน รวมถึงกติกาเข้าซ้ำ/ออกจาก journey และเหตุผลที่ประเมินใหม่ การสมัครบัญชีหนึ่งครั้งไม่เท่ากับเกิดสาขาหนึ่งครั้ง และบัญชีเดียวอาจใช้หลายสาขาได้ ต้องเลือก grain ของแต่ละ journey อย่างชัดเจน

จุดเริ่มตรวจคือ [AuthMe และ switch branch](../apps/commerce-admin/src/josh-admin/libs/shared-api/lib/auth/auth.api.ts), [checkout payload](../apps/commerce-admin/src/josh-admin/libs/shared-api/lib/checkout/checkout.api.ts), [Josh order copy](../apps/commerce-platform/src/modules/integration/connector/josh/orders/josh-order-copy.entity.ts) และ [organizationId](../apps/commerce-platform/src/shared-kernel/domain/base.entity.ts) API declarations บอกชื่อข้อมูลที่มี แต่ยังไม่พิสูจน์ upstream membership enforcement หรือ mapping ไป tenant

**ยังไม่ยืนยัน:** adapter ที่ให้ server-derived branch grants สำหรับ BA และความหมายของรหัสแต่ละครอบครัว `customer_metrics` ปัจจุบันสรุปตาม `user_id` และรวม `payment_pending` จึงใช้แทนจำนวน confirmed order ต่อสาขาไม่ได้ ดู [customer-metrics.service](../apps/commerce-platform/src/modules/integration/customers/customer-metrics.service.ts)

## 2. สมัคร อนุมัติ และเริ่มมีสิทธิ์ซื้อ: ใช้เหตุการณ์ต้นทางจริง

ต้องแยกอย่างน้อยสามข้อเท็จจริง: บัญชีสมัครเมื่อใด, สาขาเริ่มมีอยู่เมื่อใด และสาขาได้รับอนุมัติ/เข้าเกณฑ์ซื้อเมื่อใด พร้อมรหัสที่เสถียร สถานะก่อน/หลัง เวลาเกิดจริง source/version และนโยบายเมื่อยกเลิกหรือเพิกถอนการอนุมัติ

repository มี API สมัคร/login และข้อมูล onboarding แต่ยังไม่พบ authoritative transition ของการอนุมัติ **บัญชีลูกค้าหรือสาขา** ที่พร้อมใช้กับเกณฑ์นี้ การอนุมัติเครดิต, KYC, staff admin access และ developer key เป็นคนละเรื่อง ห้ามเปลี่ยนชื่อ event เหล่านั้นเป็น `account_application_approved` เพื่อให้หน้าดูสมบูรณ์

ทีมควรไล่ endpoint/service ต้นทางของการสมัครและการอนุมัติ อ่าน schema/event ที่มีอยู่ และยืนยันกับเจ้าของระบบว่า field/time ใดคือ source of truth ถ้าไม่มี event ให้เสนอ adapter จาก transaction ที่เกิดการเปลี่ยนสถานะจริง พร้อมแผน backfill ที่ตรวจสอบได้ การพบ `created_at` ในตาราง copy เพียงอย่างเดียวไม่พิสูจน์วันเริ่มบัญชีหรือสาขา

หลักฐานและสิ่งที่ค้นไม่พบอยู่ใน [instrumentation audit](ba-foundation-instrumentation-audit.json) หัวข้อ `approvalTransition` และ [event contracts](../apps/commerce-platform/src/modules/integration/analytics-foundation/event-contracts.ts) ปัจจุบันยังไม่เพิ่ม approval event ที่ไม่มีหลักฐาน

## 3. ออเดอร์ที่ยืนยัน: ไม่ใช้ checkout หรือ browser purchase แทน

ต้องกำหนดว่า “accepted/confirmed order” หมายถึง transaction สำเร็จใดในแต่ละช่องทาง ได้แก่ commerce checkout, Josh, เครดิต และพนักงานสั่งแทน รวม canonical order ID เพื่อไม่ให้ออเดอร์เดียวที่ปรากฏหลายระบบถูกนับซ้ำ การยกเลิก คืนเงิน แก้ไขออเดอร์ และการยืนยันล่าช้าต้องมีนโยบาย version/correction ที่ชัดเจนก่อนนำมาคำนวณ

ฝั่ง commerce มีจุดเริ่มตรวจหลักฐานต้นทาง: [OrderCheckoutSaga.onPaymentPaid](../apps/commerce-platform/src/modules/commerce/order/application/order-checkout.saga.ts) เปลี่ยน `pending_payment` เป็น `confirmed` และสร้าง `order.confirmed` ใน transaction เดียวกัน แต่ payload ปัจจุบันมีเพียง order ID และ storefront checkout DTO ยังไม่ให้หลักฐานบริษัท/สาขาครบ จึงต้องเติม/ตรวจ occurrence mapping ก่อนใช้กับ BA

`checkout_started`, click, thank-you page และ GTM `purchase` เป็นพฤติกรรม browser ไม่ใช่หลักฐานว่าเซิร์ฟเวอร์ commit ออเดอร์สำเร็จ ส่วน Josh `order.snapshot` เป็นสำเนาสถานะล่าสุด ไม่ใช่ immutable acceptance history ต้องหาต้นทางที่ยืนยันเวลาและ transition ได้ ดู [Josh events](../apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.service.ts)

**ยังไม่ยืนยัน:** canonical acceptance ครบทุกช่องทางและ branch mapping ของแต่ละออเดอร์ ห้ามเติมค่าจาก active branch ปัจจุบันเมื่อ occurrence branch ไม่ทราบ

## 4. เวลา การส่งซ้ำ และคำว่า “ข้อมูลครบ”

event envelope ต้องแยก `eventId`, `occurredAt` (เวลาเกิด), `receivedAt` (เวลารับ), source/environment, occurrence identity และหลักฐาน acceptance ใช้ UTC instant ที่มี offset ชัดเจน ไม่ใช้เวลาที่เปิดหน้าหรือกด preview เป็นเวลา freshness ของแหล่งข้อมูล

outbox ปัจจุบันเก็บ row ID และเวลาสร้าง row แล้ว relay ส่งเป็น `eventId`/`occurredAt` ของ delivery จึงต้องตรวจ mapping ว่าเวลาใดเป็น domain occurrence และเวลาใดเป็น outbox insertion ก่อนใช้กับ BA ดู [EventEmitterBus](../apps/commerce-platform/src/shared-kernel/infrastructure/event-emitter.bus.ts) และ [OutboxRelayWorker](../apps/commerce-platform/src/shared-kernel/infrastructure/outbox-relay.worker.ts) ห้ามสมมติว่าเวลาสองชนิดนี้เหมือนกัน

การส่งซ้ำ event เดิมต้องเก็บ receipt เดิม; จำนวนออเดอร์ dedup ด้วย tenant + canonical order identity เพิ่มอีกชั้น ถ้ารหัสเดียวกันมี branch/time ขัดแย้งให้แยกตรวจ reconciliation ไม่เลือกค่าล่าสุดเงียบ ๆ

“ไม่พบออเดอร์” จะหมายถึงศูนย์ได้เมื่อมีหลักฐานว่าประวัติ **ครบตลอดช่วงที่ถาม** และระบุตัวตนครบแล้ว ต้องมี complete-from/through watermark, เวลาที่รับรอง, source revision และนโยบาย late arrival/backfill ช่วงคำนวณปัจจุบันคือ `[เวลาเริ่ม, เวลาประเมิน)` รวมจุดเริ่มและไม่รวมจุดสิ้นสุด

ตัวอย่างเกณฑ์ “ไม่เคยสั่ง” ต้องตรวจตั้งแต่วันเริ่มสาขา รวมออเดอร์ก่อนอนุมัติ และ foundation จำกัดช่วงสูงสุด 365 วัน ถ้าวันเริ่มไม่ทราบหรือประวัติยาวกว่าขอบเขตที่ตรวจได้ ผลต้องเป็น **ยังยืนยันไม่ได้ (`unknown`)** ไม่ใช่ zero/excluded การมี raw traffic 90 วันหรือหน้ารายการว่างไม่พิสูจน์ lifetime completeness; aggregate เก่าอาจมี grain คนละชนิด ดู [Josh insights](../apps/commerce-platform/src/modules/integration/connector/josh/josh-insights.ts)

โค้ดรักษา three-valued logic: `NOT unknown` ยังเป็น unknown; นับ unknown แยกจากไม่เข้าเกณฑ์ ดู [segment contracts](../apps/commerce-platform/src/modules/integration/analytics-foundation/segment-contracts.ts) และ [fixture executor](../apps/commerce-platform/src/modules/integration/analytics-foundation/fixture-executor.ts) production adapter ต้องมีหลักฐาน coverage ของจริงแทน synthetic grants/coverage

## 5. GTM ที่มีอยู่: ตรวจ adapter และ configuration ก่อนเชื่อม

ตามบริบทงานมี GTM อยู่แล้ว แต่การมี container ไม่ได้ยืนยันว่า event, consent หรือ identity mapping ถูกต้อง repository audit นี้ไม่ได้เข้าบัญชี GTM หรือ storefront production และยังไม่ยืนยัน tag/trigger ที่ติดตั้งจริง รวมถึงยังไม่มี BA producer/collector ที่ตรวจ sender และแปลงข้อมูลอย่างครบถ้วน

งานถัดไปคืออ่าน configuration ที่มีอยู่โดยได้รับสิทธิ์ ตรวจ SPA navigation, History Change trigger, application event, branch switch และ login/logout ว่าไม่ยิงซ้ำหรือค้างตัวตนข้ามบัญชี ตรวจ preview/debug ด้วยข้อมูลทดสอบที่ได้รับอนุญาต แล้วทำ mapping ระหว่างชื่อ event เดิมกับ schema ที่ยืนยันแล้ว ไม่สร้าง container ใหม่เพียงเพราะค้นโค้ดนี้ไม่พบ

browser `branch_selected`/`checkout_started` ใช้อธิบายพฤติกรรมได้เมื่อ occurrence และ consent เชื่อถือได้ แต่ `order_accepted` ต้องมาจาก server confirmation การระบุ `source: commerce_server` ใน JSON ไม่ใช่การ authenticate sender ต้องมี adapter ที่ตรวจความน่าเชื่อถือและจำกัด payload จริง

## 6. Personalization: ราคา สต็อก สิทธิ์ และความยินยอม

ก่อนปรับเนื้อหาหรือสินค้าให้แต่ละกลุ่ม ต้องระบุวัตถุประสงค์และ subject grain, กติกาสินค้าที่แสดงได้, currency/tax, หน่วยราคาและ stock, ราคาเฉพาะสัญญาลูกค้า, branch/warehouse scope, source timestamp และ fallback เมื่อข้อมูลเก่าหรือไม่ทราบ ห้ามแปลงหน่วย/รวมสต็อก/คาดเดาราคาเพื่อสร้างคำแนะนำ

อ่าน native ownership ตามที่ระบบรับรอง: missing key, explicit null, แหล่งอ่านล้มเหลว และสำเนาเก่ามีความหมายต่างกัน เก็บ provenance และเวลาที่ **สังเกตข้อมูลจริง** แยกจากเวลาที่ copy/update row ตัวเลขราคาที่แก้สำเร็จหรือ receipt ใน admin ไม่พิสูจน์ราคา/สินค้าคงคลังที่ storefront ใช้อยู่ ดู [ProductEvidenceService](../apps/commerce-platform/src/modules/commerce/product-evidence/product-evidence.service.ts) และ [content checkpoint](product-content-editor-checkpoint-20261010.md)

`pdpa_consent` และ `marketing_consent` ใน API เป็นคนละหลักฐานกับ analytics purpose หรือ GTM consent enforcement ต้องตรวจ purpose/basis, policy version, granted/denied/unknown, retention/deletion และการ reset identity เมื่อ logout ตามนโยบายที่มีอยู่ ไม่เปิดสิทธิ์เพิ่มจาก boolean หนึ่งตัว ดู [privacy API](../apps/commerce-admin/src/josh-admin/libs/shared-api/lib/profile/privacy.api.ts) และ audit หัวข้อ `consentAndSensitivePayloads`

payload วิเคราะห์ควรใช้รหัสและข้อมูลที่จำเป็น ไม่ใส่ email, โทรศัพท์, ที่อยู่, token, payment secret, search free text หรือ order remark โดยอัตโนมัติ ต้องมี propagation test เมื่อถอน consent ลบบัญชี หรือเปลี่ยนสิทธิ์ก่อนใช้ cache/projection จริง

## 7. Daily trends: นิยามตัวเลขและความสดใหม่ก่อนทำกราฟ

แต่ละ metric ต้องมีชื่อ/นิยาม, grain, source, timezone ของวัน, ช่วงเวลา, numerator/denominator, dedup, correction/refund policy, watermark และ source revision เช่น “จำนวน confirmed orders ต่อสาขาต่อวัน” ต่างจาก “จำนวน browser purchase events” และยอดขายยังต้องนิยาม currency/tax/คืนเงิน

หน้า trend ต้องแสดงวันและเวลาที่ข้อมูลครบถึง, เวลาประเมิน, ส่วนที่ provisional/มาช้า และข้อความ unavailable/unknown เมื่อ source ขาด ห้ามแสดงเส้นศูนย์แทน source failure ต้องทดสอบข้อมูลข้ามเที่ยงคืน/timezone, reimport ซ้ำ, backfill, late order และ tenant/branch ที่ใช้รหัสเดียวกัน

แหล่งเริ่มสำรวจคือ Josh analytics/traffic และ confirmed-order history ที่ตรวจได้แล้ว ไม่ถือว่า reader ของ `analytics_funnel_daily` หรือ `customer_metrics` พร้อมใช้กับทุก metric ขณะนี้ **ยังไม่มี daily-trend provider/contract ที่ลงทะเบียนสำหรับ guided BA**

## แผนทำงานต่อและเกณฑ์รับงาน

| ระยะ | งานของทีม | หลักฐานก่อนถือว่าเสร็จ |
| --- | --- | --- |
| 1. ตรวจต้นทาง | ไล่ signup/approval/order/identity/consent API และ event เดิม ตรวจ GTM แบบอ่านอย่างเดียว บันทึกความหมายและช่องว่างจาก source จริง | ยกตัวอย่าง record/event ที่ลบข้อมูลระบุตัวบุคคลแล้วได้; แสดง mapping และ field/time ที่ยังไม่ทราบโดยไม่เดา |
| 2. Identity และ scope | ทำ adapter ของ tenant/company/branch grants ฝั่งเซิร์ฟเวอร์ แยก subject/actor และยืนยัน branch birth/eligibility | same branch ID ต่าง tenant ไม่ปน; client ปลอม scope ไม่สำเร็จ; logout/switch branch ไม่แก้เหตุการณ์เก่า |
| 3. Event และ history | ทำ authenticated adapters, canonical order dedup, occurrence/receipt timestamps และ completeness/late/backfill coverage | duplicate ไม่เพิ่ม count; conflicting identity ถูกแยกตรวจ; ข้อมูลไม่ครบให้ unknown; source outage ไม่ให้ empty success |
| 4. BA อ่านข้อมูลจริง | ลงทะเบียน live read-only provider แทน test injection และต่อหน้าเกณฑ์/หลักฐานกับ source version | ตัวอย่าง hand-calculated ตรงฐานข้อมูล; counts/evaluatedAt มีหลักฐาน; expiry/profile/late event/deletion/scope change ประเมินใหม่ได้ |
| 5. Trends และ personalization preview | อนุมัตินิยาม metric/หน่วย/ราคา/stock/consent แล้วทำ read-only preview ทีละ use case | ไม่มี stale-price/stock fallback เงียบ ๆ; unavailable/retry/mobile/keyboard ใช้ได้; สิทธิ์ BA ไม่ขยายไปข้อมูลต้นทุนโดยอ้อม |
| 6. Journey จริง หากมีขอบเขตงานใหม่ | กำหนด versioned graph, branch/account enrollment grain, draft/save/review/outcome และข้อกำหนด interrupted flow ก่อนเชื่อม builder เดิม | บันทึกได้จริงก่อนแสดง success; duplicate/retry/conflict/back-forward และ revision recovery ผ่าน; ไม่อ้าง static steps ว่าเป็น editor |

ทุกระยะต้องทดสอบชื่อ/รหัสหาย, null, event มาช้า, เวลาในอนาคต, rejected order, ยกเลิก/คืนเงิน, ประวัติไม่ครบ, สาขาก่อนอนุมัติ, role ถูกเปลี่ยน/ปิดบัญชีระหว่างใช้งาน, tenant collision, consent denied/unknown และการลบข้อมูล งาน UI acceptance ของผู้ใช้ช่วยตรวจความเข้าใจและเส้นทางใช้งาน แต่ไม่แทนการพิสูจน์ source truth หรือ persistence

งานตามเอกสารนี้ยังเป็นแผน **read-only/preview** ไม่เปิด audience export, campaign enrollment, notification, coupon, webhook หรือ outbound activation จาก BA การเชื่อมปลายทางส่งจริงและการเปลี่ยน production ต้องได้รับขอบเขตงานแยกต่างหาก การเปิด draft PR นี้ไม่ใช่การอนุมัติ deploy หรือ run journey

## จุดอ้างอิงสำหรับเริ่ม implement

- [Guided BA request/response และรายการ missing contracts](../apps/commerce-platform/src/modules/integration/guided-analysis/guided-analysis.contracts.ts)
- [สองเกณฑ์ต้นฉบับและ AST](../apps/commerce-platform/src/modules/integration/analytics-foundation/guided-previews.ts)
- [Event schema](../apps/commerce-platform/src/modules/integration/analytics-foundation/event-contracts.ts), [segment schema](../apps/commerce-platform/src/modules/integration/analytics-foundation/segment-contracts.ts) และ [synthetic fixtures](../apps/commerce-platform/src/modules/integration/analytics-foundation/synthetic-fixtures.ts)
- [Source audit และสถานะที่ยังไม่ยืนยัน](ba-foundation-instrumentation-audit.json), [foundation checkpoint](ba-foundation-contracts.json), [editor/evidence/MER checkpoint](editor-data-ba-checkpoint-20261010.md)

ไฟล์เหล่านี้เป็นจุดเริ่มค้นหลักฐาน ไม่ใช่ข้อยืนยันว่า production มีข้อมูลครบแล้ว ทีมควรเติม adapter และทดสอบจากขอบเขตเล็กที่ตรวจได้ก่อน แทนการเติมตัวเลขหรือขั้นตอนที่ดูใช้งานจริงแต่ยังไม่มีแหล่งรองรับ
