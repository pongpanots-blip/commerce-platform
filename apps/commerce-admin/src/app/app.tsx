import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AppShell, Button, IconButton, Loading, NavGroup, Sidebar, StatusDot, TopBar, NavProvider } from '@cp/ui';
import { AdminStats, api, reportsApi, session, staffApi, STAFF_ROLE_LABEL, StaffRole } from '../lib/api';
import { useAsync } from './hooks';
import { Login } from './pages/Login';
import { StaffAccounts } from './pages/StaffAccounts';
import { JoshStaff } from './pages/JoshStaff';
import { ChangePassword } from './pages/ChangePassword';
import { ProductDetail } from './pages/ProductDetail';
import { CustomerDetail } from './pages/CustomerDetail';
import { OrderDetail } from './pages/OrderDetail';
import { JoshProductDetail } from './pages/JoshProductDetail';
import { JoshCustomerDetail } from './pages/JoshCustomerDetail';
import { JoshOrderDetail } from './pages/JoshOrderDetail';
import { Dashboard } from './pages/Dashboard';
import { Integrations } from './pages/Integrations';
import { Webhooks } from './pages/Webhooks';
import { Subscriptions } from './pages/Subscriptions';
import { SyncJobs } from './pages/SyncJobs';
import { Customers } from './pages/Customers';
import { Products } from './pages/Products';
import { StockMoves } from './pages/StockMoves';
import { ProductPrices } from './pages/ProductPrices';
import { ProductMasterQueue } from './pages/ProductMasterQueue';
import { SupplierOrderPeriods } from './pages/SupplierOrderPeriods';
import { Orders } from './pages/Orders';
import { Reservations } from './pages/Reservations';
import { ErpStock } from './pages/ErpStock';
import { ErpIngest } from './pages/ErpIngest';
import { MarketingResearch } from './pages/MarketingResearch';
import { InboundLog } from './pages/InboundLog';
import { WebhookDeadLetter } from './pages/WebhookDeadLetter';
import { WebhookPlatforms } from './pages/WebhookPlatforms';
import { InventoryPerWarehouse } from './pages/InventoryPerWarehouse';
import { AiConnectors } from './pages/AiConnectors';
import { ErpSimulator } from './pages/ErpSimulator';
import { HealthReportPage, SalesReport, TrafficReport } from './pages/ShopReports';
import { MarketExplorer, OrderTargetgroup } from './pages/MarketExplorer';
import { JoshErpLogs } from './pages/JoshErpLogs';
import { Winback } from './pages/Winback';
import { JoshProducts } from './pages/JoshProducts';
import { JoshCustomersPage, JoshOrdersPage, JoshPricesPage } from './pages/JoshCommerce';
import { JagotaShadow } from './pages/JagotaShadow';
import { JoshBackoffice } from './pages/JoshBackoffice';
import { JoshApiLogs } from './pages/JoshApiLogs';
import { PriceShadow } from './pages/PriceShadow';
import { StaffPrices } from './pages/StaffPrices';
import { MarketingWorkflows } from './pages/MarketingWorkflows';
import { JoshAdminApp } from '../josh-admin/JoshAdminApp';
import { WorkflowEditor, WorkflowEnrollments, WorkflowScheduledRuns } from './pages/workflow-editor';
import { CsDesk } from './pages/CsDesk';
import { Livechat } from './pages/Livechat';
import { GrowthWorkspace } from './pages/growth/Workspace';
import { GrowthPlans } from './pages/growth/Plans';
import { GrowthPlanPage } from './pages/growth/Plan';
import { GrowthResults, GrowthTimeline } from './pages/growth/Results';

const MarketingAnalyst = lazy(() => import('./pages/MarketingAnalyst'));

type Link = { to: string; label: string; end: boolean; icon?: string; roles?: readonly StaffRole[] };
type Nav = { group?: string; icon?: string; links: Link[] };
const L = (to: string, label: string, roles?: readonly StaffRole[], end = false): Link => ({ to, label, end, ...(roles ? { roles } : {}) });
const M = ['marketing'] as const;
const MER = ['merchandising'] as const;
const MM = ['marketing', 'merchandising'] as const;
const CS = ['cs'] as const;
const BA = ['business_analyst'] as const;
const SHOP = ['sales_manager', 'business_analyst'] as const;
const GFX = ['graphic'] as const;
const ALL = ['marketing', 'merchandising', 'cs', 'sales_manager', 'business_analyst', 'graphic'] as const;

