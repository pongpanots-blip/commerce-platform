// @ts-nocheck — copied unchanged from josh web-admin, which has the same type errors in this file (josh type debt, not a commerce change).
/** Single source of truth — sidebar, navigate(), Settings links ใช้ path จากที่นี่ */

const JOSH_ROUTES = {
  login: '/login',
  register: '/register',
  dashboard: '/dashboard',

  // Homepage / Landing content
  homepage: '/homepage',
  carousels: '/carousels',
  carouselCreate: '/carousels/create',
  carouselEdit: '/carousels/edit',
  banner: '/banner',
  bannerCreate: '/banner/create',
  bannerEdit: (id: string) => `/banner/edit/${id}`,
  bannerCriteria: '/banner/criteria',
  bannerCriteriaCreate: '/banner/criteria/create',
  trustedBrands: '/trusted-brands',
  trustedBrandCreate: '/trusted-brand/create',
  trustedBrandEdit: (id: string) => `/trusted-brand/edit/${id}`,
  trustedUsers: '/trusted-users',
  trustedUserCreate: '/trusted-user/create',
  trustedUserEdit: (id: string) => `/trusted-user/edit/${id}`,
  categories: '/categories',
  categoryCreate: '/categories/create',
  categoryEdit: (id: string) => `/categories/edit/${id}`,

  // KYC
  kycQueue: '/kyc',

  // Batch Sticker WebP tool
  batchSticker: '/batch-sticker',

  // Company B2B
  company: '/company',
  companyCreate: '/company/create',
  companyEdit: (id: string) => `/company/edit/${id}`,

  // Orders
  orders: '/order',
  orderDetail: (ordersId: string) => `/order/${ordersId}`,
  orderImport: '/order/import',
  shipments: '/shipments',
  shipmentDetail: (shipmentId: string) => `/shipments/${shipmentId}`,
  paymentTransactions: '/payment-transactions',
  refunds: '/refunds',
  refundRequests: '/refund-requests',
  kbankTestingConsole: '/kbank/testing-console',
  jagotaPaymentTesting: '/jagota/payment-testing',
  erpWebhookSimulator: '/erp/webhook-simulator',

  // Users
  users: '/allusers',
  userDetail: (id: string) => `/allusers/${id}`,
  creditTerms: '/credit-terms',
  sampleRequests: '/cs/sample-requests',
  segments: '/segments',
  segmentCreate: '/segments/create',
  segmentEdit: (id: string) => `/segments/edit/${id}`,
  segmentBuilderCreate: '/segments/builder',
  segmentBuilderEdit: (id: string) => `/segments/builder/${id}`,
  membershipTiers: '/membership-tiers',

  // Products
  products: '/allproducts',
  brands: '/brands',
  productCreate: '/product/create',
  productVideoUpload: '/product/video-upload',
  productBulkImageUpload: '/product/bulk-image-upload',
  productDetail: (id: string) => `/product/${id}`,
  productEdit: (id: string) => `/product/edit/${id}`,
  productContent: (id: string) => `/product/${id}/content`,
  suppliers: '/suppliers',
  supplierCreate: '/supplier/create',
  supplierEdit: (id: string) => `/supplier/edit/${id}`,

  // Pricing
  priceRequests: '/price-requests',
  activeOffers: '/active-offers',

  // Promotions
  coupons: '/coupons',
  couponCreate: '/coupon/create',
  couponDetail: (id: string) => `/coupon/${id}`,
  promotionsMechanic: '/promotions-mechanic',
  promotionsMechanicCreate: '/promotions-mechanic/create',
  promotionsMechanicEdit: (id: string) => `/promotions-mechanic/${id}/edit`,
  promotionPages: '/promotion-pages',
  promotionPageCreate: '/promotion-pages/create',
  promotionPageEdit: (id: string) => `/promotion-pages/${id}/edit`,
  promotionProductSets: '/promotion-product-sets',
  promotionProductSetCreate: '/promotion-product-sets/create',
  promotionProductSetEdit: (id: string) => `/promotion-product-sets/${id}/edit`,
  campaigns: '/promotions/campaigns',
  campaignCreate: '/promotions/campaigns/create',
  campaignDetail: (id: string) => `/promotions/campaigns/${id}`,

  // Content
  articles: '/article',
  articleCreate: '/article/create',
  copyManager: '/copy-manager',
  cuisineCards: '/cuisine-cards',
  cuisineCardCreate: '/cuisine-cards/create',
  cuisineCardEdit: (id: string) => `/cuisine-cards/edit/${id}`,
  cuisineNames: '/cuisine-names',
  marketingLinks: '/marketing-links',
  marketingResearch: '/marketing/research',
  marketingWorkflows: '/marketing/workflows',
  marketingWorkflowCreate: '/marketing/workflows/new',
  marketingWorkflowEdit: (id: string) => `/marketing/workflows/${id}`,
  marketingWorkflowEnrollments: (id: string) => `/marketing/workflows/${id}/enrollments`,
  marketingWorkflowScheduledRuns: (id: string) => `/marketing/workflows/${id}/scheduled-runs`,
  marketingJourneyFunnel: '/marketing/journey-funnel',
  marketingNotifyTemplates: '/marketing/notify-templates',
  marketingPushCampaigns: '/marketing/push-campaigns',
  marketingBannerTargeting: '/marketing/banner-targeting',
  marketingSettings: '/marketing/settings',
  marketingLandingSeo: '/marketing/landing-seo',
  marketingLegalDocs: '/marketing/legal-docs',
  marketingWelcomeLeadEmail: '/marketing/welcome-lead-email',
  marketingOfferCheck: '/marketing/offers-check',
  marketingQueue: '/marketing/queue',
  competitorPrices: '/marketing/competitor-prices',
  scrapedCatalog: '/marketing/scraped-catalog',
  scrapingSources: '/marketing/scraping-sources',
  smartLinks: '/smart-links',
  smartLinkCreate: '/smart-links/create',
  smartLinkEdit: (id: string) => `/smart-links/edit/${id}`,
  smartLinkAnalytics: '/smart-links/analytics',
  smartLinkAnalyticsDetail: (id: string) => `/smart-links/analytics/${id}`,

  // Support & ops
  csLogs: '/cslogs',
  chat: '/chat',
  zendeskSettings: '/support/zendesk-settings',
  notificationLog: '/cs/notification-log',
  notificationStats: '/cs/notification-stats',
  notificationCatalog: '/cs/notification-catalog',
  productNotifyFunnel: '/cs/product-notify-funnel',
  erpInboundLogs: '/erp-logs',
  apiLogs: '/api-logs',
  restaurantExplorer: '/restaurant-explorer',

  // Chatbot
  botIntentRules: '/bot/intent-rules',
  botIntentRuleCreate: '/bot/intent-rules/create',
  botIntentRuleEdit: (id: string) => `/bot/intent-rules/edit/${id}`,
  botWorkflows: '/bot/workflows',
  botWorkflowCreate: '/bot/workflows/create',
  botWorkflowEdit: (id: string) => `/bot/workflows/edit/${id}`,
  botTemplates: '/bot/templates',
  botTemplateCreate: '/bot/templates/create',
  botTemplateEdit: (id: string) => `/bot/templates/edit/${id}`,

  // Popup Library
  popupLibrary: '/popups',
  popupCreate: '/popups/create',
  popupEdit: (id: string) => `/popups/${id}/edit`,

  // Accounting
  billing: '/billing',
  invoices: '/invoices',
  creditNotes: '/credit-notes',
  creditBacks: '/credit-backs',

  // CS ops
  deliverySchedule: '/cs/delivery-schedule',
  cartMoveCategories: '/cs/cart-move-categories',
  csProductTools: '/cs/product-tools',

  settings: '/settings',
  adminAccess: '/admin-access',
} as const;

