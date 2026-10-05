import { apiClient } from '@josh/shared-api';

export class BotClient {
  private readonly client = apiClient;

  async testFlow(workflowId: string, message: string): Promise<any> {
    const response = await this.client.post(
      `/admin/bot/flows/${workflowId}/test`,
      { message }
    );
    return response.data;
  }

  async getWorkflow(workflowId: string): Promise<any> {
    const response = await this.client.get(`/admin/bot/workflows/${workflowId}`);
    return response.data;
  }

  async updateWorkflow(workflowId: string, payload: any): Promise<any> {
    const response = await this.client.put(
      `/admin/bot/workflows/${workflowId}`,
      payload
    );
    return response.data;
  }
}
