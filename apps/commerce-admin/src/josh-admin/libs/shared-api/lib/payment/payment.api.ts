import { apiClient } from '../api-client/api-client';

export type CreatePaymentPayload = {
  /** ว่างได้ถ้าส่ง checkoutToken */
  cartId?: string;
  /** จาก validate — หรือไม่ส่งก็ได้ถ้าส่ง cartId + branchId (payment จะ validate ให้) */
  checkoutToken?: string;
  /** ยอดจาก client — ถ้าไม่ตรง backend ใช้ยอด server */
  totalIncVat?: number;
  /**
   * `Qr` — Thai QR · `Card` — บัตร · `credit` — เครดิตบริษัท
   * `Card` ไม่มี `token` → mobile WebView (`paymentPageUrl`)
   */
  paymentMethod?: 'Qr' | 'Card' | 'credit' | 'qr' | 'card' | 'payment_link' | 'cod';
  /**
   * ออร์เดอร์ที่มีอยู่แล้ว — Pay จาก My Orders ส่งกับ `paymentMethod: Qr` หรือ `Card`
   * (ไม่ต้องมี cartId / checkoutToken). ไม่ส่ง = backend สร้างออร์เดอร์จากบริบทเช็คเอาต์
   * `Card` + `companyCardId` = ตัดบัตรที่บันทึกไว้ ไม่เปิด WebView
   */
  orderDocumentNo?: string;
  couponCode?: string;
  description?: string;
  /** ไม่ต้องส่ง — default `https://…/api/r/kbank-return` */
  returnAppUrl?: string;
  analyticsIndividualId?: string;
  analyticsSessionId?: string;
  analyticsPlatform?: 'web' | 'ios' | 'android';
  /** one-shot: ไม่มี checkoutToken → payment validate ให้ */
  userId?: string;
  branchId?: string;
  deliveryAddress?: string;
  timeSlotId?: string;
  deliveryDate?: string;
  shipmentDeliveries?: Array<{
    fulfillmentType: string;
    groupKey?: string;
    deliveryDate: string;
    timeSlotId: string;
  }>;
  poNumber?: string;
  remark?: string;
  /** One-time token จาก K-Inline UI (โหมดหลัก) */
  token?: string;
  /** บัตรบริษัทที่บันทึกไว้ — charge ทันที ไม่เปิด WebView */
  companyCardId?: string;
  saveCard?: boolean;
  /** งวดผ่อน Smart Pay — ลูกค้าออกดอก (0002). 3 | 4 | 6 | 10 */
  installmentTerm?: number;
  /** Direct API fullpan — ใช้ได้เมื่อ merchant เปิดโหมดนี้ */
  card?: {
    name: string;
    number: string;
    expMonth: string;
    expYear: string;
    cvv?: string;
  };
};

export type CreateChargeResponse = {
  status: 'SUCCESS';
  chargeId: string;
  amount: number;
  qrCodeUrl?: string;
  qrPayload?: string;
  redirectUrl?: string | null;
  transactionState?: string | null;
  needs3ds?: boolean;
  kbankChargeId?: string;
  linkRef?: string;
  linkUrl?: string;
  emailedTo?: string[];
  expireTime?: string;
  /**
   * `orders/batch` — customer_credit / cod ไม่สร้าง charge ให้ยิง orders/batch ต่อ
   * `order_success` — ยอด ฿0 ออร์เดอร์ PAID แล้ว ไม่ต้องเปิด QR / KBank ไปหน้าสั่งซื้อสำเร็จ
   */
  next?: 'orders/batch' | 'order_success';
  paymentMethod?: string;
  cartId?: string;
  totalIncVat?: number;
  /** Mobile Card (ไม่มี token) — เปิดใน WebView */
  paymentPageUrl?: string;
  returnAppUrl?: string;
  sessionToken?: string;
  sessionId?: string;
  expiresAt?: string;
  /** Qr / payment_link — วินาทีก่อนออเดอร์ pending นี้ถูก cron ยกเลิกอัตโนมัติ (ใช้นับถอยหลังหน้าเว็บ) */
  expiresInSeconds?: number;
  /** Qr (Jagota) — ใช้ยิง POST /orders/batch/{batchId}/cancel เมื่อลูกค้ากด Change payment method */
  batchId?: string;
  /**
   * ยอด ฿0 (ส่วนลดครอบทั้งตะกร้า): `next: 'order_success'` + ออร์เดอร์ PAID แล้ว —
   * `paymentPending: false`, `chargeId: null`, ไม่มี QR / หน้าบัตร
   */
  paymentPending?: boolean;
  orderIds?: string[];
  orderNumbers?: string[];
  documentNo?: string | null;
};

