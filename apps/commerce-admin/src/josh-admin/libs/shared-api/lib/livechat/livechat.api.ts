import { apiClient } from '../api-client/api-client';

export type PostLivechatMessagePayload = {
  visitorId: string;
  text: string;
  source?: string;
  threadId?: string;
  contactEmail?: string;
  contactPhone?: string;
  messageKind?: 'text' | 'image';
  attachmentUrl?: string;
  lang?: 'th' | 'en';
};

export type LivechatMessagesResponse = {
  externalMessageId: string;
  received: number;
  created: number;
  duplicate: number;
  rejected: number;
  results: Array<{
    externalMessageId: string;
    status: string;
    chatHistoryId?: string;
    error?: string;
  }>;
};

export type LivechatHistoryQuery = {
  visitorId?: string;
  threadId?: string;
  limit?: number;
  before?: string;
};

export type LivechatHistoryMessage = {
  externalMessageId: string;
  chatHistoryId: string;
  threadId?: string;
  direction: 'inbound' | 'outbound';
  text: string;
  sentAt: string;
  source?: string;
  agentId?: string | null;
  options?: string[] | null;
  flowId?: string | null;
  flowName?: string | null;
  messageKind?: 'text' | 'image';
  attachmentUrl?: string;
};

export type LivechatHistoryResponse = {
  visitorId?: string;
  customerCode?: string;
  threadId?: string;
  messages: LivechatHistoryMessage[];
  hasMore: boolean;
  /** Server-computed: true when the most recent message is from a Bangkok-
   * local calendar day before today, or CS-CRM reports the conversation as
   * explicitly ended. Backend owns this decision (not the client) so every
   * consumer applies the same rule — see
   * apps/backend/src/app/livechat/livechat.service.ts#getHistory. */
  isFreshSession: boolean;
};

/** Shape of the Socket.IO `receive_message` payload emitted by the backend. */
export type LivechatSocketMessage = {
  text: string;
  agentName?: string;
  messageId?: string;
  options?: string[] | null;
  flowId?: string | null;
  flowName?: string | null;
};

export type LivechatBotFlowBadge = {
  label: string;
  keyword: string;
};

export type UploadLivechatAttachmentResponse = {
  status: boolean;
  statusCode: number;
  message: string;
  data?: { url: string; filename: string };
};

export const postLivechatMessage = async (
  payload: PostLivechatMessagePayload,
): Promise<LivechatMessagesResponse> => {
  const response = await apiClient.post('/livechat/messages', payload);
  return response.data;
};

export const getLivechatHistory = async (
  params: LivechatHistoryQuery,
): Promise<LivechatHistoryResponse> => {
  const response = await apiClient.get('/livechat/history', { params });
  return response.data;
};

export const getLivechatBotFlowBadges = async (lang?: 'th' | 'en'): Promise<
  LivechatBotFlowBadge[]
> => {
  const response = await apiClient.get('/livechat/bot-flow-badges', {
    params: lang ? { lang } : {},
  });
  return response.data;
};

export const pingLivechat = async () => {
  const response = await apiClient.get('/livechat/ping');
  return response.data;
};

/** `visitorId` = the same id sent with `postLivechatMessage` — the server checks it like a chat send. */
export const uploadLivechatAttachment = async (
  file: File,
  visitorId: string,
): Promise<{ url: string; filename: string }> => {
  const form = new FormData();
  form.append('file', file);
  const response = await apiClient.post<UploadLivechatAttachmentResponse>(
    '/upload/chat-image',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' }, params: { visitorId } },
  );
  if (!response.data.status || !response.data.data) {
    throw new Error(response.data.message || 'Upload failed');
  }
  return response.data.data;
};
