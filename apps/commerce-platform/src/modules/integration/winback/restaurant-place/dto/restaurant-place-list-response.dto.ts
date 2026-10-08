/**
 * Market Explorer list response. Every enrichment field may be null — the
 * base rows come from Foursquare OS Places and enrichment is best-effort.
 */
export interface RestaurantPlaceListItemDto {
  id: string;
  /** Display name, Thai preferred, English fallback. */
  name: string;
  nameTh: string | null;
  nameEn: string | null;
  district: string | null;
  /** josh `thai_provinces.province_code`, from `district` (places carry no province); null when unknown/ambiguous. */
  provinceCode: number | null;
  provinceName: string | null;
  category: string | null;
  lat: number;
  lng: number;
  /** 0-5, null until enriched. */
  rating: number | null;
  reviewCount: number | null;
  /** e.g. "$$", null until enriched. */
  priceRange: string | null;
  /** True once any enrichment pass has touched this place. */
  isEnriched: boolean;
  /** 16 buckets 08:00–23:00 for today; null when not enriched. */
  popularTimesToday: number[] | null;
  /** Heuristic from review volume; null when unknown. */
  estimatedTables: number | null;
  /** Linked winback tmp/lead account, if any. */
  winbackAccountId: string | null;
  winbackCustomerCode: string | null;
}

export interface RestaurantPlaceListSummaryDto {
  /** Count of all places matching the filters, across all pages. */
  totalCount: number;
  topCategories: { name: string; count: number }[];
  topDistricts: { name: string; count: number }[];
}

export interface RestaurantPlaceListResponseDto {
  items: RestaurantPlaceListItemDto[];
  summary: RestaurantPlaceListSummaryDto;
  page: number;
  limit: number;
}