/** เส้นเดียวเริ่มจ่าย — `POST /payment` (create-charge ยังใช้ได้) */
export const createPayment = async (
  data: CreatePaymentPayload,
): Promise<{ data: CreateChargeResponse }> => {
  const response = await apiClient.post(`/payment`, data);
  return response;
};

/** @deprecated ใช้ `createPayment` → `POST /payment` */
export const createCharge = async (
  data: CreatePaymentPayload,
): Promise<{ data: CreateChargeResponse }> => {
  const response = await apiClient.post(`/payment/create-charge`, data);
  return response;
};

export type KbankClientConfig = {
  apiKey: string;
  merchantId: string | null;
  scriptUrl: string;
  /** 0002 = ลูกค้าออกดอก — null ถ้ายังไม่ได้ตั้ง KBANK_SMARTPAY_MID */
  smartpayId?: string | null;
  smartpayMid?: string | null;
  smartpayTerms?: number[];
};

export const getKbankClientConfig = async (): Promise<KbankClientConfig> => {
  const response = await apiClient.get('/payment/kbank/client-config');
  return response.data as KbankClientConfig;
};

export const createPaymentIntent = async (data: {
  totalIncVat: number;
  userId: string;
  userEmail?: string;
}): Promise<{
  paymentIntent: string;
  customerSessionClientSecret: string;
  customer: string;
}> => {
  const response = await apiClient.post('/payment/create-payment-intent', data);
  return response.data;
};

export type SavedCard = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export const getSavedCards = async (userId: string): Promise<{
  success: boolean;
  savedCards: SavedCard[];
}> => {
  const response = await apiClient.post('/payment/saved-cards', { userId });
  return response.data;
};

export type CompanyPaymentCard = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  label: string | null;
  isActive: boolean;
  branchIds: string[];
  branches: Array<{
    id: string;
    name: string;
    shopId: string;
    shopName: string | null;
  }>;
};

export type CompanyCardBranchOption = {
  branchId: string;
  branchName: string;
};

export type CompanyCardShopBranchOptions = {
  shopId: string;
  shopName: string | null;
  branches: CompanyCardBranchOption[];
};

export type CompanyCardBranchOptionsResponse = {
  shops: CompanyCardShopBranchOptions[];
};

export type RegisterCompanyCardResult =
  | { status: 'registered'; card: CompanyPaymentCard }
  | { status: 'needs3ds'; redirectUrl: string; chargeId: string };

type ApiEnvelope<T> = {
  status: boolean;
  statusCode: number;
  message: string;
  data: T;
};

export type PaymentReference = {
  role: string;
  cardScope: 'all_branches' | 'own';
  hasCreditTerm: boolean;
  creditTermDays: number;
  creditLimit: number;
  creditUsed: number;
  creditAvailable: number;
  /** Saved company cards visible to this role — not a gate for offering `credit` */
  hasCreditCard: boolean;
  cards: CompanyPaymentCard[];
  /** Methods checkout must offer. Always includes `qr` + `credit`. */
  availablePaymentMethods: Array<'qr' | 'credit' | 'customer_credit'>;
  /**
   * Saved preference, or `null` when the customer has never chosen
   * (first payment — client must not pre-select QR/credit).
   */
  defaultMethod: 'customer_credit' | 'credit' | 'qr' | null;
  /**
   * Card to pre-select when method is `credit` — the pinned card
   * (`updatePaymentReference({ defaultCompanyCardId })`) when still visible,
   * else the most recently added one. Same id POST /payment uses when
   * `companyCardId` is omitted. `null` when `cards` is empty.
   */
  defaultCompanyCardId: string | null;
  canAddCard: boolean;
};