const NAV: Nav[] = [
  { links: [{ to: '/', label: 'Overview', end: true, icon: 'dashboard' }] },
  {
    group: 'รายงานร้าน (josh)', icon: 'storefront',
    links: [
      L('/reports/sales', 'ยอดขาย', SHOP),
      L('/reports/products', 'สินค้า (josh)', [...MM, ...SHOP]),
      L('/reports/orders', 'Orders (josh)', SHOP),
      L('/reports/customers', 'ลูกค้า / บริษัท (josh)', SHOP),
      L('/reports/prices', 'ราคาที่ลูกค้าเห็น (josh)', SHOP),
      L('/reports/price-shadow', 'ราคา: commerce คิดคู่กัน (ทดลอง)'),
      L('/prices/staff', 'ราคาลูกค้า / ราคาสัญญา (commerce)', MER),
      L('/reports/traffic', 'Traffic', ['marketing', ...SHOP]),
      L('/reports/health', 'Error / สุขภาพระบบ', SHOP),
      L('/reports/order-targetgroup', 'Order target group', SHOP),
      L('/reports/winback', 'Win-back (ฝ่ายขาย)', SHOP),
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
      L('/marketing/analyst', 'ถาม Marketing Analyst', M),
      L('/marketing/growth', 'Growth Workspace', ['marketing', ...BA], true),
      L('/marketing/growth/plans', 'แผนและปฏิทิน Growth', M),
      L('/marketing/research', 'Research', M),
      L('/marketing/restaurants', 'Market Explorer (ร้านอาหาร)', ['marketing', ...SHOP]),
      L('/marketing/workflows', 'Marketing workflows', M),
      L('/j/coupons', 'Coupons', M),
      L('/j/promotion-product-sets', 'Promotion product sets', MM),
      L('/j/promotions-mechanic', 'Promotion mechanics', MM),
      L('/j/promotion-pages', 'Promotion pages', M),
      L('/j/promotions/campaigns', 'Campaigns', M),
      L('/j/segments', 'Segments', M),
      L('/j/marketing/push-campaigns', 'Push campaigns', M),
      L('/j/cs/notification-catalog', 'Notification catalog', M),
      L('/j/cs/notification-log', 'Notification log', M),
      L('/j/cs/notification-stats', 'Notification delivery stats', M),
      L('/j/cs/product-notify-funnel', 'Product notify funnel', M),
      L('/j/marketing/competitor-prices', 'เทียบราคาคู่แข่ง', ['marketing', ...BA]),
      L('/j/marketing/scraping-sources', 'ตั้งค่าเก็บข้อมูลเว็บ', M),
      L('/j/marketing/scraped-catalog', 'คลังข้อมูลเว็บคู่แข่ง', M),
    ],
  },
  {
    group: 'CS / แชต', icon: 'support_agent',
    links: [
      L('/cs', 'งาน CS (สั่งแทน / ตัวอย่าง / รวมบัญชี)', CS),
      L('/livechat', 'Live chat'),
      L('/j/bot/intent-rules', 'Bot · intent rules', M),
      L('/j/bot/workflows', 'Bot · workflows', M),
      L('/j/bot/templates', 'Bot · templates', M),
    ],
  },
  {
    group: 'สินค้า / ลูกค้า (จาก josh)', icon: 'shelves',
    links: [
      L('/j/allproducts', 'สินค้า (จัดการ)', [...MM, ...GFX]),
      L('/j/product/create', 'เพิ่มสินค้า', MM, true),
      L('/j/product/video-upload', 'Video upload', MM, true),
      L('/j/product/bulk-image-upload', 'Bulk image upload', [...MM, ...GFX], true),
      L('/j/suppliers', 'Suppliers', MM),
      L('/j/brands', 'แบรนด์', [...MM, ...GFX]),
      L('/j/allusers', 'ผู้ใช้ทั้งหมด'),
      L('/j/membership-tiers', 'ระดับสมาชิก'),
      L('/j/company', 'บริษัท'),
      L('/j/kyc', 'KYC'),
      L('/j/cs/sample-requests', 'Sample requests', CS),
      L('/j/cs/delivery-schedule', 'ตารางรอบส่ง', CS),
      L('/j/cs/cart-move-categories', 'หมวดที่ย้ายของในตะกร้าได้', CS),
      L('/j/price-requests', 'Price requests'),
      L('/j/active-offers', 'Active offers'),
      L('/j/admin-access', 'Admin access requests'),
    ],
  },
  {
    group: 'Order / การเงิน (จาก josh)', icon: 'receipt_long',
    links: [
      L('/j/order', 'Orders (จัดการ)', CS),
      L('/j/shipments', 'Shipments (จัดการ)', CS),
      L('/j/payment-transactions', 'รายการชำระเงิน (จัดการ)'),
      L('/j/order/import', 'นำเข้า order', undefined, true),
      L('/j/batch-sticker', 'พิมพ์ sticker'),
      L('/j/kbank/testing-console', 'KBank testing console'),
      L('/j/invoices', 'Overdue invoices'),
      L('/j/credit-notes', 'Credit notes', CS),
      L('/j/credit-backs', 'Credit backs', CS),
      L('/j/credit-terms', 'ใบสมัครเครดิต'),
      L('/j/billing', 'Billing'),
      L('/j/refunds', 'Returns & refunds'),
      L('/j/jagota/payment-testing', 'Jagota payment testing'),
      L('/j/erp/webhook-simulator', 'ERP webhook simulator (josh)'),
    ],
  },
  {
    group: 'Marketing (จาก josh)', icon: 'campaign',
    links: [
      L('/j/marketing/notify-templates', 'Template ข้อความ', M),
      L('/j/smart-links', 'Smart links', M),
      L('/j/marketing-links', 'Marketing links', M),
      L('/j/marketing/welcome-lead-email', 'อีเมลต้อนรับลีด', M),
      L('/j/marketing/settings', 'ตั้งค่าการตลาด', M),
      L('/j/marketing/queue', 'คิวงานการตลาด', M),
      L('/j/marketing/journey-funnel', 'Journey funnel', M),
      L('/j/marketing/offers-check', 'ตรวจข้อเสนอ', M),
    ],
  },
  { group: 'AI', icon: 'smart_toy', links: [L('/ai/connectors', 'AI connectors (MCP)', M)] },
  {
    group: 'ERP hub', icon: 'hub',
    links: [
      { to: '/erp/inbound-log', label: 'Inbound log', end: false },
      { to: '/erp/josh-logs', label: 'ERP log ของ josh', end: false },
      { to: '/erp/webhook-dead-letter', label: 'Dead letter', end: false },
      { to: '/erp/webhook-platforms', label: 'Platforms', end: false },
      L('/erp/inventory-warehouse', 'Inventory per warehouse', [...MER, ...BA]),
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
      L('/customers', 'Customers'),
      L('/products', 'Products', [...MER, ...GFX]),
      L('/stock-moves', 'Stock moves', MER),
      L('/product-prices', 'ราคาสินค้า', MER),
      L('/product-master-queue', 'คิวข้อมูลสินค้าจาก ERP', MER),
      L('/order-periods', 'รอบสั่งซื้อ supplier', MER),
      L('/orders', 'Orders', BA),
      L('/reservations', 'Reservations'),
    ],
  },
  {
    group: 'ตั้งค่า', icon: 'settings',
    links: [
      { to: '/settings/staff', label: 'บัญชี staff', end: false },
      { to: '/settings/josh-staff', label: 'บัญชี josh (staff)', end: false },
      L('/account/password', 'เปลี่ยนรหัสผ่าน', ALL),
    ],
  },
];
/** A link with no roles is admin-only. Admin sees every link. */
const navFor = (role?: string): NavGroup[] =>
  (role === 'admin' ? NAV : NAV.map((g) => ({ ...g, links: g.links.filter((l) => role && l.roles?.includes(role as StaffRole)) })))
    .filter((g) => g.links.length);

