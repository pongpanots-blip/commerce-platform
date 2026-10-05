import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { WinbackAccount } from './josh-tables';
import { PoolQueryDto } from './pool-query.dto';
import { maskWinbackAccountPii } from './winback-pii.helpers';
import { deriveTmpProgressFromAccount } from './tmp-progress.helpers';
import { poolOrderBy } from './winback.helpers';
import { WINBACK_LIFECYCLES, WinbackHealth, WinbackLeadSource, WinbackLifecycle, WinbackSource, WinbackStage } from './winback.enums';
import { RestaurantPlaces } from '../restaurant-places';

type PlaceDetail = NonNullable<Awaited<ReturnType<RestaurantPlaces['detail']>>>;

/**
 * The read half of josh `WinbackService` (listProvinces, findPool, getCounts, getAging),
 * copied from josh app/winback/winback.service.ts so the answers match josh field for field.
 * Market Explorer places come from commerce's RestaurantPlaces, which returns josh's
 * RestaurantPlaceDetailDto shape. getAccount is not here: in josh it writes back.
 */
export class WinbackPoolService {
  constructor(private readonly accounts: Repository<WinbackAccount>, private readonly places: RestaurantPlaces) {}

  async listProvinces(): Promise<{ province: string; count: number }[]> {
    const rows = await this.accounts
      .createQueryBuilder('a')
      .select('a.province', 'province')
      .addSelect('COUNT(*)', 'count')
      .where('a.province IS NOT NULL')
      .groupBy('a.province')
      .orderBy('COUNT(*)', 'DESC')
      .addOrderBy('a.province', 'ASC')
      .getRawMany<{ province: string; count: string }>();
    return rows.map((row) => ({ province: row.province, count: Number(row.count) }));
  }

  async findPool(q: PoolQueryDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;

    if (q.include_places) {
      if (q.assigned !== 'unassigned') {
        throw new BadRequestException(
          'include_places ใช้ได้เฉพาะกับ assigned=unassigned (ร้านที่ยังไม่มีคนดูแล)',
        );
      }
      return this.findUnassignedPlaceCandidates(q, page, limit);
    }

    const qb = this.accounts.createQueryBuilder('a');
    if (q.search) {
      qb.andWhere(
        '(UPPER(a.customer_code) LIKE :s OR UPPER(a.display_name) LIKE :s OR a.phone LIKE :sp)',
        { s: `%${q.search.toUpperCase()}%`, sp: `%${q.search}%` },
      );
    }
    if (q.health) qb.andWhere('a.health = :health', { health: q.health });
    if (q.stage) qb.andWhere('a.stage = :stage', { stage: q.stage });
    if (q.source) qb.andWhere('a.source = :source', { source: q.source });
    if (q.lifecycle) qb.andWhere('a.lifecycle = :lifecycle', { lifecycle: q.lifecycle });
    if (q.cuisine_id) qb.andWhere('a.cuisine_id = :cid', { cid: q.cuisine_id });
    if (q.province) qb.andWhere('a.province = :province', { province: q.province });
    if (q.assigned === 'assigned') qb.andWhere('a.assigned_sales_user_id IS NOT NULL');
    if (q.assigned === 'unassigned') qb.andWhere('a.assigned_sales_user_id IS NULL');
    if (q.assigned_sales_user_id) {
      qb.andWhere('a.assigned_sales_user_id = :owner', { owner: q.assigned_sales_user_id });
    }
    if (q.inactive_min != null) {
      qb.andWhere('a.inactive_days >= :inactiveMin', { inactiveMin: q.inactive_min });
    }
    if (q.inactive_max != null) {
      qb.andWhere('a.inactive_days <= :inactiveMax', { inactiveMax: q.inactive_max });
    }

    poolOrderBy(q.sortKey, q.sortOrder).forEach(([expr, dir, nulls], i) =>
      i === 0 ? qb.orderBy(expr, dir, nulls) : qb.addOrderBy(expr, dir, nulls),
    );

    qb.skip((page - 1) * limit).take(limit);

    const [data, total] = await qb.getManyAndCount();
    const totalPages = Math.ceil(total / limit) || 1;
    // Always masked (josh: full values only via the audited PII reveal, which stays in josh).
    const placeById = await this.loadRestaurantPlaceMap(
      data.map((a) => a.restaurant_place_id).filter(Boolean) as string[],
    );
    const enriched = data.map((a) => ({
      ...maskWinbackAccountPii(a),
      tmp_progress:
        a.lifecycle !== 'lead' ? deriveTmpProgressFromAccount(a) : null,
      restaurant_place: a.restaurant_place_id ? this.withWinbackLink(placeById.get(a.restaurant_place_id), a) : null,
      place_candidate: false,
    }));
    return { data: enriched, meta: { total, page, limit, totalPages } };
  }

