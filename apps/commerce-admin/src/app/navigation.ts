import type { NavGroup, NavItem } from '@cp/ui';

/**
 * The admin sidebar, in task-based sections. One source for the sidebar, the page headers (each item's
 * one-line `description`), role landing and deep links (src/lib/landing.ts) and the tests.
 * - `more`: less used, behind the section's "show more" (search still finds it).
 * - Settings › Advanced (`advanced`): ops-only, logs, testing tools and josh replica views; collapsed.
 * - `activeFor`: sub-pages (create / edit / detail) outside `to` that highlight the item.
 * Labels and descriptions are UI copy keys (libs/ui/src/locales/ui-messages.json, TH + EN).
 * The pre-redesign sidebar is frozen in navigation.legacy.ts (old → new mapping, redirects, tests).
 */
export type SectionId = 'catalog' | 'orders' | 'customers' | 'marketing' | 'reports' | 'settings' | 'advanced';

export interface Section { id: SectionId; title: string; icon: string; description: string }

export const SECTIONS: readonly Section[] = [
  { id: 'catalog', title: 'แคตตาล็อกสินค้า', icon: 'inventory_2', description: 'สินค้า หมวดหมู่ แบรนด์ รูปภาพ ราคา และสต็อก' },
  { id: 'orders', title: 'ออเดอร์และการเงิน', icon: 'receipt_long', description: 'คำสั่งซื้อ การจัดส่ง การชำระเงิน ใบแจ้งหนี้ และเครดิต' },
  { id: 'customers', title: 'ลูกค้าและงานบริการ', icon: 'support_agent', description: 'บริษัทลูกค้า ผู้ใช้ งาน CS แชต และการติดตามลูกค้าเก่า' },
  { id: 'marketing', title: 'การตลาด', icon: 'campaign', description: 'แคมเปญ คูปอง โปรโมชัน กลุ่มลูกค้า ข้อความ และข้อมูลคู่แข่ง' },
  { id: 'reports', title: 'รายงานและข้อมูล', icon: 'monitoring', description: 'ยอดขาย ออเดอร์ สินค้า ลูกค้า ราคา และการเข้าชม' },
  { id: 'settings', title: 'ตั้งค่าและทีมงาน', icon: 'settings', description: 'บัญชีทีมงาน สิทธิ์เข้าใช้งาน และรหัสผ่าน' },
  { id: 'advanced', title: 'ตั้งค่าขั้นสูง', icon: 'tune', description: 'ระบบเชื่อมต่อ บันทึก เครื่องมือทดสอบ และข้อมูลสำรองจาก josh (ใช้ไม่บ่อย)' },
];

type NavEntry = Omit<NavItem, 'icon' | 'badge'> & { description: string };

const H_INTEGRATIONS = 'การเชื่อมต่อและ ERP';
const H_LOGS = 'บันทึกและตรวจปัญหา';
const H_TESTING = 'ทดสอบและทดลอง';
const H_MARKETING = 'การตลาด: ติดตามและตั้งค่า';
const H_REPLICA = 'ข้อมูลจาก josh (อ่านอย่างเดียว)';
const REPLICA = 'ดูข้อมูลจาก replica ของ josh แบบอ่านอย่างเดียว ใช้ได้แม้ josh ล่ม งานจัดการทำที่หน้าหลักของหมวดนั้น';

