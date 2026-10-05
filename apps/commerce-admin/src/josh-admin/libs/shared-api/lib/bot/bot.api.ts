import { apiClient } from '../api-client/api-client';

export type BotIntent = 'order_lookup' | 'product_search' | 'faq_general' | 'escalate';

export interface BotIntentRule {
  id: string;
  intent: BotIntent;
  pattern: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Intent Rules
export const getBotIntentRules = async (): Promise<any> => {
  const response = await apiClient.get('/admin/bot/intent-rules');
  return response;
};

export const createBotIntentRule = async (data: Partial<BotIntentRule>): Promise<any> => {
  const response = await apiClient.post('/admin/bot/intent-rules', data);
  return response;
};

export const updateBotIntentRule = async (
  id: string,
  data: Partial<BotIntentRule>,
): Promise<any> => {
  const response = await apiClient.patch(`/admin/bot/intent-rules/${id}`, data);
  return response;
};

export const deleteBotIntentRule = async (id: string): Promise<any> => {
  const response = await apiClient.delete(`/admin/bot/intent-rules/${id}`);
  return response;
};

// Workflows
export interface BotWorkflowTrigger {
  type: 'regex' | 'keyword';
  pattern: string;
  extractParams?: { [key: string]: string };
}

export interface BotWorkflowAction {
  type: 'tool' | 'llm' | 'escalate';
  toolName?: string;
  llmPrompt?: string;
  llmTools?: string[];
  params?: { [key: string]: string };
}

export interface BotWorkflowResponse {
  templateId: string;
  fallback?: { type: string; message: string };
}

// Multi-step flow (see apps/backend/src/app/bot/bot-tools/types.ts)
export interface FlowBranch {
  match: {
    type: 'option' | 'keyword' | 'regex' | 'default';
    value?: string;
  };
  nextStepId: string;
}

export interface FlowStep {
  id: string;
  type: 'message' | 'question' | 'tool' | 'escalate';
  text?: string;
  options?: string[];
  toolName?: 'order_lookup' | 'product_search' | 'faq' | 'product_recommend';
  templateId?: string;
  introText?: string;
  emptyText?: string;
  nextStepId?: string;
  branches?: FlowBranch[];
}

export interface BotWorkflow {
  id: string;
  name: string;
  // Legacy single-step fields (kept for backward compatibility during migration)
  trigger?: BotWorkflowTrigger;
  action?: BotWorkflowAction;
  response?: BotWorkflowResponse;
  // Multi-step flow fields
  triggerEvent?: 'message' | 'chat_open';
  steps?: FlowStep[];
  entryStepId?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const getBotWorkflows = async (): Promise<any> => {
  const response = await apiClient.get('/admin/bot/workflows');
  return response;
};

export const createBotWorkflow = async (data: Partial<BotWorkflow>): Promise<any> => {
  const response = await apiClient.post('/admin/bot/workflows', data);
  return response;
};

export const updateBotWorkflow = async (
  id: string,
  data: Partial<BotWorkflow>,
): Promise<any> => {
  const response = await apiClient.patch(`/admin/bot/workflows/${id}`, data);
  return response;
};

export const deleteBotWorkflow = async (id: string): Promise<any> => {
  const response = await apiClient.delete(`/admin/bot/workflows/${id}`);
  return response;
};

// Templates
export type BotTemplateType =
  | 'card'
  | 'card_list'
  | 'text'
  | 'rich_text'
  | 'options';

export interface BotTemplateField {
  label: string;
  key: string;
  format: 'text' | 'badge' | 'date' | 'price' | 'image' | 'list';
  formatOptions?: { [key: string]: any };
  visible?: boolean;
}

export interface BotTemplateCTA {
  label: string;
  type: 'navigate' | 'action';
  url?: string;
  action?: string;
}

export interface BotTemplateSchema {
  fields?: BotTemplateField[];
  cta?: BotTemplateCTA[];
  maxItems?: number;
}

export interface BotResponseTemplate {
  id: string;
  name: string;
  type: BotTemplateType;
  schema: BotTemplateSchema;
  example: { [key: string]: any };
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Public bot messaging endpoint
export type BotWebResponse =
  | {
      type: 'card';
      templateId: string;
      schema: BotTemplateSchema;
      data: Record<string, any>;
    }
  | {
      type: 'card_list';
      templateId: string;
      schema: BotTemplateSchema;
      data: { items: Record<string, any>[]; intro?: string };
    }
  | {
      type: 'text';
      templateId: string;
      schema: BotTemplateSchema;
      data: { text: string };
    }
  | {
      type: 'options';
      templateId: string;
      schema: BotTemplateSchema;
      data: { text: string; options: string[] };
    };

export const sendBotMessage = async (
  userId: string,
  text: string,
  opts?: { conversationId?: string; context?: Record<string, any> },
): Promise<BotWebResponse> => {
  const response = await apiClient.post('/bot/message', {
    userId,
    text,
    conversationId: opts?.conversationId,
    context: opts?.context,
  });
  return response.data;
};

export const getBotTemplates = async (): Promise<any> => {
  const response = await apiClient.get('/admin/bot/templates');
  return response;
};

export const createBotTemplate = async (data: Partial<BotResponseTemplate>): Promise<any> => {
  const response = await apiClient.post('/admin/bot/templates', data);
  return response;
};

export const updateBotTemplate = async (
  id: string,
  data: Partial<BotResponseTemplate>,
): Promise<any> => {
  const response = await apiClient.patch(`/admin/bot/templates/${id}`, data);
  return response;
};

export const deleteBotTemplate = async (id: string): Promise<any> => {
  const response = await apiClient.delete(`/admin/bot/templates/${id}`);
  return response;
};
