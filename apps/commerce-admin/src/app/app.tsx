import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AppShell, Button, IconButton, Loading, NavGroup, Sidebar, StatusDot, TopBar, NavProvider } from '@cp/ui';
import { AdminStats, api, reportsApi, session, staffApi } from '../lib/api';
import { useAsync } from './hooks';
import { Login } from './pages/Login';
import { StaffAccounts } from './pages/StaffAccounts';
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

const NAV: NavGroup[] = [
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
      { to: '/orders', label: 'Orders', end: false },
      { to: '/reservations', label: 'Reservations', end: false },
    ],
  },
  {
    group: 'ตั้งค่า', icon: 'settings',
    links: [
      { to: '/settings/staff', label: 'บัญชี staff', end: false },
      { to: '/account/password', label: 'เปลี่ยนรหัสผ่าน', end: false },
    ],
  },
];
/** Staff accounts are admin-only (the API refuses others too); everyone can change their own password. */
const navFor = (role?: string): NavGroup[] =>
  role === 'admin' ? NAV : NAV.map((g) => ({ ...g, links: g.links.filter((l) => l.to !== '/settings/staff') }));

/** Live operations strip above every page (Stitch "Overview" top bar), fed by the same endpoints the pages use. */
function AdminTopBar() {
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
  const nav = navFor(claims?.role);

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
            user={{ name: claims?.email?.split('@')[0] ?? 'Staff', detail: claims ? `${claims.email} · ${claims.role}` : undefined, onSignOut: signOut }}
          />
        }
        topbar={<AdminTopBar />}
      >
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/settings/staff" element={<StaffAccounts />} />
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