const NAV: Record<SectionId, NavEntry[]> = {
  catalog: [
    { to: '/j/allproducts', label: 'จัดการสินค้า', activeFor: ['/j/product'], description: 'ค้นหา แก้ไข และเพิ่มสินค้าที่ขายบนร้านค้า' },
    { to: '/products', label: 'แคตตาล็อกแพลตฟอร์ม', description: 'สินค้าตาม SKU ในแพลตฟอร์ม และอนุมัติสินค้าใหม่จาก ERP' },
    { to: '/j/categories', label: 'จัดการหมวดหมู่', description: 'จัดโครงสร้าง ลำดับ และรูปของหมวดหมู่บนร้านค้า' },
    { to: '/j/brands', label: 'แบรนด์', description: 'รายชื่อแบรนด์และโลโก้ที่ใช้กับสินค้า' },
    { to: '/j/product/bulk-image-upload', label: 'อัปโหลดรูปสินค้าหลายรายการ', end: true, description: 'อัปโหลดรูปให้สินค้าหลายรายการพร้อมกัน' },
    { to: '/j/suppliers', label: 'จัดการซัพพลายเออร์', activeFor: ['/j/supplier'], description: 'ซัพพลายเออร์ที่ส่งสินค้าให้ร้านและข้อมูลติดต่อ' },
    { to: '/product-prices', label: 'ราคาสินค้า', description: 'ราคาขาย ราคาสั่ง และ MOQ ตรวจและอนุมัติราคาที่ ERP เปลี่ยน' },
    { to: '/product-master-queue', label: 'คิวข้อมูลสินค้าจาก ERP', description: 'ตรวจและอนุมัติข้อมูลสินค้าที่ ERP เปลี่ยน เช่น หน่วย แพ็ก แบรนด์ และ VAT' },
    { to: '/stock-moves', label: 'ความเคลื่อนไหวสต็อก', description: 'บันทึกการรับเข้า ปรับยอด และโอนสินค้าระหว่างคลัง' },
    { to: '/erp/inventory-warehouse', label: 'สต็อกแยกตามคลัง', description: 'ยอดสต็อกของสินค้าแต่ละรายการในแต่ละคลัง' },
    { to: '/j/product/create', label: 'เพิ่มสินค้า', end: true, more: true, description: 'สร้างสินค้าใหม่บนร้านค้า' },
    { to: '/j/product/video-upload', label: 'อัปโหลดวิดีโอสินค้า', end: true, more: true, description: 'อัปโหลดวิดีโอประกอบหน้าสินค้า' },
    { to: '/prices/staff', label: 'ราคาลูกค้า / ราคาสัญญา (commerce)', more: true, description: 'ราคาเฉพาะลูกค้าและราคาสัญญาที่ commerce ดูแล' },
    { to: '/order-periods', label: 'รอบสั่งซื้อ supplier', more: true, description: 'รอบสั่งซื้อสินค้าสั่งล่วงหน้า วันส่ง และวันปิดรับจาก ERP' },
  ],
  orders: [
    { to: '/j/order', label: 'จัดการออเดอร์', description: 'ค้นหาและติดตามคำสั่งซื้อ เปิดดูรายละเอียดและสถานะ' },
    { to: '/j/shipments', label: 'จัดการการจัดส่ง', description: 'ติดตามการจัดส่งและอัปเดตสถานะพัสดุ' },
    { to: '/j/payment-transactions', label: 'จัดการการชำระเงิน', description: 'รายการชำระเงินของลูกค้าและสถานะการชำระ' },
    { to: '/j/invoices', label: 'ใบแจ้งหนี้ค้างชำระ', description: 'ใบแจ้งหนี้ที่เลยกำหนดชำระ เพื่อติดตามกับลูกค้า' },
    { to: '/j/billing', label: 'วางบิล', description: 'ค้นหาบริษัท ดูเครดิตและใบแจ้งหนี้ทั้งหมด' },
    { to: '/j/credit-terms', label: 'ใบสมัครเครดิต', description: 'พิจารณาใบสมัครเครดิตเทอมของลูกค้า' },
    { to: '/j/credit-notes', label: 'จัดการใบลดหนี้', description: 'ออกและติดตามใบลดหนี้' },
    { to: '/j/credit-backs', label: 'จัดการคืนเครดิต', description: 'คืนเครดิตให้ลูกค้าและติดตามสถานะ' },
    { to: '/j/refunds', label: 'คืนสินค้าและคืนเงิน', description: 'คำขอคืนสินค้าและการคืนเงินของลูกค้า' },
    { to: '/j/cs/delivery-schedule', label: 'ตารางรอบส่ง', description: 'รอบจัดส่งและเกณฑ์การจัดส่ง' },
    { to: '/j/order/import', label: 'นำเข้าออเดอร์', end: true, more: true, description: 'นำเข้าคำสั่งซื้อจากไฟล์' },
    { to: '/j/batch-sticker', label: 'พิมพ์สติกเกอร์', more: true, description: 'พิมพ์สติกเกอร์ติดกล่องให้หลายออเดอร์พร้อมกัน' },
    { to: '/orders', label: 'ออเดอร์แพลตฟอร์ม', more: true, description: 'คำสั่งซื้อในแพลตฟอร์ม commerce พร้อมการชำระเงินและการจองสินค้า' },
    { to: '/reservations', label: 'การจองสินค้า', more: true, description: 'สต็อกที่ถูกจองระหว่างชำระเงิน ทั้งที่จอง ยืนยัน ปล่อย และหมดอายุ' },
  ],
  customers: [
    { to: '/j/company', label: 'จัดการบริษัท', description: 'บริษัทลูกค้า B2B ข้อมูล เครดิตเทอม และสิทธิ์สั่งซื้อ' },
    { to: '/j/allusers', label: 'จัดการผู้ใช้', description: 'ค้นหาบัญชีผู้ใช้ของลูกค้าและดูประวัติ' },
    { to: '/cs', label: 'งานบริการลูกค้า', description: 'สั่งแทนลูกค้า คำขอสินค้าตัวอย่าง และรวมบัญชีในที่เดียว' },
    { to: '/livechat', label: 'แชตกับลูกค้า', description: 'อ่านและตอบแชตของลูกค้า' },
    { to: '/j/cs/sample-requests', label: 'Sample requests', description: 'คำขอสินค้าตัวอย่างจากลูกค้า' },
    { to: '/j/price-requests', label: 'คำขอราคา', description: 'คำขอราคาพิเศษจากลูกค้า' },
    { to: '/j/active-offers', label: 'ข้อเสนอราคาที่ใช้งาน', description: 'ราคาพิเศษเฉพาะลูกค้า (private price) ที่ยังใช้งานอยู่' },
    { to: '/j/kyc', label: 'ตรวจสอบตัวตนลูกค้า', description: 'ตรวจเอกสารยืนยันตัวตน (KYC) ที่รอพิจารณา' },
    { to: '/reports/winback', label: 'ติดตามลูกค้าเก่า', description: 'ลูกค้าที่หยุดสั่งซื้อ และงานติดตามของฝ่ายขาย' },
    { to: '/j/membership-tiers', label: 'ระดับสมาชิก', more: true, description: 'กำหนดระดับสมาชิกและเงื่อนไขของแต่ละระดับ' },
    { to: '/j/cs/cart-move-categories', label: 'หมวดที่ย้ายของในตะกร้าได้', more: true, description: 'หมวดสินค้าที่ย้ายข้ามรอบจัดส่งได้เพื่อปลดล็อกส่งฟรี' },
    { to: '/customers', label: 'ลูกค้าแพลตฟอร์ม', more: true, description: 'ข้อมูลติดต่อและรายละเอียดลูกค้าในแพลตฟอร์ม commerce' },
  ],
  marketing: [
    { to: '/marketing/growth', label: 'วางแผนการเติบโต', end: true, activeFor: ['/marketing/growth/results', '/marketing/growth/companies'], description: 'เริ่มจากข้อมูลลูกค้าและยอดขาย แล้ววางแผนแคมเปญที่ผ่านการตรวจทาน' },
    { to: '/j/promotions/campaigns', label: 'จัดการแคมเปญ', description: 'สร้างและติดตามแคมเปญโปรโมชัน' },
    { to: '/j/coupons', label: 'จัดการคูปอง', activeFor: ['/j/coupon'], description: 'สร้าง แก้ไข และติดตามการใช้คูปอง' },
    { to: '/j/promotions-mechanic', label: 'Promotion mechanics', description: 'กติกาส่วนลด เช่น ซื้อครบลด หรือซื้อ X แถม Y' },
    { to: '/j/promotion-product-sets', label: 'Promotion product sets', description: 'ชุดสินค้าที่ใช้กับโปรโมชันและคูปอง' },
    { to: '/j/promotion-pages', label: 'Promotion pages', description: 'หน้าโปรโมชันบนร้านค้า' },
    { to: '/j/segments', label: 'จัดการกลุ่มลูกค้า', description: 'กำหนดกลุ่มลูกค้าเป้าหมายสำหรับแคมเปญและคูปอง' },
    { to: '/j/marketing/push-campaigns', label: 'Push campaigns', description: 'ส่งการแจ้งเตือนแบบ push ถึงลูกค้า' },
    { to: '/marketing/workflows', label: 'เวิร์กโฟลว์การตลาด', description: 'ข้อความอัตโนมัติที่ส่งตามพฤติกรรมลูกค้า' },
    { to: '/j/marketing/competitor-prices', label: 'เทียบราคาคู่แข่ง', description: 'เทียบราคาสินค้าของเรากับเว็บคู่แข่ง' },
    { to: '/marketing/growth/plans', label: 'แผนและปฏิทิน', more: true, description: 'แผนการตลาดที่บันทึกไว้และปฏิทินงาน' },
    { to: '/marketing/analyst', label: 'ผู้ช่วยวิเคราะห์การตลาด', more: true, description: 'ถามคำถามการตลาดกับผู้ช่วย AI จากข้อมูลในระบบ' },
    { to: '/marketing/research', label: 'งานวิจัยตลาด', more: true, description: 'รายงานวิจัยตลาดและหัวข้อที่ติดตาม' },
    { to: '/marketing/restaurants', label: 'ค้นหาตลาดร้านอาหาร', more: true, description: 'สำรวจร้านอาหารบนแผนที่เพื่อหาลูกค้าใหม่' },
    { to: '/j/marketing/notify-templates', label: 'Template ข้อความ', more: true, description: 'แม่แบบข้อความสำหรับแจ้งเตือนลูกค้า' },
    { to: '/j/marketing/welcome-lead-email', label: 'อีเมลต้อนรับลีด', more: true, description: 'อีเมลต้อนรับลูกค้าที่สนใจ (ลีด) รายใหม่' },
    { to: '/j/smart-links', label: 'Smart links', more: true, description: 'ลิงก์ที่ติดตามผลได้ พาลูกค้าไปยังหน้าที่เลือก' },
    { to: '/j/marketing-links', label: 'Marketing links', more: true, description: 'สร้างลิงก์การตลาดพร้อม UTM' },
    { to: '/j/marketing/scraped-catalog', label: 'คลังข้อมูลเว็บคู่แข่ง', more: true, description: 'สินค้าที่เก็บมาจากเว็บคู่แข่ง' },
    { to: '/j/bot/intent-rules', label: 'Bot · intent rules', more: true, description: 'กติกาที่ช่วยให้แชตบอตเข้าใจคำถามของลูกค้า' },
    { to: '/j/bot/workflows', label: 'Bot · workflows', more: true, description: 'ลำดับการตอบของแชตบอต' },
    { to: '/j/bot/templates', label: 'Bot · templates', more: true, description: 'ข้อความสำเร็จรูปของแชตบอต' },
  ],
  reports: [
    { to: '/reports/sales', label: 'รายงานยอดขาย', description: 'ยอดขายตามช่วงเวลา เทียบกับช่วงก่อนหน้า' },
    { to: '/reports/orders', label: 'รายงานออเดอร์', description: 'รายการและสรุปคำสั่งซื้อของร้าน' },
    { to: '/reports/products', label: 'รายงานสินค้า', description: 'สินค้าขายดี ยอดขาย และสถานะสินค้า' },
    { to: '/reports/customers', label: 'รายงานลูกค้าและบริษัท', description: 'ลูกค้าและบริษัท ยอดซื้อ และการสั่งซื้อล่าสุด' },
    { to: '/reports/prices', label: 'รายงานราคาขาย', description: 'ราคาที่ลูกค้าแต่ละสาขาเห็น และใบเสนอราคา' },
    { to: '/reports/order-targetgroup', label: 'กลุ่มลูกค้าเป้าหมาย', description: 'ออเดอร์แยกตามกลุ่มลูกค้าเป้าหมาย' },
    { to: '/reports/traffic', label: 'การเข้าชม', description: 'การเข้าชมร้านค้าและพฤติกรรมการใช้งาน' },
    { to: '/reports/health', label: 'สุขภาพระบบ', description: 'ข้อผิดพลาดและปัญหาที่กระทบการขายตอนนี้' },
  ],
  settings: [
    { to: '/settings/staff', label: 'บัญชีทีมงาน', description: 'เพิ่มทีมงาน กำหนดบทบาท และปิดบัญชี' },
    { to: '/settings/josh-staff', label: 'บัญชีทีมงานร้านค้า', description: 'บัญชีทีมงานฝั่งร้านค้า (josh)' },
    { to: '/j/admin-access', label: 'Admin access requests', description: 'คำขอใช้งาน web-admin ของร้านค้าที่รออนุมัติ' },
    { to: '/account/password', label: 'เปลี่ยนรหัสผ่าน', description: 'เปลี่ยนรหัสผ่านของคุณ' },
  ],
  advanced: [
    // Integrations & ERP
    { to: '/integrations', label: 'การเชื่อมต่อ', heading: H_INTEGRATIONS, description: 'ระบบภายนอกที่เชื่อมกับแพลตฟอร์มและสถานะการเชื่อมต่อ' },
    { to: '/webhooks', label: 'เหตุการณ์ขาเข้า', heading: H_INTEGRATIONS, description: 'เหตุการณ์ที่ระบบภายนอกส่งเข้ามา' },
    { to: '/subscriptions', label: 'การส่งเหตุการณ์ขาออก', heading: H_INTEGRATIONS, description: 'ปลายทางที่รับเหตุการณ์จากแพลตฟอร์ม (webhook ขาออก)' },
    { to: '/sync-jobs', label: 'งานซิงก์ข้อมูล', heading: H_INTEGRATIONS, description: 'งานซิงก์ข้อมูลกับระบบภายนอกและผลลัพธ์' },
    { to: '/erp/webhook-platforms', label: 'แพลตฟอร์มปลายทาง', heading: H_INTEGRATIONS, description: 'แพลตฟอร์มที่รับข้อมูลจาก ERP hub' },
    { to: '/erp-ingest', label: 'ERP ingest', heading: H_INTEGRATIONS, description: 'ข้อมูลที่รับจาก ERP เข้าแพลตฟอร์ม' },
    { to: '/ai/connectors', label: 'การเชื่อมต่อ AI', heading: H_INTEGRATIONS, description: 'เชื่อมเครื่องมือ AI (MCP) กับข้อมูลแพลตฟอร์มแบบอ่านอย่างเดียว' },
    // Logs & troubleshooting
    { to: '/erp/inbound-log', label: 'บันทึกข้อมูลขาเข้า', heading: H_LOGS, description: 'บันทึกข้อมูลที่ ERP ส่งเข้ามา' },
    { to: '/erp/webhook-dead-letter', label: 'รายการส่งไม่สำเร็จ', heading: H_LOGS, description: 'ข้อมูลที่ส่งไม่สำเร็จ ตรวจสอบและส่งใหม่' },
    { to: '/erp/josh-logs', label: 'ERP log ของ josh', heading: H_LOGS, description: 'บันทึกการเรียก ERP ฝั่ง josh' },
    { to: '/josh-api-logs', label: 'API log ของ josh', heading: H_LOGS, description: 'บันทึกการเรียก API ของ josh' },
    // Testing & experiments
    { to: '/erp/simulator', label: 'ทดสอบการเชื่อมต่อ ERP', heading: H_TESTING, description: 'จำลองข้อมูล ERP เพื่อทดสอบการเชื่อมต่อ' },
    { to: '/j/erp/webhook-simulator', label: 'ทดสอบเหตุการณ์ ERP ของร้านค้า', heading: H_TESTING, description: 'ส่งเหตุการณ์ ERP ทดสอบไปยังร้านค้า' },
    { to: '/erp-stock', label: 'ERP stub stock', heading: H_TESTING, description: 'สต็อกจำลองของ ERP สำหรับทดสอบ' },
    { to: '/j/kbank/testing-console', label: 'KBank testing console', heading: H_TESTING, description: 'ทดสอบการชำระเงินผ่าน KBank' },
    { to: '/j/jagota/payment-testing', label: 'Jagota payment testing', heading: H_TESTING, description: 'ทดสอบการชำระเงินของ Jagota' },
    { to: '/erp/jagota-shadow', label: 'ส่ง order ผ่าน commerce (ทดลอง)', heading: H_TESTING, description: 'ทดลองส่งออเดอร์ไป ERP ผ่าน commerce' },
    { to: '/reports/price-shadow', label: 'ราคา: commerce คิดคู่กัน (ทดลอง)', heading: H_TESTING, description: 'เทียบราคาที่ commerce คำนวณกับราคาของ josh' },
    // Marketing: monitoring & settings
    { to: '/j/marketing/settings', label: 'ตั้งค่าการตลาด', heading: H_MARKETING, description: 'ค่าที่มีผลกับเวิร์กโฟลว์การตลาดทั้งหมด' },
    { to: '/j/marketing/queue', label: 'คิวงานการตลาด', heading: H_MARKETING, description: 'ข้อความการตลาดที่รอส่งและที่ส่งแล้ว' },
    { to: '/j/marketing/offers-check', label: 'ตรวจข้อเสนอ', heading: H_MARKETING, description: 'ตรวจว่าอุปกรณ์หรือผู้ใช้จะเห็นข้อเสนอใดบนร้านค้า' },
    { to: '/j/marketing/journey-funnel', label: 'Journey funnel', heading: H_MARKETING, description: 'จำนวนลูกค้าที่ผ่านแต่ละขั้นของการใช้งาน' },
    { to: '/j/cs/notification-catalog', label: 'Notification catalog', heading: H_MARKETING, description: 'การแจ้งเตือนทุกประเภทที่ระบบส่งได้ และการเปิดปิด' },
    { to: '/j/cs/notification-log', label: 'Notification log', heading: H_MARKETING, description: 'บันทึกการแจ้งเตือนที่ส่งถึงลูกค้า' },
    { to: '/j/cs/notification-stats', label: 'Notification delivery stats', heading: H_MARKETING, description: 'สถิติการส่งแจ้งเตือนที่สำเร็จและไม่สำเร็จ' },
    { to: '/j/cs/product-notify-funnel', label: 'Product notify funnel', heading: H_MARKETING, description: 'ผลของการแจ้งเตือนสินค้า ตั้งแต่ส่งจนถึงสั่งซื้อ' },
    { to: '/j/marketing/scraping-sources', label: 'ตั้งค่าเก็บข้อมูลเว็บ', heading: H_MARKETING, description: 'เลือกเว็บคู่แข่งที่ระบบเก็บข้อมูล และการเก็บอัตโนมัติ' },
    // josh replica (read-only)
    { to: '/josh/kyc', label: 'ข้อมูลคำขอ KYC', heading: H_REPLICA, description: REPLICA },
    { to: '/josh/credit_terms', label: 'ข้อมูลคำขอเครดิต', heading: H_REPLICA, description: REPLICA },
    { to: '/josh/admin_access', label: 'ข้อมูลคำขอเข้า admin', heading: H_REPLICA, description: REPLICA },
    { to: '/josh/shipments', label: 'ข้อมูลการจัดส่ง', heading: H_REPLICA, description: REPLICA },
    { to: '/josh/payments', label: 'ข้อมูลรายการชำระเงิน', heading: H_REPLICA, description: REPLICA },
    { to: '/josh/credit_notes', label: 'ข้อมูลใบลดหนี้', heading: H_REPLICA, description: REPLICA },
    { to: '/josh/credit_backs', label: 'ข้อมูลคืนเครดิต', heading: H_REPLICA, description: REPLICA },
    { to: '/josh/invoices', label: 'ข้อมูลใบแจ้งหนี้', heading: H_REPLICA, description: REPLICA },
    { to: '/josh/coupons', label: 'ข้อมูลคูปอง', heading: H_REPLICA, description: REPLICA },
    { to: '/josh/campaigns', label: 'ข้อมูลแคมเปญ', heading: H_REPLICA, description: REPLICA },
    { to: '/josh/segments', label: 'ข้อมูลกลุ่มลูกค้า', heading: H_REPLICA, description: REPLICA },
    { to: '/josh/suppliers', label: 'ข้อมูลซัพพลายเออร์', heading: H_REPLICA, description: REPLICA },
    { to: '/josh/internal_docs', label: 'เอกสารภายใน', heading: H_REPLICA, description: REPLICA },
  ],
};

