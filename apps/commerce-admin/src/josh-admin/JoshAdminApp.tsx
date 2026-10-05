import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import './josh-admin.css';

const Alluser = lazy(() => import('./app/page/user/Alluser'));
const BatchSticker = lazy(() => import('./app/page/batch-sticker/BatchSticker'));
const BrandList = lazy(() => import('./app/page/brand/BrandList'));
const CategoryList = lazy(() => import('./app/page/category/CategoryList'));
const CreateCategory = lazy(() => import('./app/page/category/CreateCategory'));
const CreateTrustedBrand = lazy(() => import('./app/page/trusted-brand/CreateTrustedBrand'));
const CreateTrustedUser = lazy(() => import('./app/page/trusted-user/CreateTrustedUser'));
const CuisineCardEdit = lazy(() => import('./app/page/cuisine/CuisineCardEdit'));
const CuisineCardsPage = lazy(() => import('./app/page/cuisine/CuisineCardsPage'));
const CuisineNamesPage = lazy(() => import('./app/page/cuisine/CuisineNamesPage'));
const EditCategory = lazy(() => import('./app/page/category/EditCategory'));
const EditTrustedBrand = lazy(() => import('./app/page/trusted-brand/EditTrustedBrand'));
const EditTrustedUser = lazy(() => import('./app/page/trusted-user/EditTrustedUser'));
const KbankTestingConsole = lazy(() => import('./app/page/kbank/KbankTestingConsole'));
const MarketingBannerTargeting = lazy(() => import('./app/page/marketing/MarketingBannerTargeting'));
const MarketingJourneyFunnel = lazy(() => import('./app/page/marketing/MarketingJourneyFunnel'));
const MarketingLinksPage = lazy(() => import('./app/page/marketing/MarketingLinksPage'));
const MarketingNotifyTemplates = lazy(() => import('./app/page/marketing/MarketingNotifyTemplates'));
const MarketingOfferCheckPage = lazy(() => import('./app/page/marketing/MarketingOfferCheckPage'));
const MarketingQueueDashboard = lazy(() => import('./app/page/marketing/MarketingQueueDashboard'));
const MarketingSettingsPage = lazy(() => import('./app/page/marketing/MarketingSettingsPage'));
const MembershipTierConfig = lazy(() => import('./app/page/membership-tier/MembershipTierConfig'));
const Order = lazy(() => import('./app/page/Order'));
const OrderDetail = lazy(() => import('./app/page/OrderDetail'));
const OrderImport = lazy(() => import('./app/page/orders/OrderImport'));
const PaymentTransactions = lazy(() => import('./app/page/orders/PaymentTransactions'));
const ShipmentDetail = lazy(() => import('./app/page/orders/ShipmentDetail'));
const Shipments = lazy(() => import('./app/page/orders/Shipments'));
const SmartLinkAnalyticsPage = lazy(() => import('./app/page/marketing/SmartLinkAnalyticsPage'));
const SmartLinkEdit = lazy(() => import('./app/page/marketing/SmartLinkEdit'));
const SmartLinksPage = lazy(() => import('./app/page/marketing/SmartLinksPage'));
const TrustedBrandList = lazy(() => import('./app/page/trusted-brand/TrustedBrandList'));
const TrustedUserList = lazy(() => import('./app/page/trusted-user/TrustedUserList'));
const UserDetail = lazy(() => import('./app/page/user/UserDetail'));
const WelcomeLeadEmailPage = lazy(() => import('./app/page/marketing/WelcomeLeadEmailPage'));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

/**
 * josh web-admin pages that commerce now owns, copied from josh unchanged (src/josh-admin/app) and
 * mounted under /j with josh's own paths (ADMIN_ROUTES is prefixed). Their API calls reach josh's
 * admin routes through commerce (josh-admin/libs/shared-api api-client → /api/josh/admin-call).
 * To refresh from josh: copy the same files again; only api-client.ts, admin-auth.ts and the
 * ADMIN_ROUTES prefix are commerce's.
 */
export function JoshAdminApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="josh-tw">
        <Suspense fallback={<div className="p-6 text-sm text-ink-muted">Loading…</div>}>
          <Routes>
            <Route path="batch-sticker" element={<BatchSticker />} />
            <Route path="categories" element={<CategoryList />} />
            <Route path="categories/create" element={<CreateCategory />} />
            <Route path="categories/edit/:id" element={<EditCategory />} />
            <Route path="trusted-brands" element={<TrustedBrandList />} />
            <Route path="trusted-brand/create" element={<CreateTrustedBrand />} />
            <Route path="trusted-brand/edit/:id" element={<EditTrustedBrand />} />
            <Route path="trusted-users" element={<TrustedUserList />} />
            <Route path="trusted-user/create" element={<CreateTrustedUser />} />
            <Route path="trusted-user/edit/:id" element={<EditTrustedUser />} />
            <Route path="cuisine-cards" element={<CuisineCardsPage />} />
            <Route path="cuisine-cards/create" element={<CuisineCardEdit />} />
            <Route path="cuisine-cards/edit/:id" element={<CuisineCardEdit />} />
            <Route path="cuisine-names" element={<CuisineNamesPage />} />
            <Route path="marketing-links" element={<MarketingLinksPage />} />
            <Route path="marketing/queue" element={<MarketingQueueDashboard />} />
            <Route path="marketing/journey-funnel" element={<MarketingJourneyFunnel />} />
            <Route path="marketing/notify-templates" element={<MarketingNotifyTemplates />} />
            <Route path="marketing/banner-targeting" element={<MarketingBannerTargeting />} />
            <Route path="marketing/settings" element={<MarketingSettingsPage />} />
            <Route path="marketing/welcome-lead-email" element={<WelcomeLeadEmailPage />} />
            <Route path="marketing/offers-check" element={<MarketingOfferCheckPage />} />
            <Route path="smart-links" element={<SmartLinksPage />} />
            <Route path="smart-links/create" element={<SmartLinkEdit />} />
            <Route path="smart-links/analytics" element={<SmartLinkAnalyticsPage />} />
            <Route path="smart-links/analytics/:id" element={<SmartLinkAnalyticsPage />} />
            <Route path="smart-links/edit/:id" element={<SmartLinkEdit />} />
            <Route path="order" element={<Order />} />
            <Route path="order/import" element={<OrderImport />} />
            <Route path="order/:ordersId" element={<OrderDetail />} />
            <Route path="shipments" element={<Shipments />} />
            <Route path="shipments/:shipmentId" element={<ShipmentDetail />} />
            <Route path="payment-transactions" element={<PaymentTransactions />} />
            <Route path="allusers" element={<Alluser />} />
            <Route path="allusers/:userId" element={<UserDetail />} />
            <Route path="membership-tiers" element={<MembershipTierConfig />} />
            <Route path="brands" element={<BrandList />} />
            <Route path="kbank/testing-console" element={<KbankTestingConsole />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
    </QueryClientProvider>
  );
}
