import { apiClient } from '../api-client/api-client';

export const getSuppliers = async (
  page = 1,
  limit = 10,
  search = '',
): Promise<any> => {
  const response = await apiClient.get(
    `/supplier?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`,
  );
  return response;
};

export const getSupplierById = async (id: string): Promise<any> => {
  const response = await apiClient.get(`/supplier/${id}`);
  return response;
};

export const createSupplier = async (data: any): Promise<any> => {
  const response = await apiClient.post('/supplier', data);
  return response;
};

export const updateSupplier = async (id: string, data: any): Promise<any> => {
  const response = await apiClient.patch(`/supplier/${id}`, data);
  return response;
};

export const deleteSupplier = async (id: string): Promise<any> => {
  const response = await apiClient.delete(`/supplier/${id}`);
  return response;
};