export const DASHBOARD: NavItem = { to: '/', label: 'แดชบอร์ด', end: true, icon: 'space_dashboard', description: 'งานที่ต้องติดตามและสถานะระบบวันนี้ในหน้าเดียว' };

/** Every sidebar destination (Dashboard aside), in sidebar order, with its section. */
export const NAV_ENTRIES: (NavEntry & { section: SectionId })[] = SECTIONS.flatMap((s) => NAV[s.id].map((item) => ({ ...item, section: s.id })));

/**
 * Destination permissions from the staff-role policy; omitted destinations are admin-only.
 * Mirrors backend @StaffRoles and, for /j/* pages, the josh admin-call relay AREAS: a role never gets
 * a page whose first API calls 403 for it. Also decides post-login landing pages and deep links.
 */
export const ROLE_ACCESS: Record<string, readonly string[]> = {
  "/reports/sales": [
    "sales_manager",
    "business_analyst"
  ],
  "/reports/products": [
    "marketing",
    "merchandising"
  ],
  "/reports/orders": [
    "sales_manager",
    "business_analyst"
  ],
  "/reports/customers": [
    "sales_manager",
    "business_analyst"
  ],
  "/reports/prices": [
    "sales_manager",
    "business_analyst"
  ],
  "/prices/staff": [
    "merchandising"
  ],
  "/reports/traffic": [
    "marketing"
  ],
  "/reports/health": [
    "sales_manager",
    "business_analyst"
  ],
  "/reports/order-targetgroup": [
    "sales_manager",
    "business_analyst"
  ],
  "/reports/winback": [
    "sales_manager",
    "business_analyst"
  ],
  "/marketing/analyst": [
    "marketing"
  ],
  "/marketing/growth": [
    "marketing",
    "business_analyst"
  ],
  "/marketing/growth/plans": [
    "marketing"
  ],
  "/marketing/research": [
    "marketing"
  ],
  "/marketing/restaurants": [
    "marketing"
  ],
  "/marketing/workflows": [
    "marketing"
  ],
  "/j/coupons": [
    "marketing"
  ],
  "/j/promotion-product-sets": [
    "marketing",
    "merchandising"
  ],
  "/j/promotions-mechanic": [
    "marketing",
    "merchandising"
  ],
  "/j/promotion-pages": [
    "marketing"
  ],
  "/j/promotions/campaigns": [
    "marketing"
  ],
  "/j/segments": [
    "marketing"
  ],
  "/j/marketing/push-campaigns": [
    "marketing"
  ],
  "/j/cs/notification-catalog": [
    "marketing"
  ],
  "/j/cs/notification-log": [
    "marketing"
  ],
  "/j/cs/notification-stats": [
    "marketing"
  ],
  "/j/cs/product-notify-funnel": [
    "marketing"
  ],
  "/j/marketing/competitor-prices": [
    "marketing",
    "business_analyst"
  ],
  "/j/marketing/scraping-sources": [
    "marketing"
  ],
  "/j/marketing/scraped-catalog": [
    "marketing"
  ],
  "/cs": [
    "cs"
  ],
  "/j/bot/intent-rules": [
    "marketing"
  ],
  "/j/bot/workflows": [
    "marketing"
  ],
  "/j/bot/templates": [
    "marketing"
  ],
  "/j/allproducts": [
    "marketing",
    "merchandising",
    "graphic"
  ],
  "/j/product/create": [
    "marketing",
    "merchandising"
  ],
  "/j/product/video-upload": [
    "marketing",
    "merchandising"
  ],
  "/j/product/bulk-image-upload": [
    "marketing",
    "merchandising",
    "graphic"
  ],
  "/j/suppliers": [
    "marketing",
    "merchandising"
  ],
  "/j/brands": [
    "marketing",
    "merchandising",
    "graphic"
  ],
  "/j/categories": [
    "merchandising"
  ],
  "/j/cs/sample-requests": [
    "cs"
  ],
  "/j/cs/delivery-schedule": [
    "cs"
  ],
  "/j/cs/cart-move-categories": [
    "cs"
  ],
  "/j/order": [
    "cs"
  ],
  "/j/shipments": [
    "cs"
  ],
  "/j/credit-notes": [
    "cs"
  ],
  "/j/credit-backs": [
    "cs"
  ],
  "/j/marketing/notify-templates": [
    "marketing"
  ],
  "/j/smart-links": [
    "marketing"
  ],
  "/j/marketing-links": [
    "marketing"
  ],
  "/j/marketing/welcome-lead-email": [
    "marketing"
  ],
  "/j/marketing/settings": [
    "marketing"
  ],
  "/j/marketing/queue": [
    "marketing"
  ],
  // "/j/marketing/journey-funnel": admin-only — the page reads josh /analytics/funnel, which the relay allows admin only
  "/j/marketing/offers-check": [
    "marketing"
  ],
  "/ai/connectors": [
    "marketing"
  ],
  "/erp/inventory-warehouse": [
    "merchandising",
    "business_analyst"
  ],
  "/products": [
    "merchandising",
    "graphic"
  ],
  "/stock-moves": [
    "merchandising"
  ],
  "/product-prices": [
    "merchandising"
  ],
  "/product-master-queue": [
    "merchandising"
  ],
  "/order-periods": [
    "merchandising"
  ],
  "/orders": [
    "business_analyst"
  ],
  "/account/password": [
    "marketing",
    "merchandising",
    "cs",
    "sales_manager",
    "business_analyst",
    "graphic"
  ]
};

