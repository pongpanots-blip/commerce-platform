import { apiClient } from '../api-client/api-client';

export type AdminAccessRequestStatus = 'pending' | 'approved' | 'rejected';

export type AdminAccessRequestItem = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  mobile_phone: string | null;
  status: AdminAccessRequestStatus;
  created_at: string;
  reviewed_at?: string | null;
  reject_reason?: string | null;
};

export type RegisterAdminAccessInput = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  mobile_phone?: string;
};

export async function registerAdminAccess(input: RegisterAdminAccessInput) {
  const res = await apiClient.post('/admin-access/register', input);
  return res.data;
}

export async function listAdminAccessRequests(
  status: AdminAccessRequestStatus = 'pending',
) {
  const res = await apiClient.get('/admin-access/requests', {
    params: { status },
  });
  return res.data;
}

export async function approveAdminAccessRequest(id: string, role: string) {
  const res = await apiClient.post(`/admin-access/requests/${id}/approve`, {
    role,
  });
  return res.data;
}

export async function rejectAdminAccessRequest(id: string, reason?: string) {
  const res = await apiClient.post(`/admin-access/requests/${id}/reject`, {
    reason,
  });
  return res.data;
}
