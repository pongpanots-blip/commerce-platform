import { normalizeRole } from '../lib/role-home';
import type { NavGroup, NavItem } from '@cp/ui';
import { FEATURE_HOMES } from './features';

/**
 * The admin sidebar, in task-based sections. One source for the sidebar (labels, order, visibility,
 * tooltips), the menu search, each role's home page shortcuts, role landing and deep links
 * (src/lib/landing.ts) and the tests.
 * - `more`: less used, after the section's "show more" item (menu search still finds it).
 * - More settings (`advanced`): connections, logs, test tools and store data copies; collapsed, and like every
 *   section at most six main items per role (the rest after "show more").
 * - `activeFor`: sub-pages (create / edit / detail) outside `to` that highlight the item.
 * Labels and descriptions are UI copy keys (libs/ui/src/locales/ui-messages.json, TH + EN), named by task.
 * The pre-redesign sidebar is frozen in navigation.legacy.ts (old → new mapping, redirects, tests).
 */
export type SectionId = 'catalog' | 'orders' | 'customers' | 'marketing' | 'reports' | 'settings' | 'advanced';

export interface Section { id: SectionId; title: string; icon: string; description: string }

export const SECTIONS: readonly Section[] = [
  { id: 'catalog', title: 'สินค้าและสต็อก', icon: 'inventory_2', description: 'สินค้า หมวดหมู่ แบรนด์ รูปภาพ ราคา และสต็อก' },
  { id: 'orders', title: 'ออเดอร์และการชำระเงิน', icon: 'receipt_long', description: 'คำสั่งซื้อ การจัดส่ง การชำระเงิน ใบแจ้งหนี้ และเครดิต' },
  { id: 'customers', title: 'ลูกค้าและบริการ', icon: 'support_agent', description: 'บริษัทลูกค้า ผู้ใช้ งานบริการลูกค้า แชต และการติดตามลูกค้าเก่า' },
  { id: 'marketing', title: 'การตลาด', icon: 'campaign', description: 'แคมเปญ คูปอง โปรโมชัน กลุ่มลูกค้า ข้อความ และราคาคู่แข่ง' },
  { id: 'reports', title: 'รายงานและข้อมูล', icon: 'monitoring', description: 'ยอดขาย ออเดอร์ สินค้า ลูกค้า ราคา และการเข้าชม' },
  { id: 'settings', title: 'ตั้งค่าและทีมงาน', icon: 'settings', description: 'บัญชีทีมงาน คำขอสิทธิ์ใช้งาน และรหัสผ่าน' },
  { id: 'advanced', title: 'ตั้งค่าเพิ่มเติม (ใช้ไม่บ่อย)', icon: 'hub', description: 'การเชื่อมต่อระบบ บันทึกการทำงาน เครื่องมือทดสอบ สำเนาข้อมูลร้านค้า และการตั้งค่าอื่น ๆ' },
];

type NavEntry = Omit<NavItem, 'icon' | 'badge'> & {
  description: string;
  /** A different label for some roles (e.g. a rep's own sales: "My sales"). */
  roleLabels?: Readonly<Record<string, string>>;
};

