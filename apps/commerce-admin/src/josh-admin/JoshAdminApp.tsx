import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import './josh-admin.css';

const Alluser = lazy(() => import('./app/page/user/Alluser'));
const BatchSticker = lazy(() => import('./app/page/batch-sticker/BatchSticker'));
const BrandList = lazy(() => import('./app/page/brand/BrandList'));
const KbankTestingConsole = lazy(() => import('./app/page/kbank/KbankTestingConsole'));
const InvoicesOverdue = lazy(() => import('./app/page/CS/InvoicesOverdue'));
const CreditTermsAdmin = lazy(() => import('./app/page/CS/CreditTermsAdmin'));
const CreditNotesAdmin = lazy(() => import('./app/page/accounting/CreditNotesAdmin'));
const CreditBacksAdmin = lazy(() => import('./app/page/accounting/CreditBacksAdmin'));
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
const UserDetail = lazy(() => import('./app/page/user/UserDetail'));
const WelcomeLeadEmailPage = lazy(() => import('./app/page/marketing/WelcomeLeadEmailPage'));
const KycQueue = lazy(() => import('./app/page/kyc/KycQueue'));
const PromotionPageLibrary = lazy(() => import('./app/page/promotion-page/PromotionPageLibrary'));
const PromotionPageEditorPage = lazy(() => import('./app/page/promotion-page/PromotionPageEditorPage'));
const BotIntentRules = lazy(() => import('./app/page/bot/BotIntentRules'));
const CreateBotIntentRule = lazy(() => import('./app/page/bot/CreateBotIntentRule'));
const EditBotIntentRule = lazy(() => import('./app/page/bot/EditBotIntentRule'));
const BotWorkflows = lazy(() => import('./app/page/bot/BotWorkflows'));
const CreateBotWorkflow = lazy(() => import('./app/page/bot/CreateBotWorkflow'));
const EditBotWorkflow = lazy(() => import('./app/page/bot/EditBotWorkflow'));
const BotTemplates = lazy(() => import('./app/page/bot/BotTemplates'));
const CreateBotTemplate = lazy(() => import('./app/page/bot/CreateBotTemplate'));
const EditBotTemplate = lazy(() => import('./app/page/bot/EditBotTemplate'));
const PushCampaignsPage = lazy(() => import('./app/page/marketing/PushCampaignsPage'));
const Company = lazy(() => import('./app/page/company/Company'));
const CreateCompanyAdmin = lazy(() => import('./app/page/CS/CreateCompanyAdmin'));
const CompanyEdit = lazy(() => import('./app/page/company/CompanyEdit'));
const RefundsAdmin = lazy(() => import('./app/page/CS/RefundsAdmin'));
const SegmentList = lazy(() => import('./app/page/segment/SegmentList'));
const CreateSegment = lazy(() => import('./app/page/segment/CreateSegment'));
const EditSegment = lazy(() => import('./app/page/segment/EditSegment'));
const SegmentBuilder = lazy(() => import('./app/page/segment/SegmentBuilder'));
const SampleRequestsAdmin = lazy(() => import('./app/page/CS/SampleRequestsAdmin'));
const DeliveryScheduleAdmin = lazy(() => import('./app/page/CS/DeliveryScheduleAdmin'));
const CartMoveCategoriesAdmin = lazy(() => import('./app/page/CS/CartMoveCategoriesAdmin'));
const AllProduct = lazy(() => import('./app/page/product/AllProduct'));
const InsertProductForm = lazy(() => import('./app/page/product/CreateProduct'));
const ProductVideoUpload = lazy(() => import('./app/page/product/ProductVideoUpload'));
const BulkImageUploadPage = lazy(() => import('./app/page/product/BulkImageUploadPage'));
const EditProduct = lazy(() => import('./app/page/product/EditProduct'));
const ProductDetail = lazy(() => import('./app/page/product/ProductDetail'));
const SupplierList = lazy(() => import('./app/page/supplier/SupplierList'));
const CreateSupplier = lazy(() => import('./app/page/supplier/CreateSupplier'));
const EditSupplier = lazy(() => import('./app/page/supplier/EditSupplier'));
const PriceRequestsAdmin = lazy(() => import('./app/page/CS/PriceRequestsAdmin'));
const ActiveOffersAdmin = lazy(() => import('./app/page/CS/ActiveOffersAdmin'));
const CouponList = lazy(() => import('./app/page/coupon/CouponList'));
const CreateCoupon = lazy(() => import('./app/page/coupon/CreateCoupon'));
const CouponDetail = lazy(() => import('./app/page/coupon/CouponDetail'));
const PromotionProductSetList = lazy(() => import('./app/page/promotion-product-set/PromotionProductSetList'));
const PromotionProductSetForm = lazy(() => import('./app/page/promotion-product-set/PromotionProductSetForm'));
const PromotionMechanic = lazy(() => import('./app/page/campain/PromotionMechanic'));
const MechanicEditorPage = lazy(() => import('./app/page/campain/MechanicEditorPage'));
const CampaignList = lazy(() => import('./app/page/campaign/CampaignList'));
const CreateCampaign = lazy(() => import('./app/page/campaign/CreateCampaign'));
const CampaignDetail = lazy(() => import('./app/page/campaign/CampaignDetail'));
const NotificationLog = lazy(() => import('./app/page/CS/NotificationLog'));
const NotificationDeliveryStats = lazy(() => import('./app/page/CS/NotificationDeliveryStats'));
const NotificationCatalog = lazy(() => import('./app/page/CS/NotificationCatalog'));
const ProductNotifyFunnelPage = lazy(() => import('./app/page/CS/ProductNotifyFunnel'));
const JagotaPaymentTesting = lazy(() => import('./app/page/jagota/JagotaPaymentTesting'));
const ErpWebhookSimulator = lazy(() => import('./app/page/erp/ErpWebhookSimulator'));
const Billing = lazy(() => import('./app/page/CS/Billing'));
const AdminAccessQueue = lazy(() => import('./app/page/admin-access/AdminAccessQueue'));

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
            <Route path="marketing-links" element={<MarketingLinksPage />} />
            <Route path="marketing/queue" element={<MarketingQueueDashboard />} />
            <Route path="marketing/journey-funnel" element={<MarketingJourneyFunnel />} />
            <Route path="marketing/notify-templates" element={<MarketingNotifyTemplates />} />
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
            <Route path="invoices" element={<InvoicesOverdue />} />
            <Route path="credit-notes" element={<CreditNotesAdmin />} />
            <Route path="credit-backs" element={<CreditBacksAdmin />} />
            <Route path="credit-terms" element={<CreditTermsAdmin />} />
            <Route path="kyc" element={<KycQueue />} />
            <Route path="promotion-pages" element={<PromotionPageLibrary />} />
            <Route path="promotion-pages/create" element={<PromotionPageEditorPage />} />
            <Route path="promotion-pages/:id/edit" element={<PromotionPageEditorPage />} />
            <Route path="bot/intent-rules" element={<BotIntentRules />} />
            <Route path="bot/intent-rules/create" element={<CreateBotIntentRule />} />
            <Route path="bot/intent-rules/edit/:id" element={<EditBotIntentRule />} />
            <Route path="bot/workflows" element={<BotWorkflows />} />
            <Route path="bot/workflows/create" element={<CreateBotWorkflow />} />
            <Route path="bot/workflows/edit/:id" element={<EditBotWorkflow />} />
            <Route path="bot/templates" element={<BotTemplates />} />
            <Route path="bot/templates/create" element={<CreateBotTemplate />} />
            <Route path="bot/templates/edit/:id" element={<EditBotTemplate />} />
            <Route path="marketing/push-campaigns" element={<PushCampaignsPage />} />
            <Route path="company" element={<Company />} />
            <Route path="company/create" element={<CreateCompanyAdmin />} />
            <Route path="company/edit/:id" element={<CompanyEdit />} />
            <Route path="refunds" element={<RefundsAdmin />} />
            <Route path="segments" element={<SegmentList />} />
            <Route path="segments/create" element={<CreateSegment />} />
            <Route path="segments/edit/:id" element={<EditSegment />} />
            <Route path="segments/builder" element={<SegmentBuilder />} />
            <Route path="segments/builder/:id" element={<SegmentBuilder />} />
            <Route path="cs/sample-requests" element={<SampleRequestsAdmin />} />
            <Route path="cs/delivery-schedule" element={<DeliveryScheduleAdmin />} />
            <Route path="cs/cart-move-categories" element={<CartMoveCategoriesAdmin />} />
            <Route path="allproducts" element={<AllProduct />} />
            <Route path="product/create" element={<InsertProductForm />} />
            <Route path="product/video-upload" element={<ProductVideoUpload />} />
            <Route path="product/bulk-image-upload" element={<BulkImageUploadPage />} />
            <Route path="product/edit/:id" element={<EditProduct />} />
            <Route path="product/:id" element={<ProductDetail />} />
            <Route path="suppliers" element={<SupplierList />} />
            <Route path="supplier/create" element={<CreateSupplier />} />
            <Route path="supplier/edit/:id" element={<EditSupplier />} />
            <Route path="price-requests" element={<PriceRequestsAdmin />} />
            <Route path="active-offers" element={<ActiveOffersAdmin />} />
            <Route path="coupons" element={<CouponList />} />
            <Route path="coupon/create" element={<CreateCoupon />} />
            <Route path="coupon/:id" element={<CouponDetail />} />
            <Route path="promotion-product-sets" element={<PromotionProductSetList />} />
            <Route path="promotion-product-sets/create" element={<PromotionProductSetForm />} />
            <Route path="promotion-product-sets/:id/edit" element={<PromotionProductSetForm />} />
            <Route path="promotions-mechanic" element={<PromotionMechanic />} />
            <Route path="promotions-mechanic/create" element={<MechanicEditorPage />} />
            <Route path="promotions-mechanic/:id/edit" element={<MechanicEditorPage />} />
            <Route path="promotions/campaigns" element={<CampaignList />} />
            <Route path="promotions/campaigns/create" element={<CreateCampaign />} />
            <Route path="promotions/campaigns/:id" element={<CampaignDetail />} />
            <Route path="cs/notification-log" element={<NotificationLog />} />
            <Route path="cs/notification-stats" element={<NotificationDeliveryStats />} />
            <Route path="cs/notification-catalog" element={<NotificationCatalog />} />
            <Route path="cs/product-notify-funnel" element={<ProductNotifyFunnelPage />} />
            <Route path="jagota/payment-testing" element={<JagotaPaymentTesting />} />
            <Route path="erp/webhook-simulator" element={<ErpWebhookSimulator />} />
            <Route path="billing" element={<Billing />} />
            <Route path="admin-access" element={<AdminAccessQueue />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
    </QueryClientProvider>
  );
}
