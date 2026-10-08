import type { NavGroup, NavItem } from '@cp/ui';

const ORIGINAL_NAV: NavGroup[] = [
  { links: [{ to: '/', label: 'Overview', end: true, icon: 'dashboard' }] },
  {
    group: 'รายงานร้าน (josh)', icon: 'storefront',
    links: [
      { to: '/reports/sales', label: 'ยอดขาย', end: false },
      { to: '/reports/products', label: 'สินค้า (josh)', end: false },
      { to: '/reports/orders', label: 'Orders (josh)', end: false },
      { to: '/reports/customers', label: 'ลูกค้า / บริษัท (josh)', end: false },
      { to: '/reports/prices', label: 'ราคาที่ลูกค้าเห็น (josh)', end: false },
      { to: '/reports/price-shadow', label: 'ราคา: commerce คิดคู่กัน (ทดลอง)', end: false },
      { to: '/prices/staff', label: 'ราคาลูกค้า / ราคาสัญญา (commerce)', end: false },
      { to: '/reports/traffic', label: 'Traffic', end: false },
      { to: '/reports/health', label: 'Error / สุขภาพระบบ', end: false },
      { to: '/reports/order-targetgroup', label: 'Order target group', end: false },
      { to: '/reports/winback', label: 'Win-back (ฝ่ายขาย)', end: false },
    ],
  },
  {
    group: 'หลังบ้าน josh (อ่านจาก replica ใช้ได้แม้ josh ล่ม)', icon: 'inventory_2',
    links: [
      { to: '/josh/kyc', label: 'KYC รอตรวจ', end: false },
      { to: '/josh/credit_terms', label: 'ขอเครดิต', end: false },
      { to: '/josh/admin_access', label: 'คำขอเข้า admin', end: false },
      { to: '/josh/shipments', label: 'Shipments', end: false },
      { to: '/josh/payments', label: 'รายการชำระเงิน', end: false },
      { to: '/josh/credit_notes', label: 'Credit notes', end: false },
      { to: '/josh/credit_backs', label: 'Credit backs', end: false },
      { to: '/josh/invoices', label: 'ใบแจ้งหนี้', end: false },
      { to: '/josh/coupons', label: 'Coupons', end: false },
      { to: '/josh/campaigns', label: 'Campaigns', end: false },
      { to: '/josh/segments', label: 'Segments', end: false },
      { to: '/josh/suppliers', label: 'Suppliers', end: false },
      { to: '/josh/internal_docs', label: 'เอกสารภายใน', end: false },
      { to: '/josh-api-logs', label: 'API log ของ josh', end: false },
    ],
  },
  {
    group: 'Marketing', icon: 'campaign',
    links: [
      { to: '/marketing/analyst', label: 'ถาม Marketing Analyst', end: false },
      { to: '/marketing/growth', label: 'Growth Workspace', end: true },
      { to: '/marketing/growth/plans', label: 'แผนและปฏิทิน Growth', end: false },
      { to: '/marketing/research', label: 'Research', end: false },
      { to: '/marketing/restaurants', label: 'Market Explorer (ร้านอาหาร)', end: false },
      { to: '/marketing/workflows', label: 'Marketing workflows', end: false },
      { to: '/j/coupons', label: 'Coupons', end: false },
      { to: '/j/promotion-product-sets', label: 'Promotion product sets', end: false },
      { to: '/j/promotions-mechanic', label: 'Promotion mechanics', end: false },
      { to: '/j/promotion-pages', label: 'Promotion pages', end: false },
      { to: '/j/promotions/campaigns', label: 'Campaigns', end: false },
      { to: '/j/segments', label: 'Segments', end: false },
      { to: '/j/marketing/push-campaigns', label: 'Push campaigns', end: false },
      { to: '/j/cs/notification-catalog', label: 'Notification catalog', end: false },
      { to: '/j/cs/notification-log', label: 'Notification log', end: false },
      { to: '/j/cs/notification-stats', label: 'Notification delivery stats', end: false },
      { to: '/j/cs/product-notify-funnel', label: 'Product notify funnel', end: false },
      { to: '/j/marketing/competitor-prices', label: 'เทียบราคาคู่แข่ง', end: false },
      { to: '/j/marketing/scraping-sources', label: 'ตั้งค่าเก็บข้อมูลเว็บ', end: false },
      { to: '/j/marketing/scraped-catalog', label: 'คลังข้อมูลเว็บคู่แข่ง', end: false },
    ],
  },
  {
    group: 'CS / แชต', icon: 'support_agent',
    links: [
      { to: '/cs', label: 'งาน CS (สั่งแทน / ตัวอย่าง / รวมบัญชี)', end: false },
      { to: '/livechat', label: 'Live chat', end: false },
      { to: '/j/bot/intent-rules', label: 'Bot · intent rules', end: false },
      { to: '/j/bot/workflows', label: 'Bot · workflows', end: false },
      { to: '/j/bot/templates', label: 'Bot · templates', end: false },
    ],
  },
  {
    group: 'สินค้า / ลูกค้า (จาก josh)', icon: 'shelves',
    links: [
      { to: '/j/allproducts', label: 'สินค้า (จัดการ)', end: false },
      { to: '/j/product/create', label: 'เพิ่มสินค้า', end: true },
      { to: '/j/product/video-upload', label: 'Video upload', end: true },
      { to: '/j/product/bulk-image-upload', label: 'Bulk image upload', end: true },
      { to: '/j/suppliers', label: 'Suppliers', end: false },
      { to: '/j/brands', label: 'แบรนด์', end: false },
      { to: '/j/allusers', label: 'ผู้ใช้ทั้งหมด', end: false },
      { to: '/j/membership-tiers', label: 'ระดับสมาชิก', end: false },
      { to: '/j/company', label: 'บริษัท', end: false },
      { to: '/j/kyc', label: 'KYC', end: false },
      { to: '/j/cs/sample-requests', label: 'Sample requests', end: false },
      { to: '/j/cs/delivery-schedule', label: 'ตารางรอบส่ง', end: false },
      { to: '/j/cs/cart-move-categories', label: 'หมวดที่ย้ายของในตะกร้าได้', end: false },
      { to: '/j/price-requests', label: 'Price requests', end: false },
      { to: '/j/active-offers', label: 'Active offers', end: false },
      { to: '/j/admin-access', label: 'Admin access requests', end: false },
    ],
  },
  {
    group: 'Order / การเงิน (จาก josh)', icon: 'receipt_long',
    links: [
      { to: '/j/order', label: 'Orders (จัดการ)', end: false },
      { to: '/j/shipments', label: 'Shipments (จัดการ)', end: false },
      { to: '/j/payment-transactions', label: 'รายการชำระเงิน (จัดการ)', end: false },
      { to: '/j/order/import', label: 'นำเข้า order', end: true },
      { to: '/j/batch-sticker', label: 'พิมพ์ sticker', end: false },
      { to: '/j/kbank/testing-console', label: 'KBank testing console', end: false },
      { to: '/j/invoices', label: 'Overdue invoices', end: false },
      { to: '/j/credit-notes', label: 'Credit notes', end: false },
      { to: '/j/credit-backs', label: 'Credit backs', end: false },
      { to: '/j/credit-terms', label: 'ใบสมัครเครดิต', end: false },
      { to: '/j/billing', label: 'Billing', end: false },
      { to: '/j/refunds', label: 'Returns & refunds', end: false },
      { to: '/j/jagota/payment-testing', label: 'Jagota payment testing', end: false },
      { to: '/j/erp/webhook-simulator', label: 'ERP webhook simulator (josh)', end: false },
    ],
  },
  {
    group: 'Marketing (จาก josh)', icon: 'campaign',
    links: [
      { to: '/j/marketing/notify-templates', label: 'Template ข้อความ', end: false },
      { to: '/j/smart-links', label: 'Smart links', end: false },
      { to: '/j/marketing-links', label: 'Marketing links', end: false },
      { to: '/j/marketing/welcome-lead-email', label: 'อีเมลต้อนรับลีด', end: false },
      { to: '/j/marketing/settings', label: 'ตั้งค่าการตลาด', end: false },
      { to: '/j/marketing/queue', label: 'คิวงานการตลาด', end: false },
      { to: '/j/marketing/journey-funnel', label: 'Journey funnel', end: false },
      { to: '/j/marketing/offers-check', label: 'ตรวจข้อเสนอ', end: false },
    ],
  },
  { group: 'AI', icon: 'smart_toy', links: [{ to: '/ai/connectors', label: 'AI connectors (MCP)', end: false }] },
  {
    group: 'ERP hub', icon: 'hub',
    links: [
      { to: '/erp/inbound-log', label: 'Inbound log', end: false },
      { to: '/erp/josh-logs', label: 'ERP log ของ josh', end: false },
      { to: '/erp/webhook-dead-letter', label: 'Dead letter', end: false },
      { to: '/erp/webhook-platforms', label: 'Platforms', end: false },
      { to: '/erp/inventory-warehouse', label: 'Inventory per warehouse', end: false },
      { to: '/erp/simulator', label: 'ERP simulator', end: false },
      { to: '/erp/jagota-shadow', label: 'ส่ง order ผ่าน commerce (ทดลอง)', end: false },
    ],
  },
  {
    group: 'Integration', icon: 'cable',
    links: [
      { to: '/integrations', label: 'Integrations', end: false },
      { to: '/webhooks', label: 'Webhook events (in)', end: false },
      { to: '/subscriptions', label: 'Outgoing webhooks', end: false },
      { to: '/sync-jobs', label: 'Sync jobs', end: false },
      { to: '/erp-stock', label: 'ERP stub stock', end: false },
      { to: '/erp-ingest', label: 'ERP ingest', end: false },
    ],
  },
  {
    group: 'Commerce data', icon: 'database',
    links: [
      { to: '/customers', label: 'Customers', end: false },
      { to: '/products', label: 'Products', end: false },
      { to: '/stock-moves', label: 'Stock moves', end: false },
      { to: '/product-prices', label: 'ราคาสินค้า', end: false },
      { to: '/product-master-queue', label: 'คิวข้อมูลสินค้าจาก ERP', end: false },
      { to: '/order-periods', label: 'รอบสั่งซื้อ supplier', end: false },
      { to: '/orders', label: 'Orders', end: false },
      { to: '/reservations', label: 'Reservations', end: false },
    ],
  },
  {
    group: 'ตั้งค่า', icon: 'settings',
    links: [
      { to: '/settings/staff', label: 'บัญชี staff', end: false },
      { to: '/settings/josh-staff', label: 'บัญชี josh (staff)', end: false },
      { to: '/account/password', label: 'เปลี่ยนรหัสผ่าน', end: false },
    ],
  },
];


