import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AppShell, Button, IconButton, NavGroup, Sidebar, StatusDot, TopBar, NavProvider } from '@cp/ui';
import { AdminStats, api, reportsApi, session } from '../lib/api';
import { useAsync } from './hooks';
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
import { PushCampaigns } from './pages/PushCampaigns';
import { JoshProducts } from './pages/JoshProducts';
import { JoshCustomersPage, JoshOrdersPage, JoshPricesPage } from './pages/JoshCommerce';
import { JagotaShadow } from './pages/JagotaShadow';
import { JoshBackoffice } from './pages/JoshBackoffice';
import { JoshApiLogs } from './pages/JoshApiLogs';
import { PriceShadow } from './pages/PriceShadow';
import { StaffPrices } from './pages/StaffPrices';
import { Promotions } from './pages/Promotions';
import { MarketingWorkflows } from './pages/MarketingWorkflows';

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
    group: 'หลังบ้าน josh (อ่านอย่างเดียว)', icon: 'inventory_2',
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
      { to: '/marketing/research', label: 'Research', end: false },
      { to: '/marketing/restaurants', label: 'Market Explorer (ร้านอาหาร)', end: false },
      { to: '/marketing/push-campaigns', label: 'Push campaigns', end: false },
      { to: '/marketing/promotions', label: 'โปรโมชัน', end: false },
      { to: '/marketing/workflows', label: 'Marketing workflows', end: false },
      { to: '/marketing/competitor-prices', label: 'เทียบราคาคู่แข่ง', end: false },
      { to: '/marketing/scraping-sources', label: 'ตั้งค่าเก็บข้อมูลเว็บ', end: false },
      { to: '/marketing/scraped-catalog', label: 'คลังข้อมูลเว็บคู่แข่ง', end: false },
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
      { to: '/inventory', label: 'Inventory', end: false },
      { to: '/orders', label: 'Orders', end: false },
      { to: '/reservations', label: 'Reservations', end: false },
    ],
  },
];

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
  useEffect(() => {
    const expired = () => setSignedIn(false);
    window.addEventListener('cp-session-expired', expired);
    return () => window.removeEventListener('cp-session-expired', expired);
  }, []);

  if (!signedIn) return <Login onSignedIn={() => setSignedIn(true)} />;

  const claims = session.claims();

  function signOut() {
    session.clear();
    setSignedIn(false);
  }

  return (
    <BrowserRouter>
      <NavProvider nav={NAV}>
      <AppShell
        sidebar={
          <Sidebar
            brand={{ title: 'Commerce Platform', subtitle: 'Admin console' }}
            env={<><span className="w-1.5 h-1.5 rounded-full bg-emerald-600 inline-block" />{import.meta.env.MODE === 'production' ? 'Prod' : 'Local dev'}</>}
            nav={NAV}
            searchable
            user={{ name: claims?.email?.split('@')[0] ?? 'Staff', detail: claims ? `${claims.email} · ${claims.role}` : undefined, onSignOut: signOut }}
          />
        }
        topbar={<AdminTopBar />}
      >
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
            <Route path="/marketing/push-campaigns" element={<PushCampaigns />} />
            <Route path="/marketing/promotions" element={<Promotions />} />
            <Route path="/marketing/workflows" element={<MarketingWorkflows />} />
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
      </AppShell>
      </NavProvider>
    </BrowserRouter>
  );
}

export default App;
