// Market Explorer browse for the saleactivity app (prospecting): josh's `GET /api/restaurant-place[/:id]`, which a
// commerce staff token cannot call. Same data as `/reports/restaurants*` (RestaurantPlaces) behind the winback app
// sales role gate and `{ data }` envelope. Read-only: list and detail only — no export, no geo.
import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, ServiceUnavailableException, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { parseRestaurantFilters, RestaurantPlaces } from '../connector/josh/restaurant-places';
import { NO_REPLICA } from '../connector/josh/system-health';
import { AdminWriteGuard } from './shared/admin-write.guard';
import { WinbackAppRoleGuard } from './winback-app-role.guard';
import { WinbackResponseInterceptor } from './winback-response.interceptor';
import { provinceForDistrict } from './winback-geography';

export const PLACE_LIMIT_DEFAULT = 50;
export const PLACE_LIMIT_MAX = 100;
const PAGE_MAX = 1e6;

/** page ≥ 1, limit 1..100 (default 50): out of range or not a number is clamped / defaulted, never a 400. */
export function placePaging(q: Record<string, unknown>): { page: number; limit: number } {
  const int = (v: unknown, def: number) => {
    const n = typeof v === 'string' && v.trim() ? Math.trunc(Number(v)) : typeof v === 'number' ? Math.trunc(v) : NaN;
    return Number.isFinite(n) ? n : def;
  };
  return {
    page: Math.min(PAGE_MAX, Math.max(1, int(q.page, 1))),
    limit: Math.min(PLACE_LIMIT_MAX, Math.max(1, int(q.limit, PLACE_LIMIT_DEFAULT))),
  };
}

/** josh's DTO carries the place's province (from `district`; places have none) — the app's discovery filter reads it. */
export const withProvince = <T extends { district?: string | null }>(item: T) => {
  const province = provinceForDistrict(item.district);
  return { ...item, provinceCode: province?.code ?? null, provinceName: province?.name_th ?? null };
};

@UseGuards(AdminWriteGuard, WinbackAppRoleGuard)
@UseInterceptors(WinbackResponseInterceptor)
@Controller('winback')
export class WinbackRestaurantPlaceController {
  constructor(private readonly places: RestaurantPlaces) {}

  private ready() {
    if (!this.places.available) throw new ServiceUnavailableException(`${NO_REPLICA.reason} Set RESTAURANTS_SOURCE=copies to read commerce's copy.`);
  }

  @ApiOperation({ summary: 'Market Explorer (ร้านอาหาร) สำหรับหาลูกค้าใหม่ — { items, summary { totalCount, topCategories, topDistricts }, page, limit }' })
  @Get('restaurant-place')
  async list(@Query() q: Record<string, unknown>) {
    const filters = parseRestaurantFilters(q);
    const { page, limit } = placePaging(q);
    this.ready();
    const result = await this.places.list(filters, page, limit);
    return { ...result, items: result.items.map(withProvince) };
  }

  @ApiOperation({ summary: 'รายละเอียดร้านใน Market Explorer (popular times, opening hours, service options)' })
  @Get('restaurant-place/:id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    this.ready();
    const place = await this.places.detail(id);
    if (!place) throw new NotFoundException('ไม่พบร้านใน Market Explorer');
    return withProvince(place);
  }
}