export const WORKSPACES = [
  { id: 'catalog', title: 'สินค้าและสต็อก', icon: 'inventory_2', description: 'จัดการสินค้า ราคา และความพร้อมขายในที่เดียว', primary: ['/products', '/j/allproducts', '/product-prices', '/stock-moves'], steps: ['จัดการข้อมูลสินค้า', 'ตรวจสอบราคาและสต็อก', 'เตรียมสินค้าให้พร้อมขาย'] },
  { id: 'orders', title: 'ออเดอร์และการเงิน', icon: 'receipt_long', description: 'ดูคำสั่งซื้อ การจัดส่ง และรายการชำระเงิน', primary: ['/j/order', '/j/shipments', '/j/payment-transactions', '/j/invoices'], steps: ['ตรวจสอบคำสั่งซื้อ', 'ติดตามการชำระเงิน', 'เตรียมและติดตามการจัดส่ง'] },
  { id: 'customers', title: 'ลูกค้าและบริการ', icon: 'support_agent', description: 'ดูแลบัญชีลูกค้า ติดต่อ และติดตามงานบริการ', primary: ['/j/company', '/cs', '/livechat', '/reports/winback'], steps: ['ค้นหาลูกค้าหรือบริษัท', 'ดูประวัติและคำขอ', 'ติดตามงานบริการ'] },
  { id: 'marketing', title: 'การตลาด', icon: 'campaign', description: 'วางแผนแคมเปญ โปรโมชัน และสื่อสารกับลูกค้า', primary: ['/marketing/growth', '/j/coupons', '/marketing/workflows', '/marketing/analyst'], steps: ['วิเคราะห์และวางแผน', 'เตรียมแคมเปญและเนื้อหา', 'ติดตามผลการสื่อสาร'] },
  { id: 'reports', title: 'รายงานและข้อมูล', icon: 'monitoring', description: 'ดูภาพรวมยอดขาย สินค้า ลูกค้า และผลการทำงาน', primary: ['/reports/sales', '/reports/orders', '/reports/products', '/reports/customers'], steps: ['เลือกรายงาน', 'กำหนดช่วงเวลาหรือเงื่อนไข', 'ดูรายละเอียดเพื่อใช้ตัดสินใจ'] },
  { id: 'connections', title: 'ระบบเชื่อมต่อ', icon: 'hub', description: 'ติดตามการเชื่อมต่อ คิวงาน และปัญหาการส่งข้อมูล', primary: ['/integrations', '/erp/inbound-log', '/sync-jobs', '/erp/webhook-dead-letter'], steps: ['ตรวจสอบการเชื่อมต่อ', 'ติดตามคิวและการส่งข้อมูล', 'ตรวจสอบรายการที่ต้องแก้ไข'] },
  { id: 'settings', title: 'ตั้งค่าและทีมงาน', icon: 'settings', description: 'จัดการบัญชีทีมงาน สิทธิ์ และการตั้งค่าบัญชี', primary: ['/settings/staff', '/settings/josh-staff', '/account/password'], steps: ['จัดการบัญชีทีมงาน', 'ตรวจสอบบทบาทและสิทธิ์', 'ดูแลความปลอดภัยของบัญชี'] },
] as const;