  /** Market Explorer places with no winback TMP yet (josh findUnassignedPlaceCandidates). */
  private async findUnassignedPlaceCandidates(q: PoolQueryDto, page: number, limit: number) {
    const list = await this.places.list({ search: q.search?.trim() || undefined, excludeHasTmpLead: true }, page, limit);
    const details = await Promise.all(list.items.map((p) => this.places.detail(p.id)));
    const data = details.filter((d): d is PlaceDetail => !!d).map((place) => this.placeCandidateRow(place));
    const total = Number(list.summary.totalCount);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  private placeCandidateRow(place: PlaceDetail) {
    const name = place.nameTh ?? place.nameEn ?? '';
    return {
      id: null,
      customer_code: null,
      display_name: name,
      phone: null,
      restaurant_name: name,
      restaurant_place_id: place.id,
      address: place.district ? `เขต${place.district}` : null,
      location: place.district,
      lat: place.lat,
      lng: place.lng,
      cuisine_name: place.category,
      lead_source: WinbackLeadSource.MARKET_EXPLORER,
      source: WinbackSource.MANUAL,
      health: WinbackHealth.DORMANT,
      stage: WinbackStage.PROSPECT,
      lifecycle: WinbackLifecycle.TMP,
      assigned_sales_user_id: null,
      inactive_days: 0,
      activity_count: 0,
      visit_count: 0,
      tmp_progress: null,
      restaurant_place: place,
      place_candidate: true,
    };
  }

  async getCounts(salesUserId?: string) {
    const [{ n: placeCandidates }] = await this.accounts.query(
      `SELECT count(*)::int AS n FROM restaurant_place p WHERE NOT EXISTS (SELECT 1 FROM winback_account wa WHERE wa.restaurant_place_id = p.id)`);
    const raw = await this.accounts
      .createQueryBuilder('a')
      .select('a.health', 'health')
      .addSelect('a.stage', 'stage')
      .addSelect('a.source', 'source')
      .addSelect('a.lifecycle', 'lifecycle')
      .addSelect('a.assigned_sales_user_id IS NULL', 'unassigned')
      .addSelect('a.assigned_sales_user_id = :me', 'mine')
      .addSelect('COUNT(*)', 'count')
      .setParameter('me', salesUserId ?? null)
      .groupBy('a.health')
      .addGroupBy('a.stage')
      .addGroupBy('a.source')
      .addGroupBy('a.lifecycle')
      .addGroupBy('unassigned')
      .addGroupBy('mine')
      .getRawMany<{ health: string; stage: string; source: string; lifecycle: string; unassigned: boolean; mine: boolean | null; count: string }>();

    const byHealth: Record<string, number> = {};
    const byStage: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const byLifecycle: Record<string, number> = {};
    for (const k of WINBACK_LIFECYCLES) byLifecycle[k] = 0;
    let total = 0;
    let unassigned = 0;
    let mine = 0;
    for (const r of raw) {
      const n = Number(r.count);
      total += n;
      byHealth[r.health] = (byHealth[r.health] ?? 0) + n;
      byStage[r.stage] = (byStage[r.stage] ?? 0) + n;
      bySource[r.source] = (bySource[r.source] ?? 0) + n;
      byLifecycle[r.lifecycle] = (byLifecycle[r.lifecycle] ?? 0) + n;
      if (r.unassigned) unassigned += n;
      if (r.mine === true) mine += n;
    }
    return { total, unassigned, placeCandidates, unassignedIncludingPlaces: unassigned + placeCandidates, mine, byHealth, byStage, bySource, byLifecycle };
  }

  unworkedLeadsQuery(days: number, now = new Date()) {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - days);
    return this.accounts
      .createQueryBuilder('a')
      .where('a.activity_count = 0')
      .andWhere('a.create_date < :cutoff', { cutoff })
      .andWhere("a.stage NOT IN ('rejected', 'lost', 'won', 'signed', 'reactivated', 'ordering_again')")
      .orderBy('a.create_date', 'ASC');
  }

  /** Leads with zero activity older than N days (manager aging view). */
  async getAging(days = 3) {
    const rows = await this.unworkedLeadsQuery(days).take(100).getMany();
    const now = Date.now();
    const DAY = 1000 * 60 * 60 * 24;
    return rows.map((a) => ({
      id: a.id,
      customer_code: a.customer_code,
      display_name: a.display_name,
      stage: a.stage,
      assigned_sales_user_id: a.assigned_sales_user_id,
      create_date: a.create_date,
      days_as_lead: Math.floor((now - new Date(a.create_date).getTime()) / DAY),
    }));
  }

  private async loadRestaurantPlaceMap(ids: string[]): Promise<Map<string, PlaceDetail>> {
    const unique = [...new Set(ids.filter(Boolean))];
    const rows = await Promise.all(unique.map((id) => this.places.detail(id)));
    return new Map(rows.filter((r): r is PlaceDetail => !!r).map((r) => [r.id, r]));
  }

  /** josh toDetail(row, { winbackLink }) — the account's own link wins over the first lookup. */
  private withWinbackLink(place: PlaceDetail | undefined, a: Pick<WinbackAccount, 'id' | 'customer_code'>) {
    return place ? { ...place, winbackAccountId: a.id, winbackCustomerCode: a.customer_code } : null;
  }
}
