import { apiClient } from '../api-client/api-client';

export type CopyStringAdminRow = {
  namespace: string;
  key: string;
  group_name: string;
  label: string;
  th: string;
  en: string;
};

export type CopyStringsAdminResult = {
  rows: CopyStringAdminRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type ShopCuisineCardAdmin = {
  id: string;
  slug: string;
  title_th: string;
  title_en: string;
  description_th: string;
  description_en: string;
  emoji: string;
  tone: string;
  link_url: string;
  image_url?: string | null;
  image_url_desktop?: string | null;
  image_url_large?: string | null;
  image_url_large_mobile?: string | null;
  cuisine_id?: string | null;
  sort_order: number;
  is_active: boolean;
};

export const getShopCopyStrings = async (
  locale: 'th' | 'en',
  namespace = 'shop',
): Promise<Record<string, string>> => {
  const params = new URLSearchParams({ namespace, locale });
  const response = await apiClient.get<{
    statusCode: number;
    data: Record<string, string>;
  }>(`/copy/strings?${params.toString()}`);

  return response.data?.data ?? {};
};

export const listCopyStringsAdmin = async (params: {
  namespace: string;
  search?: string;
  group?: string;
  missingOnly?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<CopyStringsAdminResult> => {
  const query = new URLSearchParams({ namespace: params.namespace });
  if (params.search) query.set('search', params.search);
  if (params.group) query.set('group', params.group);
  if (params.missingOnly) query.set('missingOnly', 'true');
  query.set('page', String(params.page ?? 1));
  query.set('pageSize', String(params.pageSize ?? 50));

  const response = await apiClient.get<{
    statusCode: number;
    data: CopyStringAdminRow[];
    meta: { total: number; page: number; pageSize: number };
  }>(`/copy/strings/admin?${query.toString()}`);

  return {
    rows: response.data?.data ?? [],
    total: response.data?.meta?.total ?? 0,
    page: response.data?.meta?.page ?? 1,
    pageSize: response.data?.meta?.pageSize ?? 50,
  };
};

export const listCopyGroups = async (namespace: string): Promise<string[]> => {
  const params = new URLSearchParams({ namespace });
  const response = await apiClient.get<{
    statusCode: number;
    data: string[];
  }>(`/copy/strings/admin/groups?${params.toString()}`);

  return response.data?.data ?? [];
};

export const bulkUpsertCopyStrings = async (
  items: Array<{
    namespace?: string;
    key: string;
    locale: 'th' | 'en';
    value: string;
    label?: string;
    group_name?: string;
  }>,
) => {
  const response = await apiClient.put('/copy/strings/bulk', { items });
  return response.data;
};

export type FigmaPreviewResult = {
  matched: {
    key: string;
    db: { th: string; en: string };
    figma: { th: string; en: string };
    inSync: boolean;
    usage: { pageName: string; frameName: string | null }[];
  }[];
  notInFigma: string[];
};

export const previewFigmaCopy = async (
  namespace: string,
): Promise<FigmaPreviewResult> => {
  const params = new URLSearchParams({ namespace });
  const response = await apiClient.get<{
    statusCode: number;
    data: FigmaPreviewResult;
  }>(`/copy/figma/preview?${params.toString()}`);

  return response.data?.data ?? { matched: [], notInFigma: [] };
};

export type MobileSyncDiffResult = {
  added: { key: string; value: string }[];
  changed: { key: string; before: string; after: string }[];
  removed: string[];
};

export const diffCopyStringsFile = async (
  file: File,
  namespace: string,
  locale: 'th' | 'en',
): Promise<MobileSyncDiffResult> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('namespace', namespace);
  formData.append('locale', locale);

  const response = await apiClient.post<{
    statusCode: number;
    data: MobileSyncDiffResult;
  }>('/copy/mobile-sync/diff', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  return response.data?.data ?? { added: [], changed: [], removed: [] };
};

export const listCuisineCardsAdmin = async (): Promise<ShopCuisineCardAdmin[]> => {
  const response = await apiClient.get<{
    statusCode: number;
    data: ShopCuisineCardAdmin[];
  }>('/cuisine/cards/admin');

  return response.data?.data ?? [];
};

export const createCuisineCardAdmin = async (
  payload: {
    slug?: string;
    title_th: string;
    title_en: string;
    description_th: string;
    description_en: string;
    emoji?: string;
    tone?: string;
    link_url?: string;
    image_url?: string | null;
    image_url_desktop?: string | null;
    image_url_large?: string | null;
    image_url_large_mobile?: string | null;
    cuisine_id?: string | null;
    sort_order?: number;
    is_active?: boolean;
  },
): Promise<ShopCuisineCardAdmin> => {
  const response = await apiClient.post<{
    statusCode: number;
    data: ShopCuisineCardAdmin;
  }>('/cuisine/cards', payload);
  return response.data?.data;
};

export const updateCuisineCardAdmin = async (
  id: string,
  payload: Partial<Omit<ShopCuisineCardAdmin, 'id' | 'slug'>>,
) => {
  const response = await apiClient.patch(`/cuisine/cards/${id}`, payload);
  return response.data;
};

export const reorderCuisineCardsAdmin = async (orderedIds: string[]) => {
  const response = await apiClient.put('/cuisine/cards/order', { orderedIds });
  return response.data;
};