export type WorkspaceId = typeof WORKSPACES[number]['id'];

const LABELS: Record<string, string> = {
  '/': 'ภาพรวม',
  '/j/allproducts': 'จัดการสินค้า', '/products': 'แคตตาล็อกแพลตฟอร์ม',
  '/j/product/create': 'เพิ่มสินค้า', '/j/product/video-upload': 'อัปโหลดวิดีโอสินค้า', '/j/product/bulk-image-upload': 'อัปโหลดรูปสินค้าหลายรายการ',
  '/j/suppliers': 'จัดการซัพพลายเออร์', '/josh/suppliers': 'ข้อมูลซัพพลายเออร์',
  '/j/order': 'จัดการออเดอร์', '/orders': 'ออเดอร์แพลตฟอร์ม', '/j/shipments': 'จัดการการจัดส่ง',
  '/j/payment-transactions': 'จัดการการชำระเงิน', '/j/invoices': 'ใบแจ้งหนี้ค้างชำระ', '/j/order/import': 'นำเข้าออเดอร์',
  '/josh/credit_notes': 'ข้อมูลใบลดหนี้', '/j/credit-notes': 'จัดการใบลดหนี้',
  '/josh/credit_backs': 'ข้อมูลคืนเครดิต', '/j/credit-backs': 'จัดการคืนเครดิต',
  '/josh/shipments': 'ข้อมูลการจัดส่ง', '/josh/payments': 'ข้อมูลรายการชำระเงิน',
  '/josh/coupons': 'ข้อมูลคูปอง', '/j/coupons': 'จัดการคูปอง',
  '/josh/campaigns': 'ข้อมูลแคมเปญ', '/j/promotions/campaigns': 'จัดการแคมเปญ',
  '/josh/segments': 'ข้อมูลกลุ่มลูกค้า', '/j/segments': 'จัดการกลุ่มลูกค้า',
  '/j/batch-sticker': 'พิมพ์สติกเกอร์', '/j/billing': 'วางบิล', '/j/refunds': 'คืนสินค้าและคืนเงิน',
  '/j/allusers': 'จัดการผู้ใช้', '/j/company': 'จัดการบริษัท', '/customers': 'ลูกค้าแพลตฟอร์ม',
  '/j/kyc': 'ตรวจสอบตัวตนลูกค้า', '/josh/kyc': 'ข้อมูลคำขอ KYC', '/j/membership-tiers': 'ระดับสมาชิก',
  '/cs': 'งานบริการลูกค้า', '/livechat': 'แชตกับลูกค้า', '/reports/winback': 'ติดตามลูกค้าเก่า',
  '/stock-moves': 'ความเคลื่อนไหวสต็อก', '/reservations': 'การจองสินค้า',
  '/reports/sales': 'รายงานยอดขาย', '/reports/products': 'รายงานสินค้า', '/reports/orders': 'รายงานออเดอร์',
  '/reports/customers': 'รายงานลูกค้าและบริษัท', '/reports/prices': 'รายงานราคาขาย', '/reports/traffic': 'การเข้าชม',
  '/reports/health': 'สุขภาพระบบ', '/reports/order-targetgroup': 'กลุ่มลูกค้าเป้าหมาย',
  '/marketing/growth': 'วางแผนการเติบโต', '/marketing/growth/plans': 'แผนและปฏิทิน', '/marketing/analyst': 'ผู้ช่วยวิเคราะห์การตลาด',
  '/marketing/research': 'งานวิจัยตลาด', '/marketing/restaurants': 'ค้นหาตลาดร้านอาหาร', '/marketing/workflows': 'เวิร์กโฟลว์การตลาด',
  '/integrations': 'การเชื่อมต่อ', '/webhooks': 'เหตุการณ์ขาเข้า', '/subscriptions': 'การส่งเหตุการณ์ขาออก', '/sync-jobs': 'งานซิงก์ข้อมูล',
  '/erp/inbound-log': 'บันทึกข้อมูลขาเข้า', '/erp/webhook-dead-letter': 'รายการส่งไม่สำเร็จ',
  '/erp/webhook-platforms': 'แพลตฟอร์มปลายทาง', '/erp/inventory-warehouse': 'สต็อกแยกตามคลัง', '/erp/simulator': 'ทดสอบการเชื่อมต่อ ERP',
  '/ai/connectors': 'การเชื่อมต่อ AI', '/settings/staff': 'บัญชีทีมงาน', '/settings/josh-staff': 'บัญชีทีมงานร้านค้า',
  '/j/price-requests': 'คำขอราคา', '/j/active-offers': 'ข้อเสนอราคาที่ใช้งาน',
  '/j/erp/webhook-simulator': 'ทดสอบเหตุการณ์ ERP ของร้านค้า',
};

