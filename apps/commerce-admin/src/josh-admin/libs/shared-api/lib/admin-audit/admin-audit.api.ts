import { apiClient } from '../api-client/api-client';

export type AdminAuditEntityType =
  | 'campaign'
  | 'promotion_mechanic'
  | 'coupon'
  | 'promotion_page'
  | 'promotion_product_set';

/** One changed top-level field. `before`/`after` are JSON (a long value arrives as a truncated string). */
export type AdminAuditChange = {
  field: string;
  before: unknown;
  after: unknown;
};

export type AdminAuditLogItem = {
  id: string;
  /** create | update | delete | set_coupons | refresh_product_sets | upload_image | set_redemption_rules */
  action: string;
  /** null when the request had no authenticated user (SECURITY_STRICT_MODE off). */
  actor_email: string | null;
  created_at: string;
  changes: AdminAuditChange[];
};

export type AdminAuditLogPage = {
  items: AdminAuditLogItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
};

type AdminAuditEnvelope = {
  status: boolean;
  statusCode: number;
  message: string;
  data: AdminAuditLogPage;
};

/** History of one entity, newest first. */
export const getAdminAuditLogs = async (params: {
  entityType: AdminAuditEntityType;
  entityId: string;
  page?: number;
  limit?: number;
}): Promise<AdminAuditLogPage> => {
  const response = await apiClient.get<AdminAuditEnvelope>('/admin/audit-logs', {
    params: {
      entity_type: params.entityType,
      entity_id: params.entityId,
      page: params.page ?? 1,
      limit: params.limit ?? 20,
    },
  });
  return response.data.data;
};