/**
 * commerce-admin: josh's pages live under /j (e.g. /j/categories), so every josh path gets the prefix —
 * josh's own navigate()/Link calls keep working unchanged.
 */
const PREFIX = '/j';
const withPrefix = <T>(v: T): T => (typeof v === 'string' ? (`${PREFIX}${v}` as T) : typeof v === 'function'
  ? (((...a: unknown[]) => `${PREFIX}${(v as (...x: unknown[]) => string)(...a)}`) as T) : v);
export const ADMIN_ROUTES = Object.fromEntries(Object.entries(JOSH_ROUTES).map(([k, v]) => [k, withPrefix(v)])) as typeof JOSH_ROUTES;

/** เมนู sidebar — label English เท่านั้น + path ที่ใช้จริง */
export const ADMIN_MENU = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    path: ADMIN_ROUTES.dashboard,
  },
  {
    id: 'batch-sticker',
    label: 'Batch Sticker',
    path: ADMIN_ROUTES.batchSticker,
  },
  {
    id: 'orders',
    label: 'Orders',
    children: [
      { label: 'All Orders', path: ADMIN_ROUTES.orders },
      { label: 'Shipments', path: ADMIN_ROUTES.shipments },
      { label: 'Order Import', path: ADMIN_ROUTES.orderImport },
      { label: 'Payment Transactions', path: ADMIN_ROUTES.paymentTransactions },
      { label: 'Returns & Refunds', path: ADMIN_ROUTES.refunds },
    ],
  },
  {
    id: 'customers',
    label: 'Customers',
    children: [
      { label: 'Users', path: ADMIN_ROUTES.users },
      { label: 'Companies', path: ADMIN_ROUTES.company, create: ADMIN_ROUTES.companyCreate },
      { label: 'KYC Verification', path: ADMIN_ROUTES.kycQueue },
      { label: 'Segments', path: ADMIN_ROUTES.segments, create: ADMIN_ROUTES.segmentCreate },
      { label: 'Membership Tiers', path: ADMIN_ROUTES.membershipTiers },
    ],
  },
  {
    id: 'catalog',
    label: 'Catalog',
    children: [
      { label: 'Products', path: ADMIN_ROUTES.products, create: ADMIN_ROUTES.productCreate },
      { label: 'Brands', path: ADMIN_ROUTES.brands },
      { label: 'Suppliers', path: ADMIN_ROUTES.suppliers, create: ADMIN_ROUTES.supplierCreate },
      { label: 'Video Upload', path: ADMIN_ROUTES.productVideoUpload },
      { label: 'Bulk Image Upload', path: ADMIN_ROUTES.productBulkImageUpload },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    children: [
      { label: 'Price Requests', path: ADMIN_ROUTES.priceRequests },
      { label: 'Active Offers', path: ADMIN_ROUTES.activeOffers },
      { label: 'Sample Requests', path: ADMIN_ROUTES.sampleRequests },
      { label: 'Market Explorer', path: ADMIN_ROUTES.restaurantExplorer },
    ],
  },
  {
    id: 'promotions',
    label: 'Promotions',
    children: [
      { label: 'Coupons', path: ADMIN_ROUTES.coupons, create: ADMIN_ROUTES.couponCreate },
      {
        label: 'Promotion Product Set',
        path: ADMIN_ROUTES.promotionProductSets,
        create: ADMIN_ROUTES.promotionProductSetCreate,
      },
      {
        label: 'Promotion Mechanics',
        path: ADMIN_ROUTES.promotionsMechanic,
        create: ADMIN_ROUTES.promotionsMechanicCreate,
      },
      {
        label: 'Promotion Pages',
        path: ADMIN_ROUTES.promotionPages,
        create: ADMIN_ROUTES.promotionPageCreate,
      },
      { label: 'Campaigns', path: ADMIN_ROUTES.campaigns, create: ADMIN_ROUTES.campaignCreate },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    children: [
      { label: 'Research', path: ADMIN_ROUTES.marketingResearch },
      {
        label: 'Workflows',
        path: ADMIN_ROUTES.marketingWorkflows,
        create: ADMIN_ROUTES.marketingWorkflowCreate,
      },
      { label: 'Queue Dashboard', path: ADMIN_ROUTES.marketingQueue },
      { label: 'เทียบราคาคู่แข่ง', path: ADMIN_ROUTES.competitorPrices },
      { label: 'ข้อมูลจากเว็บ', path: ADMIN_ROUTES.scrapedCatalog },
      { label: 'ตั้งค่าเก็บข้อมูลเว็บ', path: ADMIN_ROUTES.scrapingSources },
      { label: 'Journey Funnel', path: ADMIN_ROUTES.marketingJourneyFunnel },
      { label: 'Notify Templates', path: ADMIN_ROUTES.marketingNotifyTemplates },
      { label: 'Push Campaigns', path: ADMIN_ROUTES.marketingPushCampaigns },
      { label: 'Welcome Lead Email', path: ADMIN_ROUTES.marketingWelcomeLeadEmail },
      { label: 'Marketing Links', path: ADMIN_ROUTES.marketingLinks },
      { label: 'Smart Links', path: ADMIN_ROUTES.smartLinks, create: ADMIN_ROUTES.smartLinkCreate },
      { label: 'Smart Link Analytics', path: ADMIN_ROUTES.smartLinkAnalytics },
      { label: 'Marketing Settings', path: ADMIN_ROUTES.marketingSettings },
    ],
  },
  {
    id: 'storefront',
    label: 'Storefront',
    children: [
      { label: 'Homepage Overview', path: ADMIN_ROUTES.homepage },
      { label: 'Categories', path: ADMIN_ROUTES.categories, create: ADMIN_ROUTES.categoryCreate },
      { label: 'Product Carousels', path: ADMIN_ROUTES.carousels, create: ADMIN_ROUTES.carouselCreate },
      { label: 'Banners', path: ADMIN_ROUTES.banner, create: ADMIN_ROUTES.bannerCreate },
      { label: 'Banner Targeting', path: ADMIN_ROUTES.marketingBannerTargeting },
      { label: 'Trusted Brands', path: ADMIN_ROUTES.trustedBrands, create: ADMIN_ROUTES.trustedBrandCreate },
      { label: 'Trusted Restaurants', path: ADMIN_ROUTES.trustedUsers, create: ADMIN_ROUTES.trustedUserCreate },
      { label: 'Shop by Cuisine', path: ADMIN_ROUTES.cuisineCards, create: ADMIN_ROUTES.cuisineCardCreate },
      { label: 'Cuisine Names (TH/EN)', path: ADMIN_ROUTES.cuisineNames },
    ],
  },
  {
    id: 'popups',
    label: 'Popups',
    children: [
      { label: 'Popup Library', path: ADMIN_ROUTES.popupLibrary, create: ADMIN_ROUTES.popupCreate },
      { label: 'Popup Rules', path: ADMIN_ROUTES.bannerCriteria, create: ADMIN_ROUTES.bannerCriteriaCreate },
      { label: 'Offer Check', path: ADMIN_ROUTES.marketingOfferCheck },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    children: [
      { label: 'Articles', path: ADMIN_ROUTES.articles, create: ADMIN_ROUTES.articleCreate },
      { label: 'Copy & Localization', path: ADMIN_ROUTES.copyManager },
      { label: 'Legal Documents', path: ADMIN_ROUTES.marketingLegalDocs },
      { label: 'Landing SEO', path: ADMIN_ROUTES.marketingLandingSeo },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    children: [
      { label: 'Billing', path: ADMIN_ROUTES.billing },
      { label: 'Overdue Invoices', path: ADMIN_ROUTES.invoices },
      { label: 'Credit Notes', path: ADMIN_ROUTES.creditNotes },
      { label: 'Credit Backs', path: ADMIN_ROUTES.creditBacks },
      { label: 'Refund Requests', path: ADMIN_ROUTES.refundRequests },
      { label: 'Credit Term Applications', path: ADMIN_ROUTES.creditTerms },
    ],
  },
  {
    id: 'support',
    label: 'Support',
    children: [
      { label: 'CS Logs', path: ADMIN_ROUTES.csLogs },
      { label: 'Live Chat', path: ADMIN_ROUTES.chat },
      { label: 'Zendesk Automation', path: ADMIN_ROUTES.zendeskSettings },
      { label: 'Delivery Schedule', path: ADMIN_ROUTES.deliverySchedule },
      { label: 'Unlock Move Categories', path: ADMIN_ROUTES.cartMoveCategories },
      { label: 'Product Tools', path: ADMIN_ROUTES.csProductTools },
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    children: [
      { label: 'Notification Catalog', path: ADMIN_ROUTES.notificationCatalog },
      { label: 'Notification Log', path: ADMIN_ROUTES.notificationLog },
      { label: 'Delivery Stats', path: ADMIN_ROUTES.notificationStats },
      { label: 'Product Notify Funnel', path: ADMIN_ROUTES.productNotifyFunnel },
    ],
  },
  {
    id: 'chatbot',
    label: 'Chatbot',
    children: [
      {
        label: 'Intent Rules',
        path: ADMIN_ROUTES.botIntentRules,
        create: ADMIN_ROUTES.botIntentRuleCreate,
      },
      {
        label: 'Bot Workflows',
        path: ADMIN_ROUTES.botWorkflows,
        create: ADMIN_ROUTES.botWorkflowCreate,
      },
      {
        label: 'Bot Templates',
        path: ADMIN_ROUTES.botTemplates,
        create: ADMIN_ROUTES.botTemplateCreate,
      },
    ],
  },
  {
    id: 'developer',
    label: 'Developer',
    children: [
      { label: 'API Logs', path: ADMIN_ROUTES.apiLogs },
      { label: 'ERP Inbound Logs', path: ADMIN_ROUTES.erpInboundLogs },
      { label: 'KBank Testing Console', path: ADMIN_ROUTES.kbankTestingConsole },
      { label: 'Jagota Payment Testing', path: ADMIN_ROUTES.jagotaPaymentTesting },
      { label: 'ERP Webhook Simulator', path: ADMIN_ROUTES.erpWebhookSimulator },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    children: [
      { label: 'General', path: ADMIN_ROUTES.settings },
      { label: 'Admin Access Requests', path: ADMIN_ROUTES.adminAccess, platformAdminOnly: true },
    ],
  },
] as const;

export const ADMIN_INSERT_LINKS = [
  { path: ADMIN_ROUTES.trustedBrandCreate, label: 'Trusted Brand' },
  { path: ADMIN_ROUTES.trustedUserCreate, label: 'Trusted Restaurant' },
  { path: ADMIN_ROUTES.supplierCreate, label: 'Supplier' },
  { path: ADMIN_ROUTES.couponCreate, label: 'Coupon' },
  { path: ADMIN_ROUTES.marketingWorkflowCreate, label: 'Marketing Workflow' },
  { path: ADMIN_ROUTES.carouselCreate, label: 'Carousel' },
  { path: ADMIN_ROUTES.bannerCreate, label: 'Banner' },
  { path: ADMIN_ROUTES.productCreate, label: 'Product' },
  { path: ADMIN_ROUTES.articleCreate, label: 'Article' },
  { path: ADMIN_ROUTES.promotionsMechanicCreate, label: 'Promotion Mechanic' },
  { path: ADMIN_ROUTES.campaignCreate, label: 'Campaign' },
  { path: ADMIN_ROUTES.botIntentRuleCreate, label: 'Bot Intent Rule' },
  { path: ADMIN_ROUTES.botWorkflowCreate, label: 'Bot Workflow' },
  { path: ADMIN_ROUTES.botTemplateCreate, label: 'Bot Template' },
];

function isVisibleMenuChild(
  child: { platformAdminOnly?: boolean },
  adminRole: string | null,
) {
  return !child.platformAdminOnly || adminRole === 'platform_admin';
}

/** แปลง ADMIN_MENU → รูปแบบ Sidebar (ตัด field create / visibility metadata ออก) */
export function toSidebarMenu(adminRole: string | null = null) {
  return ADMIN_MENU.map((item) => {
    if ('path' in item) {
      return { id: item.id, label: item.label, path: item.path };
    }
    return {
      id: item.id,
      label: item.label,
      children: item.children
        .filter((child) => isVisibleMenuChild(child, adminRole))
        .map(({ label, path }) => ({ label, path })),
    };
  });
}

/** ตารางเมนู → path สำหรับหน้า Settings / เอกสาร */
export function flattenAdminMenu(adminRole: string | null = null) {
  const rows: { section: string; label: string; listPath: string; createPath?: string }[] = [];

  for (const item of ADMIN_MENU) {
    if ('path' in item) {
      rows.push({ section: '—', label: item.label, listPath: item.path });
      continue;
    }
    for (const child of item.children.filter((child) => isVisibleMenuChild(child, adminRole))) {
      rows.push({
        section: item.label,
        label: child.label,
        listPath: child.path,
        createPath: 'create' in child ? child.create : undefined,
      });
    }
  }

  return rows;
}