const ADMIN_ONLY = new Set(['/settings/staff', '/settings/josh-staff']);

function category(item: NavItem, group = ''): WorkspaceId {
  const p = item.to;
  if (p.startsWith('/settings/') || p.startsWith('/account/') || p === '/josh/internal_docs') return 'settings';
  if (p === '/reports/winback' || p.startsWith('/cs') || p.startsWith('/livechat') || p.startsWith('/customers') || p.startsWith('/j/bot/') ||
      ['/j/allusers', '/j/company', '/j/kyc', '/j/membership-tiers', '/j/cs/sample-requests', '/j/cs/cart-move-categories', '/j/admin-access', '/josh/kyc', '/josh/admin_access'].includes(p)) return 'customers';
  if (p.startsWith('/reports/')) return 'reports';
  if (p.startsWith('/marketing/') || group.startsWith('Marketing') ||
      ['/josh/coupons', '/josh/campaigns', '/josh/segments'].includes(p)) return 'marketing';
  if (p === '/erp/inventory-warehouse' || p === '/erp-stock' || p === '/prices/staff' || p.startsWith('/product') || p === '/stock-moves' || p === '/order-periods' ||
      ['/j/allproducts', '/j/suppliers', '/j/brands', '/josh/suppliers', '/j/price-requests', '/j/active-offers'].includes(p) || p.startsWith('/j/product/')) return 'catalog';
  if (p.startsWith('/j/erp/')) return 'connections';
  if (p === '/orders' || p === '/reservations' || p === '/j/cs/delivery-schedule' || group.startsWith('Order') ||
      ['/josh/shipments', '/josh/payments', '/josh/credit_notes', '/josh/credit_backs', '/josh/invoices', '/josh/credit_terms'].includes(p)) return 'orders';
  return 'connections';
}

