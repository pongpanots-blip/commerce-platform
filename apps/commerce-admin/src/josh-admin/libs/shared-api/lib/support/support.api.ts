import { apiClient } from '../api-client/api-client';

export type ZendeskTicketSummary = {
  id: number;
  subject: string;
  status: string;
  priority: string | null;
  created_at: string;
  updated_at: string;
  url: string;
  tags: string[];
};

export type ZendeskHelpArticle = {
  id: number;
  title: string;
  body: string;
  html_url: string;
  snippet: string;
  locale: string;
};

export type SupportAnalytics = {
  open_cases: number;
  in_progress: number;
  no_answer: number;
  resolved_today: number;
  avg_first_response_minutes: number | null;
  avg_resolution_hours: number | null;
  satisfaction_score: number | null;
  reopened_tickets?: number;
  faq_deflection_rate?: number | null;
  tickets_by_department?: Record<string, number>;
  escalations_open?: number;
};

export type OrderStatusForChat = {
  order_number: string;
  orders_id: string;
  status: string;
  raw_status: string;
  order_date: string;
  delivery_slot: string;
  branch: string;
  total_price: number;
  eta_text: string;
};

export type CustomerSupportContext = {
  user_id: string | null;
  email: string | null;
  customer_code: string | null;
  customer_group: string | null;
  company_name: string | null;
  last_order_date: string | null;
  recent_orders: Array<{
    order_number: string;
    status: string;
    date: string;
  }>;
  open_tickets: ZendeskTicketSummary[];
};

export type CustomerTimelineEvent = {
  id: string;
  type: 'order' | 'ticket' | 'chat';
  title: string;
  subtitle?: string;
  status?: string;
  occurred_at: string;
  url?: string;
};

export type CustomerChatContext = {
  email?: string;
  firstName?: string;
  lastName?: string;
  companyId?: string;
  companyName?: string;
  branchId?: string;
  branchName?: string;
  lineUserId?: string;
  deviceId?: string;
  deviceFingerprint?: string;
};

export type ChatMessage = {
  id: string;
  text: string;
  isMe: boolean;
  time: string;
  type?: 'text' | 'options' | 'orders' | 'articles';
};

export const getHelpCenterMeta = async () => {
  const response = await apiClient.get('/support/help-center');
  return response.data;
};

export const searchHelpArticles = async (query?: string, locale = 'en-us') => {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  params.set('locale', locale);
  const response = await apiClient.get(`/support/help/articles?${params}`);
  return response.data;
};

export const getMySupportTickets = async () => {
  const response = await apiClient.get('/support/tickets/my');
  return response.data;
};

export const getSupportTicket = async (ticketId: number) => {
  const response = await apiClient.get(`/support/tickets/${ticketId}`);
  return response.data;
};

export const getCustomerTimeline = async (smoochUserId?: string) => {
  const params = smoochUserId
    ? `?smoochUserId=${encodeURIComponent(smoochUserId)}`
    : '';
  const response = await apiClient.get(`/support/timeline${params}`);
  return response.data;
};

export const submitSupportClaim = async (payload: {
  orderId: string;
  claimItems: Array<{ sku: string; name: string; claimQty: number }>;
  reason: string;
  note?: string;
  customerName?: string;
  email?: string;
  userId?: string;
  context?: CustomerChatContext;
}) => {
  const response = await apiClient.post('/support/claim', payload);
  return response.data;
};

export const sendLiveChatMessage = async (payload: {
  userId: string;
  text: string;
  context?: CustomerChatContext;
}) => {
  const response = await apiClient.post('/support/livechat', payload);
  return response.data;
};

export const getLiveChatHistory = async (userId: string) => {
  const response = await apiClient.get(`/support/chat-history/${userId}`);
  return response.data;
};

export const getSupportAdminAnalytics = async () => {
  const response = await apiClient.get('/support/admin/analytics');
  return response.data;
};

export const getSupportAdminTickets = async (params?: {
  status?: string;
  search?: string;
  department?: string;
}) => {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.search) searchParams.set('search', params.search);
  if (params?.department) searchParams.set('department', params.department);
  const query = searchParams.toString();
  const response = await apiClient.get(
    `/support/admin/tickets${query ? `?${query}` : ''}`,
  );
  return response.data;
};