const NAV: Record<SectionId, NavEntry[]> = {
  catalog: [
    { to: '/j/allproducts', label: 'สินค้าบนร้านค้า', activeFor: ['/j/product'], description: 'ค้นหา แก้ไข และเพิ่มสินค้าที่ขายบนร้านค้า' },
    { to: '/products', label: 'ค้นหาสินค้าตามรหัส', description: 'สินค้าทุกรายการตามรหัสสินค้า และการอนุมัติสินค้าใหม่' },
    { to: '/j/categories', label: 'จัดการหมวดหมู่', description: 'จัดโครงสร้าง ลำดับ และรูปของหมวดหมู่บนร้านค้า' },
    { to: '/j/brands', label: 'แบรนด์', description: 'รายชื่อแบรนด์และโลโก้ที่ใช้กับสินค้า' },
    { to: '/j/product/bulk-image-upload', label: 'อัปโหลดรูปสินค้า', end: true, description: 'อัปโหลดรูปให้สินค้าหลายรายการพร้อมกัน' },
    { to: '/j/suppliers', label: 'ซัพพลายเออร์', activeFor: ['/j/supplier'], description: 'ซัพพลายเออร์ที่ส่งสินค้าให้ร้านและข้อมูลติดต่อ' },
    { to: '/product-prices', label: 'ราคาสินค้า', description: 'ราคาขาย ราคาสั่ง และจำนวนขั้นต่ำ ตรวจและอนุมัติราคาที่เปลี่ยน' },
    { to: '/product-master-queue', label: 'อนุมัติข้อมูลสินค้าที่เปลี่ยน', description: 'ตรวจและอนุมัติข้อมูลสินค้าที่เปลี่ยน เช่น หน่วย แพ็ก แบรนด์ และ VAT' },
    { to: '/stock-moves', label: 'รับเข้า ปรับ และโอนสต็อก', description: 'บันทึกการรับสินค้าเข้า ปรับยอด และโอนสินค้าระหว่างคลัง' },
    { to: '/erp/inventory-warehouse', label: 'สต็อกแต่ละคลัง', description: 'ยอดสต็อกของสินค้าแต่ละรายการในแต่ละคลัง' },
    { to: '/j/product/video-upload', label: 'อัปโหลดวิดีโอสินค้า', end: true, more: true, description: 'อัปโหลดวิดีโอประกอบหน้าสินค้า' },
    { to: '/prices/staff', label: 'ราคาเฉพาะลูกค้าและราคาสัญญา', more: true, description: 'ราคาเฉพาะของลูกค้าแต่ละรายและราคาตามสัญญา' },
    { to: '/order-periods', label: 'รอบสั่งซื้อจากซัพพลายเออร์', more: true, description: 'รอบสั่งซื้อสินค้าสั่งล่วงหน้า วันส่ง และวันปิดรับ' },
  ],
  orders: [
    { to: '/j/order', label: 'คำสั่งซื้อ', description: 'ค้นหาและติดตามคำสั่งซื้อ เปิดดูรายละเอียดและสถานะ' },
    { to: '/j/shipments', label: 'การจัดส่งสินค้า', description: 'ติดตามการจัดส่งและอัปเดตสถานะพัสดุ' },
    { to: '/j/payment-transactions', label: 'รายการชำระเงิน', description: 'รายการชำระเงินของลูกค้าและสถานะการชำระ' },
    { to: '/j/invoices', label: 'ใบแจ้งหนี้ค้างชำระ', description: 'ใบแจ้งหนี้ที่เลยกำหนดชำระ เพื่อติดตามกับลูกค้า' },
    { to: '/j/billing', label: 'วางบิล', description: 'ค้นหาบริษัท ดูเครดิตและใบแจ้งหนี้ทั้งหมด' },
    { to: '/j/credit-terms', label: 'ใบสมัครเครดิต', description: 'พิจารณาใบสมัครเครดิตเทอมของลูกค้า' },
    { to: '/j/credit-notes', label: 'ใบลดหนี้', description: 'ออกและติดตามใบลดหนี้' },
    { to: '/j/credit-backs', label: 'คืนเครดิตให้ลูกค้า', description: 'คืนเครดิตให้ลูกค้าและติดตามสถานะ' },
    { to: '/j/refunds', label: 'คืนสินค้าและคืนเงิน', description: 'คำขอคืนสินค้าและการคืนเงินของลูกค้า' },
    { to: '/j/refund-requests', label: 'คำขอคืนเงิน', description: 'ตรวจหลักฐาน อนุมัติ และโอนคืนเงินลูกค้า (คืนสินค้า / ส่วนต่างน้ำหนัก)' },
    { to: '/j/cs/delivery-schedule', label: 'ตารางรอบส่ง', description: 'รอบจัดส่งและเกณฑ์การจัดส่ง' },
    { to: '/j/batch-sticker', label: 'พิมพ์สติกเกอร์', more: true, description: 'พิมพ์สติกเกอร์ติดกล่องให้หลายออเดอร์พร้อมกัน' },
    { to: '/orders', label: 'ชำระเงินและการจองของออเดอร์', more: true, description: 'สถานะชำระเงินและการจองสินค้าของแต่ละคำสั่งซื้อ' },
    { to: '/reservations', label: 'การจองสต็อกตอนชำระเงิน', more: true, description: 'สต็อกที่ถูกจองระหว่างชำระเงิน ทั้งที่จอง ยืนยัน ปล่อย และหมดอายุ' },
  ],
  customers: [
    { to: '/j/company', label: 'บริษัทลูกค้า', description: 'บริษัทลูกค้า ข้อมูลบริษัท เครดิตเทอม และสิทธิ์สั่งซื้อ' },
    { to: '/j/allusers', label: 'ผู้ใช้ของลูกค้า', description: 'ค้นหาบัญชีผู้ใช้ของลูกค้าและดูประวัติ' },
    { to: '/cs', label: 'งานบริการลูกค้า', activeFor: ['/j/cs/sample-requests'], description: 'เลือกงานสั่งแทนลูกค้า พิจารณาสินค้าตัวอย่าง หรือรวมบัญชี' },
    { to: '/livechat', label: 'แชตกับลูกค้า', description: 'อ่านและตอบแชตของลูกค้า' },
    { to: '/j/price-requests', label: 'คำขอราคา', description: 'คำขอราคาพิเศษจากลูกค้า' },
    { to: '/j/kyc', label: 'ตรวจสอบตัวตนลูกค้า', description: 'ตรวจเอกสารยืนยันตัวตนของลูกค้าที่รอพิจารณา' },
    { to: '/reports/winback', label: 'ติดตามลูกค้าเก่า', description: 'ลูกค้าที่หยุดสั่งซื้อ และงานติดตามของฝ่ายขาย' },
    { to: '/reports/winback/opportunities', label: 'โอกาสของทีม', description: 'โอกาสขายและลีดของทั้งทีม แยกตามพนักงานขาย' },
    { to: '/cs/sales-assignment', label: 'มอบหมายพนักงานขาย', description: 'กำหนดพนักงานขายที่ดูแลแต่ละบริษัทลูกค้า' },
    { to: '/reports/winback/my', label: 'โอกาสและลีดของฉัน', more: true, description: 'ลูกค้าที่ควรติดต่อกลับและลีดที่ได้รับมอบหมาย' },
    { to: '/j/active-offers', label: 'ข้อเสนอราคาที่ใช้งาน', more: true, description: 'ราคาพิเศษเฉพาะลูกค้าที่ยังใช้งานอยู่' },
    { to: '/j/membership-tiers', label: 'ระดับสมาชิก', more: true, description: 'กำหนดระดับสมาชิกและเงื่อนไขของแต่ละระดับ' },
    { to: '/j/cs/cart-move-categories', label: 'หมวดที่ย้ายของในตะกร้าได้', more: true, description: 'หมวดสินค้าที่ย้ายข้ามรอบจัดส่งได้เพื่อปลดล็อกส่งฟรี' },
    { to: '/customers', label: 'ข้อมูลติดต่อลูกค้า', more: true, description: 'ข้อมูลติดต่อและรายละเอียดของลูกค้า' },
  ],
  marketing: [
    { to: '/marketing/growth', label: 'วางแผนการเติบโต', end: true, activeFor: ['/marketing/growth/results', '/marketing/growth/companies'], description: 'เริ่มจากข้อมูลลูกค้าและยอดขาย แล้ววางแผนแคมเปญที่ผ่านการตรวจทาน' },
    { to: '/j/promotions/campaigns', label: 'แคมเปญโปรโมชัน', description: 'สร้างและติดตามแคมเปญโปรโมชัน' },
    { to: '/j/coupons', label: 'คูปองส่วนลด', activeFor: ['/j/coupon'], description: 'สร้าง แก้ไข และติดตามการใช้คูปอง' },
    { to: '/j/promotions-mechanic', label: 'กติกาส่วนลด', description: 'กติกาส่วนลด เช่น ซื้อครบลด หรือซื้อ X แถม Y' },
    { to: '/j/promotion-product-sets', label: 'ชุดสินค้าโปรโมชัน', description: 'ชุดสินค้าที่ใช้กับโปรโมชันและคูปอง' },
    { to: '/j/promotion-pages', label: 'หน้าโปรโมชัน', description: 'หน้าโปรโมชันบนร้านค้า' },
    { to: '/j/segments', label: 'กลุ่มลูกค้าสำหรับแคมเปญ', description: 'กำหนดกลุ่มลูกค้าเป้าหมายสำหรับแคมเปญและคูปอง' },
    { to: '/j/marketing/push-campaigns', label: 'ส่งแจ้งเตือนถึงลูกค้า', description: 'ส่งการแจ้งเตือนที่เด้งขึ้นบนเครื่องของลูกค้า' },
    { to: '/marketing/workflows', label: 'ข้อความอัตโนมัติ', description: 'ข้อความที่ส่งอัตโนมัติตามพฤติกรรมลูกค้า' },
    { to: '/j/marketing/competitor-prices', label: 'เทียบราคาคู่แข่ง', description: 'เทียบราคาสินค้าของเรากับเว็บคู่แข่ง' },
    { to: '/marketing/growth/plans', label: 'แผนและปฏิทิน', more: true, description: 'แผนการตลาดที่บันทึกไว้และปฏิทินงาน' },
    { to: '/marketing/analyst', label: 'ผู้ช่วยวิเคราะห์การตลาด', more: true, description: 'ถามคำถามการตลาดกับผู้ช่วย AI จากข้อมูลในระบบ' },
    { to: '/marketing/research', label: 'งานวิจัยตลาด', more: true, description: 'รายงานวิจัยตลาดและหัวข้อที่ติดตาม' },
    { to: '/marketing/restaurants', label: 'ค้นหาตลาดร้านอาหาร', more: true, description: 'สำรวจร้านอาหารบนแผนที่เพื่อหาลูกค้าใหม่' },
    { to: '/j/marketing/notify-templates', label: 'แม่แบบข้อความ', more: true, description: 'แม่แบบข้อความแจ้งเตือน อีเมล และป๊อปอัป' },
    { to: '/j/marketing/welcome-lead-email', label: 'อีเมลต้อนรับลีด', more: true, description: 'อีเมลต้อนรับลูกค้าที่สนใจ (ลีด) รายใหม่' },
    { to: '/j/smart-links', label: 'ลิงก์ติดตามผล', more: true, description: 'ลิงก์ที่ติดตามผลได้ พาลูกค้าไปยังหน้าที่เลือก' },
    { to: '/j/marketing-links', label: 'สร้างลิงก์การตลาด', more: true, description: 'สร้างลิงก์การตลาดพร้อมแท็กติดตามแคมเปญ' },
    { to: '/j/marketing/scraped-catalog', label: 'สินค้าจากเว็บคู่แข่ง', more: true, description: 'สินค้าที่เก็บมาจากเว็บคู่แข่ง' },
    { to: '/j/bot/intent-rules', label: 'แชตบอต: เข้าใจคำถาม', more: true, description: 'กติกาที่ช่วยให้แชตบอตเข้าใจคำถามของลูกค้า' },
    { to: '/j/bot/workflows', label: 'แชตบอต: ลำดับการตอบ', more: true, description: 'ลำดับการตอบของแชตบอต' },
    { to: '/j/bot/templates', label: 'แชตบอต: ข้อความสำเร็จรูป', more: true, description: 'ข้อความสำเร็จรูปของแชตบอต' },
  ],
  reports: [
    { to: '/analysis/customer-behavior', label: 'วิเคราะห์พฤติกรรมลูกค้า', description: 'เลือกเงื่อนไขกลุ่มลูกค้า ตรวจหลักฐาน และดูข้อจำกัดของข้อมูล' },
    { to: '/reports/sales', label: 'รายงานยอดขาย', roleLabels: { sale: 'ยอดขายของฉัน', sales_manager: 'ยอดขายทีมและผลงานรายเซลส์' }, description: 'ยอดขายตามช่วงเวลา เทียบกับช่วงก่อนหน้า' },
    { to: '/reports/orders', label: 'รายงานออเดอร์', roleLabels: { sale: 'ออเดอร์ของฉัน' }, description: 'รายการและสรุปคำสั่งซื้อของร้าน' },
    { to: '/reports/products', label: 'รายงานสินค้า', description: 'สินค้าขายดี ยอดขาย และสถานะสินค้า' },
    { to: '/reports/customers', label: 'รายงานลูกค้าและบริษัท', roleLabels: { sale: 'ลูกค้าของฉัน' }, description: 'ลูกค้าและบริษัท ยอดซื้อ และการสั่งซื้อล่าสุด' },
    { to: '/reports/prices', label: 'รายงานราคาขาย', description: 'ราคาที่ลูกค้าแต่ละสาขาเห็น และใบเสนอราคา' },
    { to: '/reports/order-targetgroup', label: 'กลุ่มลูกค้าเป้าหมาย', description: 'ออเดอร์แยกตามกลุ่มลูกค้าเป้าหมาย' },
    { to: '/reports/traffic', label: 'การเข้าชมร้านค้า', description: 'การเข้าชมร้านค้าและพฤติกรรมการใช้งาน' },
    { to: '/reports/health', label: 'สุขภาพระบบ', description: 'ข้อผิดพลาดและปัญหาที่กระทบการขายตอนนี้' },
  ],
  settings: [
    { to: '/josh/internal_docs', label: 'เอกสารภายใน', description: 'เพิ่ม อ่าน และลบเอกสารที่ใช้ภายในทีม' },

    { to: '/settings/staff', label: 'บัญชีทีมงาน', description: 'เพิ่มทีมงาน กำหนดบทบาท และปิดบัญชี' },
    { to: '/settings/josh-staff', label: 'บัญชีทีมงานร้านค้า', description: 'บัญชีทีมงานที่ใช้หลังร้านของร้านค้า' },
    { to: '/settings/activity-log', label: 'ประวัติการเปลี่ยนแปลง', description: 'ใครแก้อะไรในระบบ และแก้เมื่อไหร่' },
    { to: '/j/admin-access', label: 'คำขอใช้งานหลังร้าน', description: 'คำขอใช้งานหลังร้านของร้านค้าที่รออนุมัติ' },
    { to: '/account/password', label: 'เปลี่ยนรหัสผ่าน', description: 'เปลี่ยนรหัสผ่านของคุณ' },
  ],
  advanced: [
    { to: '/integrations', label: 'ระบบที่เชื่อมต่อ', description: 'ระบบภายนอกที่เชื่อมกับเราและสถานะการเชื่อมต่อ' },
    { to: '/erp/webhook-dead-letter', label: 'รายการส่งไม่สำเร็จ', description: 'ข้อมูลที่ส่งไม่สำเร็จ ตรวจสอบและส่งใหม่' },
    { to: '/sync-jobs', label: 'งานซิงก์ข้อมูล', description: 'งานซิงก์ข้อมูลกับระบบภายนอกและผลลัพธ์' },
    { to: '/webhooks', label: 'เหตุการณ์ขาเข้า', description: 'เหตุการณ์ที่ระบบภายนอกส่งเข้ามา' },
    { to: '/subscriptions', label: 'การส่งเหตุการณ์ขาออก', description: 'ปลายทางที่รับเหตุการณ์จากระบบของเรา' },
    { to: '/erp/inbound-log', label: 'บันทึกข้อมูลจากระบบหลัก (ERP)', description: 'บันทึกข้อมูลที่ระบบหลัก (ERP) ส่งเข้ามา' },
    { to: '/erp-ingest', label: 'ข้อมูลที่รับจากระบบหลัก (ERP)', description: 'ข้อมูลสินค้า ราคา และสต็อกที่ระบบหลักของบริษัท (ERP) ส่งเข้ามา' },
    { to: '/josh-api-logs', label: 'บันทึกการเรียกใช้ระบบร้านค้า', description: 'บันทึกทุกครั้งที่มีการเรียกใช้ระบบร้านค้า' },
    { to: '/erp/josh-logs', label: 'บันทึกการเรียกระบบหลัก (ERP)', description: 'บันทึกการเรียกระบบหลัก (ERP) จากระบบร้านค้า' },
    { to: '/erp/webhook-platforms', label: 'ระบบปลายทางที่รับข้อมูล', description: 'ระบบภายนอกที่รับข้อมูลที่เราส่งต่อ และการตั้งค่า' },
    { to: '/ai/connectors', label: 'เชื่อมต่อผู้ช่วย AI', more: true, description: 'ให้ผู้ช่วย AI อ่านข้อมูลของเราแบบอ่านอย่างเดียว' },
    { to: '/j/marketing/settings', label: 'ตั้งค่าการตลาด', more: true, description: 'ค่าที่มีผลกับข้อความอัตโนมัติทั้งหมด' },
    { to: '/j/marketing/queue', label: 'คิวงานการตลาด', more: true, description: 'ข้อความการตลาดที่รอส่งและที่ส่งแล้ว' },
    { to: '/j/marketing/offers-check', label: 'ตรวจข้อเสนอ', more: true, description: 'ตรวจว่าอุปกรณ์หรือผู้ใช้จะเห็นข้อเสนอใดบนร้านค้า' },
    { to: '/j/marketing/journey-funnel', label: 'เส้นทางของลูกค้า', more: true, description: 'จำนวนลูกค้าที่ผ่านแต่ละขั้นของการใช้งาน' },
    { to: '/j/cs/notification-catalog', label: 'ประเภทการแจ้งเตือนทั้งหมด', more: true, description: 'การแจ้งเตือนทุกประเภทที่ระบบส่งได้ และการเปิดปิด' },
    { to: '/j/cs/notification-log', label: 'ประวัติการแจ้งเตือน', more: true, description: 'บันทึกการแจ้งเตือนที่ส่งถึงลูกค้า' },
    { to: '/j/cs/notification-stats', label: 'สถิติการส่งแจ้งเตือน', more: true, description: 'สถิติการส่งแจ้งเตือนที่สำเร็จและไม่สำเร็จ' },
    { to: '/j/cs/product-notify-funnel', label: 'ผลการแจ้งเตือนสินค้า', more: true, description: 'ผลของการแจ้งเตือนสินค้า ตั้งแต่ส่งจนถึงสั่งซื้อ' },
    { to: '/j/marketing/scraping-sources', label: 'ตั้งค่าเว็บคู่แข่งที่เก็บข้อมูล', more: true, description: 'เลือกเว็บคู่แข่งที่ระบบเก็บข้อมูล และการเก็บอัตโนมัติ' },
    { to: '/erp/simulator', label: 'ทดสอบเชื่อมต่อระบบหลัก (ERP)', more: true, description: 'จำลองข้อมูลจากระบบหลัก (ERP) เพื่อทดสอบการเชื่อมต่อ' },
    { to: '/j/erp/webhook-simulator', label: 'ทดสอบส่งข้อมูลระบบหลักไปร้านค้า', more: true, description: 'ส่งเหตุการณ์ทดสอบจากระบบหลัก (ERP) ไปยังระบบร้านค้า' },
    { to: '/erp-stock', label: 'สต็อกจำลองสำหรับทดสอบ', more: true, description: 'กำหนดสต็อกจำลองเพื่อทดสอบการขาย' },
    { to: '/j/kbank/testing-console', label: 'ทดสอบชำระเงิน KBank', more: true, description: 'ทดสอบการชำระเงินผ่าน KBank' },
    { to: '/j/jagota/payment-testing', label: 'ทดสอบชำระเงิน Jagota', more: true, description: 'ทดสอบการชำระเงินของ Jagota' },
    { to: '/erp/jagota-shadow', label: 'ทดลองส่งออเดอร์เข้าระบบหลัก (ERP)', more: true, description: 'ทดลองส่งคำสั่งซื้อเข้าระบบหลัก (ERP) ผ่านระบบใหม่ ก่อนเปิดใช้จริง' },
    { to: '/reports/price-shadow', label: 'เทียบราคาที่คำนวณใหม่', more: true, description: 'เทียบราคาที่ระบบใหม่คำนวณกับราคาที่ร้านค้าใช้อยู่' },
  ],
};

