import { apiClient } from '../api-client/api-client';

/** Mirrors apps/backend/src/entities/notification.entity.ts */
export type AdminNotification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  dedupe_key: string | null;
  read_at: string | null;
  created_at: string;
};

export type AdminNotificationPage = {
  items: AdminNotification[];
  nextCursor: string | null;
};

export type ProductNotifyChannelType = 'back_in_stock' | 'marketing_remind';
export type ProductNotifyFunnelStatus = 'active' | 'converted' | 'cancelled';

export type ProductNotifyFunnel = {
  id: string;
  user_id: string;
  product_inventory_id: string;
  channel_type: ProductNotifyChannelType;
  notify_count: number;
  status: ProductNotifyFunnelStatus;
  first_notified_at: string | null;
  last_notified_at: string | null;
  converted_at: string | null;
  converted_order_id: string | null;
};

export type ProductNotifyFunnelAggregate = {
  channel_type: ProductNotifyChannelType;
  converted_count: number;
  avg_notify_count: number;
};

export type ProductNotifyFunnelPage = {
  items: ProductNotifyFunnel[];
  nextCursor: string | null;
  aggregates: { byChannel: ProductNotifyFunnelAggregate[] };
};

export type ProductNotifyFunnelQuery = {
  channel_type?: ProductNotifyChannelType;
  userId?: string;
  productInventoryId?: string;
  status?: ProductNotifyFunnelStatus;
  cursor?: string;
  limit?: number;
};

/** GET /admin/notifications?userId=&cursor=&limit= — read-only support log (Task 11). */
export const getAdminNotifications = async (params: {
  userId: string;
  cursor?: string;
  limit?: number;
}) => {
  const searchParams = new URLSearchParams();
  searchParams.set('userId', params.userId);
  if (params.cursor) searchParams.set('cursor', params.cursor);
  if (params.limit) searchParams.set('limit', String(params.limit));
  return apiClient.get(`/admin/notifications?${searchParams.toString()}`);
};


export type NotificationDeliveryChannel = 'inapp' | 'push' | 'email';

/** Mirrors DeliveryStatsRow in apps/backend/src/app/notification/notification-delivery.service.ts */
export type NotificationDeliveryStatsRow = {
  type: string;
  channel: NotificationDeliveryChannel;
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  clicked: number;
  /** 0–1 คำนวณจาก backend แล้ว ไม่ต้องหารเอง */
  deliveryRate: number;
  clickRate: number;
};

export type NotificationDeliveryStats = {
  range: { from: string; to: string };
  totals: Omit<NotificationDeliveryStatsRow, 'type' | 'channel'>;
  byTypeChannel: NotificationDeliveryStatsRow[];
  byDay: { date: string; sent: number; failed: number; clicked: number }[];
  topSkipAndFailReasons: { reason: string; count: number }[];
};


export type NotificationCatalogItem = {
  type: string;
  category:
    | 'order_update'
    | 'back_in_stock'
    | 'order_round'
    | 'marketing'
    | 'winback'
    | 'account'
    | 'financial';
  /** ชื่อที่คนอ่านรู้เรื่อง ใช้แสดงแทน type */
  label: string;
  /** อะไรทำให้แจ้งเตือนนี้ถูกส่ง */
  trigger: string;
  /** ปิดแล้วลูกค้าจะไม่รู้เรื่องที่กระทบเงิน/ของที่สั่ง — UI ต้องเตือนก่อนปิด */
  critical: boolean;
  enabled: boolean;
  allowedChannels: NotificationDeliveryChannel[];
  /** true = เคยถูกแก้จากหน้าแอดมิน (ไม่ใช่ค่าเริ่มต้น) */
  customised: boolean;
};

/** GET /admin/notifications/catalog — ทุก type ที่ระบบส่งได้ + ค่าที่ตั้งไว้ */
export const getNotificationCatalog = async () =>
  apiClient.get<{ data: NotificationCatalogItem[] }>('/admin/notifications/catalog');

/** PUT /admin/notifications/catalog/:type — เปิด/ปิด หรือจำกัดช่องทาง */
export const updateNotificationTypeSetting = async (
  type: string,
  body: { enabled?: boolean; allowedChannels?: NotificationDeliveryChannel[] },
) =>
  apiClient.put<{ data: NotificationCatalogItem }>(
    `/admin/notifications/catalog/${encodeURIComponent(type)}`,
    body,
  );


export type NotificationDeliveryStatus = 'sent' | 'skipped' | 'failed';

/** หนึ่งแถว = หนึ่งความพยายามส่ง (แจ้งเตือน × ช่องทาง) */
export type NotificationDeliveryLogItem = {
  id: string;
  notificationId: string;
  userId: string;
  type: string;
  category: string;
  channel: NotificationDeliveryChannel;
  status: NotificationDeliveryStatus;
  /** ทำไมไม่ถึงผู้ใช้ — type_disabled | channel_not_allowed | preference_off | http_* | ... */
  reason: string | null;
  providerMessageId: string | null;
  linkTarget: string | null;
  sentAt: string;
  clickedAt: string | null;
  clickPlatform: string | null;
};

export type NotificationDeliveryLogPage = {
  items: NotificationDeliveryLogItem[];
  nextCursor: string | null;
};

export type NotificationDeliveryLogQuery = {
  userId?: string;
  type?: string;
  channel?: NotificationDeliveryChannel;
  status?: NotificationDeliveryStatus;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
};

/** GET /admin/notifications/deliveries — log ดิบทีละแถว (cursor pagination) */
export const getNotificationDeliveryLog = async (
  params: NotificationDeliveryLogQuery = {},
) => {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') searchParams.set(key, String(value));
  }
  const query = searchParams.toString();
  return apiClient.get<{ data: NotificationDeliveryLogPage }>(
    `/admin/notifications/deliveries${query ? `?${query}` : ''}`,
  );
};

/** GET /admin/notifications/stats — delivery + click analytics (ค่าเริ่มต้น 30 วันล่าสุด). */
export const getNotificationDeliveryStats = async (
  params: { from?: string; to?: string; type?: string; channel?: NotificationDeliveryChannel } = {},
) => {
  const searchParams = new URLSearchParams();
  if (params.from) searchParams.set('from', params.from);
  if (params.to) searchParams.set('to', params.to);
  if (params.type) searchParams.set('type', params.type);
  if (params.channel) searchParams.set('channel', params.channel);
  const query = searchParams.toString();
  return apiClient.get<{ data: NotificationDeliveryStats }>(
    `/admin/notifications/stats${query ? `?${query}` : ''}`,
  );
};

/** GET /admin/product-notify-funnel — read-only notify-to-order funnel analytics. */
export const getProductNotifyFunnel = async (params: ProductNotifyFunnelQuery = {}) => {
  const searchParams = new URLSearchParams();
  if (params.channel_type) searchParams.set('channel_type', params.channel_type);
  if (params.userId) searchParams.set('userId', params.userId);
  if (params.productInventoryId) searchParams.set('productInventoryId', params.productInventoryId);
  if (params.status) searchParams.set('status', params.status);
  if (params.cursor) searchParams.set('cursor', params.cursor);
  if (params.limit) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return apiClient.get<{ data: ProductNotifyFunnelPage }>(
    `/admin/product-notify-funnel${query ? `?${query}` : ''}`,
  );
};