export const getPaymentReference = async () => {
  const response = await apiClient.get<ApiEnvelope<PaymentReference>>(
    '/payment/reference',
  );
  return response.data;
};

export const updatePaymentReference = async (body: {
  defaultMethod?: 'customer_credit' | 'credit' | 'qr';
  /** Pin a specific company card as default; `null` clears the pin. */
  defaultCompanyCardId?: string | null;
}) => {
  const response = await apiClient.patch<ApiEnvelope<PaymentReference>>(
    '/payment/reference',
    body,
  );
  return response.data;
};

export const listCompanyPaymentCards = async (): Promise<
  ApiEnvelope<CompanyPaymentCard[]>
> => {
  const response = await apiClient.get<ApiEnvelope<CompanyPaymentCard[]>>(
    '/payment/company-cards',
  );
  return response.data;
};

export const getCompanyPaymentCardBranchOptions = async (): Promise<
  ApiEnvelope<CompanyCardBranchOptionsResponse>
> => {
  const response = await apiClient.get<
    ApiEnvelope<CompanyCardBranchOptionsResponse>
  >('/payment/company-cards/branch-options');
  return response.data;
};

export const listCompanyPaymentCardsForBranch = async (
  branchId: string,
): Promise<ApiEnvelope<CompanyPaymentCard[]>> => {
  const response = await apiClient.get<ApiEnvelope<CompanyPaymentCard[]>>(
    '/payment/company-cards/for-branch',
    { params: { branchId } },
  );
  return response.data;
};

export const registerCompanyPaymentCard = async (payload: {
  token: string;
  mid?: string;
  label?: string;
  email?: string;
  name?: string;
  branchIds?: string[];
}): Promise<ApiEnvelope<RegisterCompanyCardResult>> => {
  const response = await apiClient.post<ApiEnvelope<RegisterCompanyCardResult>>(
    '/payment/company-cards/register-session',
    payload,
  );
  return response.data;
};

export const assignCompanyPaymentCardBranches = async (
  cardId: string,
  branchIds: string[],
): Promise<ApiEnvelope<CompanyPaymentCard>> => {
  const response = await apiClient.post<ApiEnvelope<CompanyPaymentCard>>(
    `/payment/company-cards/${cardId}/branches`,
    { branchIds },
  );
  return response.data;
};

export const deleteCompanyPaymentCard = async (
  cardId: string,
): Promise<ApiEnvelope<{ id: string }>> => {
  const response = await apiClient.delete<ApiEnvelope<{ id: string }>>(
    `/payment/company-cards/${cardId}`,
  );
  return response.data;
};

export const chargeCompanyPaymentCard = async (
  cardId: string,
  payload: {
    amount: number;
    currency?: string;
    description: string;
    referenceOrder: string;
    /**
     * The cart being paid. Send it on a charge made BEFORE the order exists (the client calls
     * POST /orders/batch afterwards): the server then checks the cart for a sold-out flash sale first
     * (400 `promotion_sold_out`) and writes the pending payment row the order adopts.
     */
    cartId?: string;
  },
): Promise<
  ApiEnvelope<{
    chargeId: string;
    status: string | null;
    transactionState: string | null;
    redirectUrl: string | null;
    referenceOrder: string;
  }>
> => {
  const response = await apiClient.post(
    `/payment/company-cards/${cardId}/charge`,
    payload,
  );
  return response.data;
};

/** Mobile WebView — สร้าง session + URL หน้าจ่ายบัตร */
export type CreateMobileCreditSessionPayload = {
  /** จาก POST /checkout/validate เมื่อ valid — แนะนำใช้แบบนี้ */
  checkoutToken?: string;
  cartId?: string;
  /** ถ้าส่ง ต้องตรงกับยอดที่ backend คิด — ไม่ใช่ยอดตัดเงิน */
  totalIncVat?: number;
  branchId?: string;
  deliveryAddress?: string;
  timeSlotId?: string;
  deliveryDate?: string;
  shipmentDeliveries?: Array<{
    fulfillmentType: string;
    groupKey?: string;
    deliveryDate: string;
    timeSlotId: string;
  }>;
  couponCode?: string;
  poNumber?: string;
  remark?: string;
  analyticsIndividualId?: string;
  analyticsSessionId?: string;
  analyticsPlatform?: 'ios' | 'android';
  /** ไม่ต้องส่ง — ว่าง / custom scheme = `https://…/api/r/kbank-return` */
  returnAppUrl?: string;
  description?: string;
};

