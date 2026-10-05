import { apiClient } from '../api-client/api-client';

/**
 * Restaurant market data (public Google Maps-sourced records).
 * Matches apps/backend GET /restaurant-place — all enrichment fields are
 * nullable and clients must render gracefully without them.
 */
export type RestaurantPlaceRow = {
  id: string;
  nameTh: string;
  nameEn: string | null;
  district: string | null;
  category: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  reviewCount: number | null;
  priceRange: string | null;
  isEnriched: boolean;
  /** 16 buckets 08:00–23:00, values 0–100. Null when not enriched. */
  popularTimesToday: number[] | null;
  estimatedTables: number | null;
  winbackAccountId: string | null;
  winbackCustomerCode: string | null;
};

export type RestaurantPlaceDetail = RestaurantPlaceRow & {
  /** 7 days × 16 buckets (Mon..Sun), values 0–100. Null when not enriched. */
  popularTimes: number[][] | null;
  openingHours: unknown | null;
  dineIn: boolean | null;
  takeaway: boolean | null;
  delivery: boolean | null;
};

export type RestaurantPlaceSummary = {
  totalCount: number;
  topCategories: { name: string; count: number }[];
  topDistricts: { name: string; count: number }[];
};

export type RestaurantPlaceListResponse = {
  items: RestaurantPlaceRow[];
  summary: RestaurantPlaceSummary;
  page: number;
  limit: number;
  totalCount: number;
};

export type RestaurantPlaceFilterParams = {
  search?: string;
  district?: string;
  category?: string;
  minRating?: number;
  maxRating?: number;
  minReviewCount?: number;
  maxReviewCount?: number;
  priceRange?: string;
  isEnriched?: boolean;
  dineIn?: boolean;
  takeaway?: boolean;
  delivery?: boolean;
  busyWindow?: 'lunch' | 'dinner' | 'late';
  excludeHasTmpLead?: boolean;
};

export type GetRestaurantPlacesParams = RestaurantPlaceFilterParams & {
  page?: number;
  limit?: number;
};

export type ExportRestaurantPlacesParams = RestaurantPlaceFilterParams;

/** Some backend controllers wrap payloads in { data }; unwrap either shape. */
function unwrap<T>(body: unknown): T {
  const b = body as { data?: unknown };
  return (b && typeof b === 'object' && 'data' in b ? b.data : body) as T;
}

const BUSY_WINDOW_PARAM: Record<string, string> = {
  lunch: '11-14',
  dinner: '17-20',
  late: '21-24',
};

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

function toBuckets(hours24: unknown): number[] | null {
  return Array.isArray(hours24) && hours24.length >= 24
    ? (hours24 as number[]).slice(8, 24)
    : null;
}

function toPlaceQuery(params: RestaurantPlaceFilterParams = {}): Record<string, unknown> {
  const query: Record<string, unknown> = { ...params };
  if (params.busyWindow) {
    query['busyWindow'] = BUSY_WINDOW_PARAM[params.busyWindow] ?? params.busyWindow;
  }
  return query;
}

function adaptRow(raw: Record<string, unknown>): RestaurantPlaceRow {
  return {
    id: String(raw['id'] ?? ''),
    nameTh: (raw['nameTh'] as string) ?? (raw['name'] as string) ?? '',
    nameEn: (raw['nameEn'] as string) ?? null,
    district: (raw['district'] as string) ?? null,
    category: (raw['category'] as string) ?? null,
    lat: (raw['lat'] as number) ?? null,
    lng: (raw['lng'] as number) ?? null,
    rating: (raw['rating'] as number) ?? null,
    reviewCount: (raw['reviewCount'] as number) ?? null,
    priceRange: (raw['priceRange'] as string) ?? null,
    isEnriched: Boolean(raw['isEnriched']),
    popularTimesToday: (raw['popularTimesToday'] as number[]) ?? null,
    estimatedTables: (raw['estimatedTables'] as number) ?? null,
    winbackAccountId: (raw['winbackAccountId'] as string) ?? null,
    winbackCustomerCode: (raw['winbackCustomerCode'] as string) ?? null,
  };
}

function adaptDetail(raw: Record<string, unknown>): RestaurantPlaceDetail {
  const svc = (raw['serviceOptions'] ?? {}) as Record<string, boolean | null>;
  const pt = raw['popularTimes'] as Record<string, number[]> | null;
  const week = pt
    ? WEEKDAYS.map((d) => toBuckets(pt[d])).filter((x): x is number[] => !!x)
    : [];
  return {
    ...adaptRow(raw),
    popularTimes: week.length === 7 ? week : null,
    openingHours: raw['openingHours'] ?? null,
    dineIn: (raw['dineIn'] as boolean) ?? svc['dineIn'] ?? null,
    takeaway: (raw['takeaway'] as boolean) ?? svc['takeaway'] ?? null,
    delivery: (raw['delivery'] as boolean) ?? svc['delivery'] ?? null,
  };
}

export const getRestaurantPlaces = async (
  params: GetRestaurantPlacesParams = {},
): Promise<RestaurantPlaceListResponse> => {
  const { page, limit, ...filters } = params;
  const response = await apiClient.get('/restaurant-place', {
    params: { ...toPlaceQuery(filters), page, limit },
  });
  const body = unwrap<RestaurantPlaceListResponse>(response.data);
  const items = (body.items ?? []).map((r) =>
    adaptRow(r as unknown as Record<string, unknown>),
  );
  return {
    ...body,
    items,
    totalCount: body.totalCount ?? body.summary?.totalCount ?? items.length,
    page: body.page ?? params.page ?? 1,
    limit: body.limit ?? params.limit ?? items.length,
  };
};

export const getRestaurantPlace = async (
  id: string,
): Promise<RestaurantPlaceDetail> => {
  const response = await apiClient.get(`/restaurant-place/${id}`);
  return adaptDetail(
    unwrap<Record<string, unknown>>(response.data),
  );
};

/** All filtered rows (unpaginated) — feeds the Market Explorer bubble map. */
export const getRestaurantPlacesGeo = async (
  filters: RestaurantPlaceFilterParams = {},
): Promise<RestaurantPlaceRow[]> => {
  const response = await apiClient.get('/restaurant-place/geo', {
    params: toPlaceQuery(filters),
  });
  const body = unwrap<Record<string, unknown>[]>(response.data);
  return (body ?? []).map(adaptRow);
};

export const exportRestaurantPlacesCsv = async (
  params: ExportRestaurantPlacesParams = {},
): Promise<Blob> => {
  const response = await apiClient.get('/restaurant-place/export', {
    params: toPlaceQuery(params),
    responseType: 'blob',
  });
  return response.data;
};

export type TmpLeadFromRestaurantPlaceResult = {
  id: string;
  customer_code: string;
  lifecycle: string;
  stage: string;
};

export const createTmpLeadFromRestaurantPlace = async (
  placeId: string,
): Promise<TmpLeadFromRestaurantPlaceResult> => {
  const response = await apiClient.post(
    `/winback/leads/from-restaurant-place/${placeId}`,
  );
  return unwrap<TmpLeadFromRestaurantPlaceResult>(response.data);
};