/** Every role's landing: big shortcuts to its main tasks (pages/RoleHome.tsx); no API calls, so it cannot 403. */
export const HOME: NavItem = { to: '/home', label: 'หน้าแรก', end: true, icon: 'dashboard', description: 'งานหลักของคุณในที่เดียว เลือกงานที่ต้องการทำวันนี้' };
export const DASHBOARD: NavItem = { to: '/', label: 'แดชบอร์ด', end: true, icon: 'space_dashboard', description: 'งานที่ต้องติดตามและสถานะระบบวันนี้ในหน้าเดียว' };

/** Every sidebar destination (Dashboard aside), in sidebar order, with its section. */
export const NAV_ENTRIES: (NavEntry & { section: SectionId })[] = SECTIONS.flatMap((s) => NAV[s.id].map((item) => ({ ...item, activeFor: [...(item.activeFor ?? []), ...Object.entries(FEATURE_HOMES).filter(([, home]) => home === item.to).map(([alias]) => alias)], section: s.id })));

/**
 * Destination permissions from the staff-role policy; omitted destinations are admin-only.
 * Mirrors backend @StaffRoles and, for /j/* pages, the josh admin-call relay AREAS: a role never gets
 * a page whose first API calls 403 for it. Also decides post-login landing pages and deep links.
 */