export type MobileCreditSessionResponse = {
  status: 'SUCCESS';
  sessionId: string;
  sessionToken: string;
  paymentPageUrl: string;
  returnAppUrl: string;
  expiresAt: string;
  totalIncVat: number;
};

export type MobileCreditSessionPublic = {
  status: 'SUCCESS';
  sessionId: string;
  cartId: string;
  totalIncVat: number;
  returnAppUrl: string;
  expiresAt: string;
};

export type PayMobileCreditSessionResult = {
  status: 'SUCCESS';
  chargeId: string;
  totalIncVat: number;
  redirectUrl: string | null;
  needs3ds: boolean;
  transactionState: string | null;
  kbankChargeId?: string;
  returnAppUrl: string;
  orderIds: string[];
  orderNumbers: string[];
  batchId?: string;
  paymentPending: boolean;
};

export const createMobileCreditSession = async (
  data: CreateMobileCreditSessionPayload,
): Promise<{ data: MobileCreditSessionResponse }> => {
  const response = await apiClient.post(
    '/payment/mobile/credit-session',
    data,
  );
  return response;
};

export const getMobileCreditSession = async (
  sessionToken: string,
): Promise<MobileCreditSessionPublic> => {
  const response = await apiClient.get('/payment/mobile/credit-session', {
    params: { session: sessionToken },
  });
  return response.data as MobileCreditSessionPublic;
};

// ===== Mobile add-card WebView session (ลงทะเบียนบัตรบริษัท ไม่มีการตัดเงิน) =====

export type MobileCardSessionResponse = {
  status: 'SUCCESS';
  sessionId: string;
  sessionToken: string;
  addCardPageUrl: string;
  returnAppUrl: string;
  expiresAt: string;
};

export type MobileCardSessionPublic = {
  status: 'SUCCESS';
  sessionId: string;
  returnAppUrl: string;
  expiresAt: string;
};

export type RegisterMobileCardSessionResult = (
  | { status: 'registered'; card: { id: string; label: string | null } }
  | { status: 'needs3ds'; redirectUrl: string; chargeId: string }
) & { returnAppUrl: string };

/** แอปเรียก (ต้อง login, super_admin) — ได้ URL เปิด WebView เพิ่มบัตร */
export const createMobileCardSession = async (data?: {
  returnAppUrl?: string;
}): Promise<MobileCardSessionResponse> => {
  const response = await apiClient.post('/payment/mobile/card-session', data ?? {});
  return response.data as MobileCardSessionResponse;
};

/** หน้า WebView เรียก (public, ใช้ session token) */
export const getMobileCardSession = async (
  sessionToken: string,
): Promise<MobileCardSessionPublic> => {
  const response = await apiClient.get('/payment/mobile/card-session', {
    params: { session: sessionToken },
  });
  return response.data as MobileCardSessionPublic;
};

/** หน้า WebView เรียกหลังได้ K-Inline token (public, ใช้ session token) */
export const registerMobileCardSession = async (data: {
  sessionToken: string;
  token: string;
  mid?: string;
  label?: string;
}): Promise<RegisterMobileCardSessionResult> => {
  const response = await apiClient.post(
    '/payment/mobile/card-session/register',
    data,
  );
  return response.data as RegisterMobileCardSessionResult;
};

export const payMobileCreditSession = async (data: {
  sessionToken: string;
  token: string;
  saveCard?: boolean;
  installmentTerm?: number;
}): Promise<PayMobileCreditSessionResult> => {
  const response = await apiClient.post(
    '/payment/mobile/credit-session/pay',
    data,
  );
  return response.data as PayMobileCreditSessionResult;
};
