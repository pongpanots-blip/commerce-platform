import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppShell, CommandMenu, IconButton, LanguageSelector, Loading, Sidebar, StatusDot, TopBar, NavProvider, useUiLocale } from '@cp/ui';
import { navFor } from './navigation';
import { Workspace } from './pages/Workspace';
import { AdminStats, api, reportsApi, session, staffApi } from '../lib/api';
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
// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const MarketingAnalyst = lazy(() => import('./pages/MarketingAnalyst'));

/** Route context and a single page-search entry point across every category. */
function AdminTopBar() {
  __useUiLocale();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [pageHeading, setPageHeading] = useState('');
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    const refresh = () => setPageHeading(main.querySelector('h1')?.textContent?.trim() ?? '');
    const observer = new MutationObserver(refresh);
    observer.observe(main, { childList: true, subtree: true, characterData: true });
    refresh();
    return () => observer.disconnect();
  }, [pathname]);
  const nav = navFor(session.claims()?.role);
  const current = nav.flatMap(group => group.links.map(link => ({ group, link })))
    .filter(({ link }) => pathname === link.to || (link.to !== '/' && !link.end && pathname.startsWith(link.to + '/')))
    .sort((a, b) => b.link.to.length - a.link.to.length)[0];
  const stats = useAsync(() => api.get<AdminStats>('/admin/stats'));
  const health = useAsync(() => reportsApi.health({ period: 'today' }));
  const problems = health.data?.now.problems.length ?? 0;
  const docsBase = import.meta.env.VITE_COMMERCE_API || (import.meta.env.DEV ? 'http://localhost:3100/api' : '/api');
  return <TopBar
    left={<div className="flex flex-wrap items-center gap-3">
      <div><p className="text-[10px] uppercase tracking-widest text-outline">{__uiText("Commerce workspace")}</p><p className="mt-0.5 text-sm font-semibold text-on-surface">{__uiText(current?.group.group ?? "พื้นที่ทำงาน")}<span className="hidden lg:inline font-normal text-on-surface-variant"> / {current ? __uiText(current.link.label) : pageHeading || __uiText("รายละเอียด")}</span></p></div>
      <span className="hidden xl:inline-flex"><StatusDot tone={health.error ? 'muted' : health.data ? problems ? 'danger' : 'ok' : 'muted'}>{health.error ? __uiText("ยังตรวจสอบระบบไม่ได้") : health.data ? problems ? __uiText("{0} รายการต้องตรวจสอบ", {"0": problems}) : __uiText("ระบบปกติ") : __uiText("กำลังตรวจสอบระบบ")}</StatusDot></span>
    </div>}
    right={<><LanguageSelector /><CommandMenu /><IconButton icon="notifications" title={__uiText("ตรวจสอบรายการส่งไม่สำเร็จ")} dot={(stats.data?.webhooksFailed ?? 0) > 0} onClick={() => navigate('/erp/webhook-dead-letter')} /><IconButton icon="menu_book" title={__uiText("คู่มือ API")} onClick={() => window.open(`${docsBase.replace(/\/$/, '')}/docs`, '_blank', 'noopener')} /></>}
  />;
}

export function App() {
  useUiLocale();
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
            brand={{ title: 'Commerce Platform', subtitle: 'พื้นที่ทำงานของทีม' }}
            env={<><span className="w-1.5 h-1.5 rounded-full bg-emerald-600 inline-block" />{import.meta.env.MODE === 'production' ? __uiText("Prod") : __uiText("Local dev")}</>}
            nav={nav}
            searchable
            user={{ name: claims?.email?.split('@')[0] ?? 'Staff', detail: claims ? `${claims.email} · ${claims.role}` : undefined, onSignOut: signOut }}
          />
        }
        topbar={<AdminTopBar />}
      >
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/workspaces/:workspaceId" element={<Workspace />} />
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
