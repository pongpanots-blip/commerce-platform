import { useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, matchPath, useLocation } from 'react-router-dom';
import { session } from '../lib/api';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Integrations } from './pages/Integrations';
import { Webhooks } from './pages/Webhooks';
import { Subscriptions } from './pages/Subscriptions';
import { SyncJobs } from './pages/SyncJobs';
import { Customers } from './pages/Customers';
import { Products } from './pages/Products';
import { Inventory } from './pages/Inventory';
import { Orders } from './pages/Orders';
import { Reservations } from './pages/Reservations';
import { ErpStock } from './pages/ErpStock';
import { ErpIngest } from './pages/ErpIngest';
import { MarketingResearch } from './pages/MarketingResearch';
import { ScrapingSources } from './pages/ScrapingSources';
import { ScrapedCatalog } from './pages/ScrapedCatalog';
import { CompetitorPrices } from './pages/CompetitorPrices';
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

const NAV = [
  { group: 'Platform', links: [{ to: '/', label: 'Overview', end: true }] },
  {
    group: 'รายงานร้าน (josh)',
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
    group: 'หลังบ้าน josh (อ่านจาก replica ใช้ได้แม้ josh ล่ม)',
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
    group: 'Marketing',
    links: [
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
      { to: '/marketing/competitor-prices', label: 'เทียบราคาคู่แข่ง', end: false },
      { to: '/marketing/scraping-sources', label: 'ตั้งค่าเก็บข้อมูลเว็บ', end: false },
      { to: '/marketing/scraped-catalog', label: 'คลังข้อมูลเว็บคู่แข่ง', end: false },
    ],
  },
  {
    group: 'CS / แชต',
    links: [
      { to: '/cs', label: 'งาน CS (สั่งแทน / ตัวอย่าง / รวมบัญชี)', end: false },
      { to: '/livechat', label: 'Live chat', end: false },
      { to: '/j/bot/intent-rules', label: 'Bot · intent rules', end: false },
      { to: '/j/bot/workflows', label: 'Bot · workflows', end: false },
      { to: '/j/bot/templates', label: 'Bot · templates', end: false },
    ],
  },
  {
    group: 'สินค้า / ลูกค้า (จาก josh)',
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
      { to: '/j/price-requests', label: 'Price requests', end: false },
      { to: '/j/active-offers', label: 'Active offers', end: false },
      { to: '/j/admin-access', label: 'Admin access requests', end: false },
    ],
  },
  {
    group: 'Order / การเงิน (จาก josh)',
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
    group: 'Marketing (จาก josh)',
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
  { group: 'AI', links: [{ to: '/ai/connectors', label: 'AI connectors (MCP)', end: false }] },
  {
    group: 'ERP hub',
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
    group: 'Integration',
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
    group: 'Commerce data',
    links: [
      { to: '/customers', label: 'Customers', end: false },
      { to: '/products', label: 'Products', end: false },
      { to: '/inventory', label: 'Inventory', end: false },
      { to: '/orders', label: 'Orders', end: false },
      { to: '/reservations', label: 'Reservations', end: false },
    ],
  },
];

/** Grouped nav with a filter box; only the open groups (and the one holding the current page) show their links. */
function SideNav() {
  const { pathname } = useLocation();
  const [query, setQuery] = useState('');
  // Groups the user toggled; untouched groups default to open only when they hold the current page.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();
  const isCurrent = (l: { to: string; end: boolean }) => Boolean(matchPath({ path: l.to, end: l.end }, pathname));

  return (
    <nav className="nav">
      <input
        className="nav-search"
        type="search"
        placeholder="ค้นหาเมนู…"
        aria-label="ค้นหาเมนู"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {NAV.map((section) => {
        const links = q ? section.links.filter((l) => l.label.toLowerCase().includes(q)) : section.links;
        if (!links.length) return null;
        const expanded = Boolean(q) || (toggled[section.group] ?? section.links.some(isCurrent));
        return (
          <div key={section.group}>
            <button
              className="group"
              type="button"
              aria-expanded={expanded}
              onClick={() => setToggled((t) => ({ ...t, [section.group]: !expanded }))}
            >
              <span className="chev" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
              <span className="group-name">{section.group}</span>
              <span className="count">{links.length}</span>
            </button>
            {expanded &&
              links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end}>
                  {l.label}
                </NavLink>
              ))}
          </div>
        );
      })}
    </nav>
  );
}

export function App() {
  const [signedIn, setSignedIn] = useState(() => Boolean(session.get()));
  useEffect(() => {
    const expired = () => setSignedIn(false);
    window.addEventListener('cp-session-expired', expired);
    return () => window.removeEventListener('cp-session-expired', expired);
  }, []);

  if (!signedIn) return <Login onSignedIn={() => setSignedIn(true)} />;

  function signOut() {
    session.clear();
    setSignedIn(false);
  }

  return (
    <BrowserRouter>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">Commerce Platform<small>Admin console</small></div>
          <SideNav />
          <div className="side-foot">
            <span>Signed in</span>
            <button className="btn ghost sm" type="button" onClick={signOut}>Sign out</button>
          </div>
        </aside>
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/reports/orders" element={<JoshOrdersPage />} />
            <Route path="/josh/:view" element={<JoshBackoffice />} />
            <Route path="/josh-api-logs" element={<JoshApiLogs />} />
            <Route path="/reports/price-shadow" element={<PriceShadow />} />
            <Route path="/prices/staff" element={<StaffPrices />} />
            <Route path="/reports/customers" element={<JoshCustomersPage />} />
            <Route path="/reports/prices" element={<JoshPricesPage />} />
            <Route path="/reports/products" element={<JoshProducts />} />
            <Route path="/reports/sales" element={<SalesReport />} />
            <Route path="/reports/traffic" element={<TrafficReport />} />
            <Route path="/reports/health" element={<HealthReportPage />} />
            <Route path="/reports/winback" element={<Winback />} />
            <Route path="/reports/order-targetgroup" element={<OrderTargetgroup />} />
            <Route path="/marketing/workflows" element={<MarketingWorkflows />} />
            <Route path="/marketing/workflows/new" element={<WorkflowEditor />} />
            <Route path="/marketing/workflows/:id/edit" element={<WorkflowEditor />} />
            <Route path="/marketing/workflows/:id/enrollments" element={<WorkflowEnrollments />} />
            <Route path="/marketing/workflows/:id/scheduled-runs" element={<WorkflowScheduledRuns />} />
            <Route path="/j/*" element={<JoshAdminApp />} />
            <Route path="/cs" element={<CsDesk />} />
            <Route path="/livechat" element={<Livechat />} />
            <Route path="/marketing/restaurants" element={<MarketExplorer />} />
            <Route path="/marketing/research" element={<MarketingResearch />} />
            <Route path="/marketing/scraping-sources" element={<ScrapingSources />} />
            <Route path="/marketing/scraped-catalog" element={<ScrapedCatalog />} />
            <Route path="/marketing/competitor-prices" element={<CompetitorPrices />} />
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
            <Route path="/products" element={<Products />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/reservations" element={<Reservations />} />
            <Route path="/erp-stock" element={<ErpStock />} />
            <Route path="/erp-ingest" element={<ErpIngest />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
