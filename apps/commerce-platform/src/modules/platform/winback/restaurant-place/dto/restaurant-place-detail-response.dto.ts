import { RestaurantPlaceListItemDto } from './restaurant-place-list-response.dto';

/**
 * Weekly occupancy histograms: lowercase weekday key → 24 hourly values
 * (0-100). Days may be missing; the whole object is null until enriched.
 */
export type PopularTimesDto = Record<string, unknown>;

/** Raw opening-hours structure from enrichment; null until enriched. */
export type OpeningHoursDto = Record<string, unknown>;

export interface RestaurantPlaceServiceOptionsDto {
  /** null = unknown (not yet enriched), not "no". */
  dineIn: boolean | null;
  takeaway: boolean | null;
  delivery: boolean | null;
}

export interface RestaurantPlaceDetailDto extends RestaurantPlaceListItemDto {
  nameTh: string | null;
  nameEn: string | null;
  /** Where the base row came from, e.g. "fsq_os". */
  source: string;
  popularTimes: PopularTimesDto | null;
  openingHours: OpeningHoursDto | null;
  serviceOptions: RestaurantPlaceServiceOptionsDto;
  /** ISO timestamp of the last enrichment pass, null if never enriched. */
  enrichedAt: string | null;
}