/** Live operations strip above every page (Stitch "Overview" top bar). Admin only — the feeds are admin routes. */
function AdminTopBar({ role }: { role?: string }) {
  if (role !== 'admin') {
    return <TopBar left={<span className="font-headline text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Commerce Operations</span>} />;
  }
  return <OpsTopBar />;
}

function OpsTopBar() {
  const navigate = useNavigate();
  const stats = useAsync(() => api.get<AdminStats>('/admin/stats'));
  const health = useAsync(() => reportsApi.health({ period: 'today' }));
  const problems = health.data?.now.problems.length ?? 0;
  const failed = stats.data?.webhooksFailed ?? 0;
  return (
    <TopBar
      left={
        <>
          <span className="font-headline text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Commerce Operations</span>
          <span className="h-3 w-px bg-secondary-container" />
          {health.data ? (
            <StatusDot tone={problems ? 'danger' : 'ok'}>
              <span className="text-on-surface font-medium">{problems ? `System: ${problems} problem${problems > 1 ? 's' : ''}` : 'System: healthy'}</span>
            </StatusDot>
          ) : (
            <StatusDot tone="muted">System: …</StatusDot>
          )}
          {stats.data && (
            <span className="hidden md:inline-flex">
              <StatusDot tone={stats.data.webhooksPending ? 'warn' : 'primary'}>
                <span className="text-on-surface-variant tabular-nums">Webhooks pending: {stats.data.webhooksPending.toLocaleString()}</span>
              </StatusDot>
            </span>
          )}
        </>
      }
      right={
        <>
          <Button icon="sync_alt" onClick={() => navigate('/sync-jobs')}>Manual Sync Trigger</Button>
          <Button onClick={() => navigate('/erp/inbound-log')}>Export Logs</Button>
          <span className="h-4 w-px bg-secondary-container mx-1" />
          <IconButton icon="notifications" title={failed ? `${failed} failed webhooks` : 'Notifications'} dot={failed > 0} onClick={() => navigate('/erp/webhook-dead-letter')} />
          <IconButton icon="terminal" title="API docs" onClick={() => window.open('/api/docs', '_blank', 'noopener')} />
          <IconButton icon="help_outline" title="AI connectors / help" onClick={() => navigate('/ai/connectors')} />
        </>
      }
    />
  );
}

export function App() {
  const [signedIn, setSignedIn] = useState(() => Boolean(session.get()));
  // null = not checked yet; the API refuses everything else while true, so the app waits for the change
  const [mustChangePassword, setMustChangePassword] = useState<boolean | null>(null);
  useEffect(() => {
    if (!signedIn) return setMustChangePassword(null);
    staffApi.me().then((me) => setMustChangePassword(!!me.mustChangePassword), () => setMustChangePassword(false));
  }, [signedIn]);
  useEffect(() => {
    const required = () => setMustChangePassword(true);
    window.addEventListener('cp-password-change-required', required);
    return () => window.removeEventListener('cp-password-change-required', required);
  }, []);
  useEffect(() => {
    const expired = () => setSignedIn(false);
    window.addEventListener('cp-session-expired', expired);
    return () => window.removeEventListener('cp-session-expired', expired);
  }, []);

  if (!signedIn) return <Login onSignedIn={() => setSignedIn(true)} />;

  const claims = session.claims();
  const role = claims?.role;
  const nav = navFor(role);

  function signOut() {
    session.clear();
    setSignedIn(false);
  }

  if (mustChangePassword === null) return null;
  if (mustChangePassword) return <BrowserRouter><ChangePassword forced onDone={() => setMustChangePassword(false)} onSignOut={signOut} /></BrowserRouter>;

  return (
    <BrowserRouter>
      <NavProvider nav={nav}>
      <AppShell
        sidebar={
          <Sidebar
            brand={{ title: 'Commerce Platform', subtitle: 'Admin console' }}
            env={<><span className="w-1.5 h-1.5 rounded-full bg-emerald-600 inline-block" />{import.meta.env.MODE === 'production' ? 'Prod' : 'Local dev'}</>}
            nav={nav}
            searchable
            user={{ name: claims?.email?.split('@')[0] ?? 'Staff', detail: claims ? `${claims.email} · ${STAFF_ROLE_LABEL[role as StaffRole] ?? role}` : undefined, onSignOut: signOut }}
          />
        }
        topbar={<AdminTopBar role={role} />}
      >
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/settings/staff" element={<StaffAccounts />} />
            <Route path="/settings/josh-staff" element={<JoshStaff />} />
            <Route path="/account/password" element={<ChangePassword />} />
            <Route path="/reports/orders" element={<JoshOrdersPage />} />
            <Route path="/reports/orders/:id" element={<JoshOrderDetail />} />
            <Route path="/josh/:view" element={<JoshBackoffice />} />
            <Route path="/josh-api-logs" element={<JoshApiLogs />} />
            <Route path="/reports/price-shadow" element={<PriceShadow />} />
            <Route path="/prices/staff" element={<StaffPrices />} />
            <Route path="/reports/customers" element={<JoshCustomersPage />} />
            <Route path="/reports/customers/:id" element={<JoshCustomerDetail />} />
            <Route path="/reports/prices" element={<JoshPricesPage />} />
            <Route path="/reports/products" element={<JoshProducts />} />
            <Route path="/reports/products/:id" element={<JoshProductDetail />} />
            <Route path="/reports/sales" element={<SalesReport />} />
            <Route path="/reports/traffic" element={<TrafficReport />} />
            <Route path="/reports/health" element={<HealthReportPage />} />
            <Route path="/reports/winback" element={<Winback />} />
            <Route path="/reports/order-targetgroup" element={<OrderTargetgroup />} />
            <Route path="/marketing/workflows" element={<MarketingWorkflows />} />
            <Route path="/marketing/analyst" element={<Suspense fallback={<Loading />}><MarketingAnalyst /></Suspense>} />
            <Route path="/marketing/growth" element={<GrowthWorkspace />} />
            <Route path="/marketing/growth/plans" element={<GrowthPlans />} />
            <Route path="/marketing/growth/plans/new" element={<GrowthPlanPage />} />
            <Route path="/marketing/growth/plans/:id" element={<GrowthPlanPage />} />
            <Route path="/marketing/growth/results/:workflowId" element={<GrowthResults />} />
            <Route path="/marketing/growth/companies/:companyId" element={<GrowthTimeline />} />
            <Route path="/marketing/workflows/new" element={<WorkflowEditor />} />
            <Route path="/marketing/workflows/:id/edit" element={<WorkflowEditor />} />
            <Route path="/marketing/workflows/:id/enrollments" element={<WorkflowEnrollments />} />
            <Route path="/marketing/workflows/:id/scheduled-runs" element={<WorkflowScheduledRuns />} />
            <Route path="/j/*" element={<JoshAdminApp />} />
            <Route path="/cs" element={<CsDesk />} />
            <Route path="/livechat" element={<Livechat />} />
            <Route path="/marketing/restaurants" element={<MarketExplorer />} />
            <Route path="/marketing/research" element={<MarketingResearch />} />
            {/* Competitor prices + scraping are josh's pages (under /j) on commerce's API; old links still work. */}
            <Route path="/marketing/scraping-sources" element={<Navigate to="/j/marketing/scraping-sources" replace />} />
            <Route path="/marketing/scraped-catalog" element={<Navigate to="/j/marketing/scraped-catalog" replace />} />
            <Route path="/marketing/competitor-prices" element={<Navigate to="/j/marketing/competitor-prices" replace />} />
            <Route path="/ai/connectors" element={<AiConnectors />} />
            <Route path="/erp/josh-logs" element={<JoshErpLogs />} />
            <Route path="/erp/inbound-log" element={<InboundLog />} />
            <Route path="/erp/webhook-dead-letter" element={<WebhookDeadLetter />} />
            <Route path="/erp/webhook-platforms" element={<WebhookPlatforms />} />
            <Route path="/erp/inventory-warehouse" element={<InventoryPerWarehouse />} />
            <Route path="/erp/jagota-shadow" element={<JagotaShadow />} />
            <Route path="/erp/simulator" element={<ErpSimulator />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/webhooks" element={<Webhooks />} />
            <Route path="/subscriptions" element={<Subscriptions />} />
            <Route path="/sync-jobs" element={<SyncJobs />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/customers/:id" element={<CustomerDetail />} />
            <Route path="/products" element={<Products />} />
            <Route path="/products/:id" element={<ProductDetail />} />
            <Route path="/stock-moves" element={<StockMoves />} />
            <Route path="/product-prices" element={<ProductPrices />} />
            <Route path="/product-master-queue" element={<ProductMasterQueue />} />
            <Route path="/order-periods" element={<SupplierOrderPeriods />} />
            <Route path="/inventory" element={<Navigate to="/stock-moves" replace />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/orders/:id" element={<OrderDetail />} />
            <Route path="/reservations" element={<Reservations />} />
            <Route path="/erp-stock" element={<ErpStock />} />
            <Route path="/erp-ingest" element={<ErpIngest />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
      </AppShell>
      </NavProvider>
    </BrowserRouter>
  );
}

export default App;