export const getSupportOrderStatus = async (orderNumber: string) => {
  const response = await apiClient.get(
    `/support/orders/${encodeURIComponent(orderNumber)}/status`,
  );
  return response.data;
};

export const escalateSupportChat = async (payload: {
  userId: string;
  context?: CustomerChatContext;
}) => {
  const response = await apiClient.post('/support/escalate', payload);
  return response.data;
};

export const getSupportAdminContext = async (params?: {
  userId?: string;
  email?: string;
}) => {
  const searchParams = new URLSearchParams();
  if (params?.userId) searchParams.set('userId', params.userId);
  if (params?.email) searchParams.set('email', params.email);
  const query = searchParams.toString();
  const response = await apiClient.get(
    `/support/admin/context${query ? `?${query}` : ''}`,
  );
  return response.data;
};

export const getSupportAdminRoutingGuide = async () => {
  const response = await apiClient.get('/support/admin/routing-guide');
  return response.data;
};

export const getSupportAdminAgentPool = async (groupKey?: string) => {
  const params = groupKey ? `?group_key=${encodeURIComponent(groupKey)}` : '';
  const response = await apiClient.get(`/support/admin/agent-pool${params}`);
  return response.data;
};

export type SupportAgentPoolRow = {
  _id: string;
  group_key: string;
  zendesk_user_id: number;
  display_name: string;
  is_active: boolean;
  max_open_tickets: number;
  sort_order: number;
};

export type SupportAssignmentLogRow = {
  _id: string;
  ticket_id: number;
  group_key: string;
  zendesk_user_id: number;
  method: string;
  assigned_by: string;
  requester_email?: string;
  createdAt: string;
};

export const upsertSupportAdminAgentPool = async (payload: {
  group_key: string;
  zendesk_user_id: number;
  display_name: string;
  is_active?: boolean;
  max_open_tickets?: number;
  sort_order?: number;
}) => {
  const response = await apiClient.post('/support/admin/agent-pool', payload);
  return response.data;
};

export const getSupportAdminAssignmentHistory = async (limit = 50) => {
  const response = await apiClient.get(
    `/support/admin/assignment-history?limit=${limit}`,
  );
  return response.data;
};

export const getSupportAdminGroups = async () => {
  const response = await apiClient.get('/support/admin/groups');
  return response.data;
};

export { apiClient } from '../api-client/api-client';

export const getSupportAdminAgentWorkspace = async () => {
  const response = await apiClient.get('/support/admin/agent-workspace');
  return response.data;
};

export type ZendeskTriggerPlannedRow = {
  key: string;
  title: string;
  department: string;
  dept_tag: string;
  group_name: string;
  status: 'exists' | 'missing' | 'group_not_found';
  existing_trigger_id?: number;
  existing_trigger_title?: string;
  match_reason?: string;
  post_url: string;
  payload: { trigger: Record<string, unknown> };
};

export type ZendeskTriggerAnalysis = {
  zendesk_enabled: boolean;
  subdomain: string;
  existing_josh_triggers: Array<{
    id: number;
    title: string;
    active: boolean;
    url?: string;
  }>;
  planned: ZendeskTriggerPlannedRow[];
  missing_count: number;
  summary: string;
};

export const getSupportAdminZendeskTriggerAnalysis = async () => {
  const response = await apiClient.get('/support/admin/zendesk/triggers/analysis');
  return response.data as {
    status: boolean;
    data: ZendeskTriggerAnalysis;
    message?: string;
  };
};

export const provisionSupportAdminZendeskTriggers = async (payload: {
  confirm: boolean;
  keys?: string[];
}) => {
  const response = await apiClient.post(
    '/support/admin/zendesk/triggers/provision',
    payload,
  );
  return response.data;
};

export const linkLineIdentity = async (lineUserId: string) => {
  const response = await apiClient.post('/support/identity/link-line', {
    lineUserId,
  });
  return response.data;
};