interface TaskSection {
  title: string;
  description: string;
  icon: string;
  matches?: RegExp;
}

const TASK_SECTIONS: Record<WorkspaceId, TaskSection[]> = {
  catalog: [
    { title: 'ข้อมูลสินค้า', description: 'เพิ่มสินค้าและดูแลข้อมูลแคตตาล็อก', icon: 'inventory_2', matches: /^\/(products$|product-master-queue|j\/(allproducts|product\/create))/ },
    { title: 'ราคาและข้อเสนอ', description: 'กำหนดราคาและติดตามคำขอจากลูกค้า', icon: 'sell', matches: /price|active-offers/ },
    { title: 'สต็อกและการสั่งซื้อ', description: 'ตรวจยอดสินค้า รับเข้า และโอนระหว่างคลัง', icon: 'warehouse', matches: /stock|inventory|order-periods/ },
    { title: 'ซัพพลายเออร์ แบรนด์ และสื่อ', description: 'จัดการแหล่งสินค้าและรูปหรือวิดีโอประกอบ', icon: 'storefront' },
  ],
  orders: [
    { title: 'คำสั่งซื้อและการจอง', description: 'สร้าง ตรวจสอบ และเตรียมคำสั่งซื้อ', icon: 'receipt_long', matches: /^\/(orders|reservations|j\/order)(\/|$)/ },
    { title: 'จัดส่งสินค้า', description: 'เตรียมเอกสารและติดตามรอบจัดส่ง', icon: 'local_shipping', matches: /shipment|sticker|delivery-schedule/ },
    { title: 'คืนสินค้าและคืนเงิน', description: 'ดูแลรายการคืนสินค้าและเอกสารคืนเครดิต', icon: 'assignment_return', matches: /refund|credit[-_](notes|backs)/ },
    { title: 'ชำระเงินและเครดิต', description: 'ติดตามยอดชำระ ใบแจ้งหนี้ และเครดิตลูกค้า', icon: 'payments' },
  ],
  customers: [
    { title: 'บัญชีลูกค้าและบริษัท', description: 'ค้นหาข้อมูลติดต่อและดูแลสมาชิก', icon: 'group', matches: /customers|allusers|company|membership/ },
    { title: 'ตรวจสอบและอนุมัติ', description: 'ตรวจตัวตนและคำขอสิทธิ์เข้าใช้งาน', icon: 'verified_user', matches: /kyc|admin[-_]access/ },
    { title: 'แชตและผู้ช่วย', description: 'ตอบลูกค้าและจัดการข้อความอัตโนมัติ', icon: 'chat', matches: /livechat|\/bot\// },
    { title: 'บริการและติดตามลูกค้า', description: 'ดูคำขอสินค้า งานบริการ และการติดตามลูกค้าเก่า', icon: 'support_agent' },
  ],
  marketing: [
    { title: 'วางแผนและค้นคว้า', description: 'วางแผนงานและเข้าใจตลาดก่อนเริ่มแคมเปญ', icon: 'calendar_month', matches: /growth|research|restaurants|analyst|competitor|scrap/ },
    { title: 'แคมเปญและโปรโมชัน', description: 'กำหนดกลุ่มเป้าหมายและข้อเสนอ', icon: 'campaign', matches: /coupon|promotion|segment|\/campaigns/ },
    { title: 'เนื้อหาและการสื่อสาร', description: 'เตรียมข้อความ อีเมล ลิงก์ และงานสื่อสาร', icon: 'mail', matches: /template|welcome|links|push-campaigns|notification-catalog|workflows/ },
    { title: 'ติดตามผลและตั้งค่า', description: 'ตรวจผลการส่งข้อความ คิวงาน และค่าการตลาด', icon: 'monitoring' },
  ],
  reports: [
    { title: 'ยอดขายและคำสั่งซื้อ', description: 'ติดตามยอดขายและกลุ่มลูกค้าเป้าหมาย', icon: 'receipt_long', matches: /sales|orders|order-targetgroup/ },
    { title: 'สินค้า ลูกค้า และราคา', description: 'เจาะข้อมูลสินค้า ลูกค้า และราคาที่ใช้ขาย', icon: 'query_stats', matches: /products|customers|price/ },
    { title: 'การเข้าชมและสุขภาพระบบ', description: 'ตรวจการใช้งานและปัญหาที่กระทบระบบ', icon: 'monitoring' },
  ],
  connections: [
    { title: 'จัดการการเชื่อมต่อ', description: 'ตั้งค่าระบบต้นทางและปลายทางที่ใช้งาน', icon: 'hub', matches: /integrations|connectors|webhook-platforms/ },
    { title: 'ข้อมูลขาเข้า', description: 'ดูเหตุการณ์และบันทึกข้อมูลที่รับเข้าระบบ', icon: 'input', matches: /^\/webhooks$|inbound|logs|api-logs/ },
    { title: 'ซิงก์และส่งข้อมูล', description: 'ติดตามคิวงานและเหตุการณ์ขาออก', icon: 'sync', matches: /sync-jobs|subscriptions|erp-ingest/ },
    { title: 'ตรวจปัญหาและทดสอบ', description: 'ตรวจรายการไม่สำเร็จและทดสอบการเชื่อมต่อ', icon: 'troubleshoot' },
  ],
  settings: [
    { title: 'ทีมงานและสิทธิ์', description: 'จัดการบัญชีทีมงานและบทบาทการทำงาน', icon: 'group', matches: /^\/settings\// },
    { title: 'บัญชีและเอกสาร', description: 'เปลี่ยนรหัสผ่านและเปิดเอกสารภายใน', icon: 'settings' },
  ],
};

/** Each permitted destination appears once, including less common legacy tools. */
export function taskSectionsFor(id: WorkspaceId, links: NavItem[]) {
  const sections = TASK_SECTIONS[id].map(section => ({ ...section, links: [] as NavItem[] }));
  for (const link of links) {
    const section = sections.find(item => item.matches?.test(link.to)) ?? sections[sections.length - 1];
    section.links.push(link);
  }
  return sections.filter(section => section.links.length > 0);
}

export function navFor(role?: string): NavGroup[] {
  const grouped = new Map<WorkspaceId, NavItem[]>(WORKSPACES.map(w => [w.id, []]));
  const seen = new Set<string>();
  for (const group of ORIGINAL_NAV) for (const item of group.links) {
    if (item.to === '/' || seen.has(item.to) || (role !== 'admin' && ADMIN_ONLY.has(item.to))) continue;
    seen.add(item.to);
    grouped.get(category(item, group.group))!.push({ ...item, label: LABELS[item.to] ?? item.label });
  }
  return [
    { links: [{ to: '/', label: 'ภาพรวม', end: true, icon: 'space_dashboard' }] },
    ...WORKSPACES.map(w => ({
      group: w.title, icon: w.icon,
      links: [{ to: `/workspaces/${w.id}`, label: `ภาพรวม${w.title}`, end: true, icon: w.icon }, ...grouped.get(w.id)!],
    })),
  ];
}
