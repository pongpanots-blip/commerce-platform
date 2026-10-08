import { SalesAssignment } from './pages/SalesAssignment';
import { MyWinback } from './pages/MyWinback';
import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AppShell, CommandMenu, IconButton, LanguageSelector, Loading, Sidebar, StatusDot, TopBar, NavProvider, currentNavItem, useUiLocale } from '@cp/ui';
import { navFor } from './navigation';
import { Workspace } from './pages/Workspace';
import { RoleHome } from './pages/RoleHome';
import { AdminStats, api, logout, reportsApi, restoreSession, session, staffApi, STAFF_ROLE_LABEL, StaffRole } from '../lib/api';
import { initialAuthState } from '../lib/auth';
import { landingFor, loginPathFor, redirectParam, resolvePostLoginPath } from '../lib/landing';
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
function AdminTopBar({ role }: { role?: string }) {
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
  const current = currentNavItem(navFor(session.claims()?.role), pathname);
  const stats = useAsync(() => role === 'admin' ? api.get<AdminStats>('/admin/stats') : Promise.resolve(null), [role]);
  const health = useAsync(() => role === 'admin' ? reportsApi.health({ period: 'today' }) : Promise.resolve(null), [role]);
  const problems = health.data?.now.problems.length ?? 0;
  const docsBase = import.meta.env.VITE_COMMERCE_API || (import.meta.env.DEV ? 'http://localhost:3100/api' : '/api');
  return <TopBar
    left={<div className="flex flex-wrap items-center gap-3">
      <div><p className="text-[10px] uppercase tracking-widest text-outline">{__uiText("ตอนนี้อยู่ที่")}</p><p className="mt-0.5 text-sm font-semibold text-on-surface">{__uiText(current?.group.group ?? "หน้าหลัก")}<span className="hidden lg:inline font-normal text-on-surface-variant"> / {current ? __uiText(current.link.label) : pageHeading || __uiText("รายละเอียด")}</span></p></div>
      {role === 'admin' && <span className="hidden xl:inline-flex"><StatusDot tone={health.error ? 'muted' : health.data ? problems ? 'danger' : 'ok' : 'muted'}>{health.error ? __uiText("ยังตรวจสอบระบบไม่ได้") : health.data ? problems ? __uiText("{0} รายการต้องตรวจสอบ", {"0": problems}) : __uiText("ระบบปกติ") : __uiText("กำลังตรวจสอบระบบ")}</StatusDot></span>}
    </div>}
    right={<><LanguageSelector /><CommandMenu />{role === 'admin' && <IconButton icon="notifications" title={__uiText("ตรวจสอบรายการส่งไม่สำเร็จ")} dot={(stats.data?.webhooksFailed ?? 0) > 0} onClick={() => navigate('/erp/webhook-dead-letter')} />}<IconButton icon="menu_book" title={__uiText("คู่มือ API")} onClick={() => window.open(`${docsBase.replace(/\/$/, '')}/docs`, '_blank', 'noopener')} /></>}
  />;
}

/** /login while signed in: on to the deep link if this role may open it, else the role's home. */
function LoginRedirect({ role }: { role?: string }) {
  const [params] = useSearchParams();
  return <Navigate to={resolvePostLoginPath(role, params.get('redirect'))} replace />;
}

const here = () => window.location.pathname + window.location.search + window.location.hash;

export function App() {
  useUiLocale();
  // 'checking' = a refresh token but no fresh access token: refresh silently before showing anything
  const [auth, setAuth] = useState(initialAuthState);
  const signedIn = auth === 'in';
  useEffect(() => {
    if (auth === 'checking') restoreSession().then((ok) => setAuth(ok ? 'in' : 'out'));
    // signed out: the URL becomes /login, remembering where you were (?redirect=)
    if (auth === 'out' && here() !== loginPathFor(here())) window.history.replaceState(null, '', loginPathFor(here()));
  }, [auth]);
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
    const expired = () => setAuth('out');
    window.addEventListener('cp-session-expired', expired);
    return () => window.removeEventListener('cp-session-expired', expired);
  }, []);

  if (auth === 'checking') return <div className="min-h-screen bg-background flex items-center justify-center"><Loading /></div>;
  if (!signedIn) {
    return <Login onSignedIn={(role) => {
      // the router mounts after this, at the deep link (if allowed) or the role's home
      window.history.replaceState(null, '', resolvePostLoginPath(role, redirectParam(window.location.search)));
      setAuth('in');
    }} />;
  }

  const claims = session.claims();
  const role = claims?.role;
  const nav = navFor(role);

  async function signOut() {
    await logout();
    window.history.replaceState(null, '', '/login');
    setAuth('out');
  }

  if (mustChangePassword === null) return null;
  if (mustChangePassword) return <BrowserRouter><ChangePassword forced onDone={() => setMustChangePassword(false)} onSignOut={signOut} /></BrowserRouter>;

  return (
    <BrowserRouter>
      <NavProvider nav={nav}>
      <AppShell
        sidebar={
          <Sidebar
            brand={{ title: __uiText('ระบบหลังบ้าน'), subtitle: 'สำหรับทีมงาน' }}
            env={<><span className="w-1.5 h-1.5 rounded-full bg-emerald-600 inline-block" />{import.meta.env.MODE === 'production' ? __uiText("Prod") : __uiText("Local dev")}</>}
            nav={nav}
            searchable
            user={{ name: claims?.email?.split('@')[0] ?? 'Staff', detail: claims ? `${claims.email} · ${__uiText(STAFF_ROLE_LABEL[role as StaffRole] ?? role ?? '')}` : undefined, onSignOut: signOut }}
          />
        }
        topbar={<AdminTopBar role={role} />}
      >
          <Routes>
            <Route path="/" element={role === 'admin' ? <Dashboard /> : <Navigate to={landingFor(role)} replace />} />
            <Route path="/login" element={<LoginRedirect role={role} />} />
            <Route path="/home" element={<RoleHome role={role} />} />
            {/* #80 workspace overview pages: old links open the replacing section */}
            <Route path="/workspaces/:workspaceId" element={<Workspace role={role} />} />
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
            <Route path="/cs/sales-assignment" element={<SalesAssignment />} />
            <Route path="/reports/winback/opportunities" element={<MyWinback />} />
            <Route path="/reports/winback/my" element={<MyWinback />} />
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