export const ROLE_ACCESS: Record<string, readonly string[]> = {
  '/analysis/customer-behavior': ['business_analyst'],
  '/products/new': ['merchandising'],
  '/customers/new': [],
  '/settings/staff/new': [],
  '/integrations/new': [],
  '/cs/accounts/merge': [], // account merging is admin-only in the relay
  '/j/order/import': [], // import is admin-only in the relay

  "/home": ["marketing", "merchandising", "cs", "sale", "sales_manager", "business_analyst", "graphic"],
  "/reports/winback/opportunities": ["sales_manager", "business_analyst"],
  "/reports/winback/my": ["sale"],
  "/cs/sales-assignment": ["sales_manager"],
  "/reports/sales": [
    "sale",
    "sales_manager",
    "business_analyst"
  ],
  "/reports/products": [
    "marketing",
    "merchandising"
  ],
  "/reports/orders": [
    "sale",
    "sales_manager",
    "business_analyst"
  ],
  "/reports/customers": [
    "sale",
    "sales_manager",
    "business_analyst"
  ],
  "/reports/prices": [
    "sale",
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
    "business_analyst",
    "merchandising"
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
    "sale",
    "merchandising",
    "business_analyst"
  ],
  "/products": [
    "sale",
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
    "sale",
    "marketing",
    "merchandising",
    "cs",
    "sales_manager",
    "business_analyst",
    "graphic"
  ]
};