export const canSee = (role: string | null | undefined, to: string) => role === 'admin' || (!!role && !!ROLE_ACCESS[to]?.includes(role));

/** The sidebar for a role: only items it may open, no empty sections; Dashboard for admin. */
export function navFor(role?: string): NavGroup[] {
  const groups = SECTIONS.flatMap((section): NavGroup[] => {
    const links = NAV[section.id].filter((item) => canSee(role, item.to));
    if (!links.length) return [];
    // nothing but "more" items for this role: show them as the section's main items
    return [{ group: section.title, icon: section.icon, links: links.every((item) => item.more) ? links.map((item) => ({ ...item, more: false })) : links }];
  });
  return role === 'admin' ? [{ links: [DASHBOARD] }, ...groups] : groups;
}

/** The section a role's sidebar shows for a section id (undefined when the role has nothing there). */
export const sectionNavFor = (role: string | undefined, id: SectionId) => navFor(role).find((g) => g.group === SECTIONS.find((s) => s.id === id)?.title);

/** Old workspace overview pages (/workspaces/:id, #80) → the section that replaced each. */
export const WORKSPACE_SECTION: Readonly<Record<string, SectionId>> = {
  catalog: 'catalog', orders: 'orders', customers: 'customers', marketing: 'marketing', reports: 'reports', connections: 'advanced', settings: 'settings',
};

/** Where an old /workspaces/:id link now goes for this role: the first page of the replacing section (null = nothing for it there). */
export function workspaceTarget(role: string | undefined, workspaceId: string): string | null {
  const section = WORKSPACE_SECTION[workspaceId];
  return (section && sectionNavFor(role, section)?.links[0]?.to) || null;
}
