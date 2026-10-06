import { apiClient } from '@josh/shared-api';

export const getMetric = async (): Promise<any> => {
  const response = await apiClient.get<any>(`/metric`);
  return response;
};