export const canSee = (roleRaw: string | null | undefined, to: string) => {
  const role = normalizeRole(roleRaw);
  return role === 'admin' || (!!role && !!ROLE_ACCESS[to]?.includes(role));
};

/** The sidebar for a role: only items it may open, no empty sections; Dashboard for admin. */
export function navFor(roleRaw?: string): NavGroup[] {
  const role = normalizeRole(roleRaw);
  const groups = SECTIONS.flatMap((section): NavGroup[] => {
    const links = NAV_ENTRIES.filter((item) => item.section === section.id).filter((item) => canSee(role, item.to))
      .map(({ roleLabels, ...item }): NavItem => ({ ...item, label: roleLabels?.[role] ?? item.label }));
    if (!links.length) return [];
    // Apply disclosure after permissions: a smaller role still sees its own useful tasks first.
    const onlyMore = links.every(item => item.more);
    let primary = 0;
    return [{ group: section.title, icon: section.icon, links: links.map(item => {
      const more = !onlyMore && item.more || primary >= 6;
      if (!more) primary += 1;
      return { ...item, more: !!more };
    }) }];
  });
  return [{ links: role === 'admin' ? [HOME, DASHBOARD] : canSee(role, HOME.to) ? [HOME] : [] }, ...groups].filter((g) => g.links.length > 0);
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

export interface Shortcut { to: string; icon: string }

/** Each role's home page: its 3–6 main tasks, in order (titles and descriptions come from the nav items). */
export const ROLE_SHORTCUTS: Readonly<Record<string, readonly Shortcut[]>> = {
  admin: [
    { to: '/', icon: 'space_dashboard' },
    { to: '/j/allproducts', icon: 'inventory_2' },
    { to: '/j/order', icon: 'receipt_long' },
    { to: '/j/company', icon: 'business' },
    { to: '/j/promotions/campaigns', icon: 'campaign' },
    { to: '/settings/staff', icon: 'group' },
  ],
  merchandising: [
    { to: '/products', icon: 'inventory_2' },
    { to: '/j/allproducts', icon: 'storefront' },
    { to: '/product-prices', icon: 'sell' },
    { to: '/product-master-queue', icon: 'fact_check' },
    { to: '/stock-moves', icon: 'warehouse' },
    { to: '/j/categories', icon: 'account_tree' },
  ],
  graphic: [
    { to: '/j/product/bulk-image-upload', icon: 'photo_library' },
    { to: '/j/allproducts', icon: 'storefront' },
    { to: '/j/brands', icon: 'star' },
    { to: '/products', icon: 'inventory_2' },
  ],
  marketing: [
    { to: '/marketing/growth', icon: 'trending_up' },
    { to: '/j/promotions/campaigns', icon: 'campaign' },
    { to: '/j/coupons', icon: 'sell' },
    { to: '/j/segments', icon: 'group' },
    { to: '/j/marketing/push-campaigns', icon: 'notifications' },
    { to: '/j/marketing/competitor-prices', icon: 'query_stats' },
  ],
  cs: [
    { to: '/cs', icon: 'support_agent' },
    { to: '/j/order', icon: 'receipt_long' },
    { to: '/j/shipments', icon: 'local_shipping' },

    { to: '/j/credit-notes', icon: 'request_quote' },
  ],
  sale: [
    { to: '/reports/sales', icon: 'trending_up' },
    { to: '/reports/winback/my', icon: 'rate_review' },
    { to: '/reports/customers', icon: 'business' },
    { to: '/reports/orders', icon: 'receipt_long' },
    { to: '/products', icon: 'inventory_2' },
    { to: '/reports/prices', icon: 'sell' },
  ],
  sales_manager: [
    { to: '/reports/sales', icon: 'trending_up' },
    { to: '/reports/winback/opportunities', icon: 'insights' },
    { to: '/reports/winback', icon: 'rate_review' },
    { to: '/cs/sales-assignment', icon: 'person_add' },
    { to: '/reports/customers', icon: 'business' },
  ],
  business_analyst: [
    { to: '/reports/sales', icon: 'trending_up' },
    { to: '/reports/orders', icon: 'receipt_long' },
    { to: '/reports/customers', icon: 'business' },
    { to: '/marketing/growth', icon: 'insights' },
    { to: '/erp/inventory-warehouse', icon: 'warehouse' },
    { to: '/j/marketing/competitor-prices', icon: 'query_stats' },
  ],
};

/** The home page shortcuts for a role, labelled as its own sidebar labels them; only pages it may open. */
export function shortcutsFor(roleRaw: string | null | undefined): (Shortcut & { label: string; description?: string })[] {
  const role = normalizeRole(roleRaw);
  const links = navFor(role).flatMap((g) => g.links);
  return (ROLE_SHORTCUTS[role] ?? []).flatMap((shortcut) => {
    const link = links.find((l) => l.to === shortcut.to);
    return link ? [{ ...shortcut, label: link.label, description: link.description }] : [];
  });
}
