import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { JoshRestaurantPlace as RestaurantPlace } from './josh-copies.entity';
import { LeadService } from './lead.service';
import { OpportunityProvinceQueryDto, OpportunityQueryDto } from './dto/app-gaps.dto';
import { OpportunityPlaceRow, pageOpportunities, placeToOpportunity } from './app-gaps.helpers';
import {
  districtNamesOfProvince,
  listProvinces,
  parseProvinceCode,
  provinceForDistrict,
  provinceQueryCode,
} from './winback-geography';

/** Places scored per list call. The list is ranked in memory, so this bounds the work, not the result. */
export const OPPORTUNITY_CANDIDATE_CAP = 3000;

/**
 * Opportunities = Market Explorer restaurant places no winback lead points at yet. Converting one creates
 * the TMP lead exactly like `POST /leads/from-restaurant-place/:placeId` (and is idempotent).
 */
@Injectable()
export class OpportunityService {
  constructor(
    @InjectRepository(RestaurantPlace) private readonly places: Repository<RestaurantPlace>,
    @InjectRepository(WinbackAccount) private readonly accounts: Repository<WinbackAccount>,
    private readonly leads: LeadService,
  ) {}

  private base(): SelectQueryBuilder<RestaurantPlace> {
    return this.places
      .createQueryBuilder('p')
      .leftJoin(WinbackAccount, 'a', 'a.restaurant_place_id = p.id')
      .select([
        'p.id AS id',
        'p.name_th AS name_th',
        'p.name_en AS name_en',
        'p.district AS district',
        'p.raw_category AS raw_category',
        'p.rating AS rating',
        'p.review_count AS review_count',
        'p.price_range AS price_range',
        'p.enriched_at AS enriched_at',
        'a.id AS winback_account_id',
      ]);
  }

  async list(q: OpportunityQueryDto) {
    const qb = this.base().where('a.id IS NULL');
    const codes = (q.province_codes ?? []).map(parseProvinceCode).filter((c): c is number => c !== null);
    if (q.province_codes?.length) {
      // Prefilter by district text; the exact province is checked again per row (pageOpportunities).
      const patterns = codes.flatMap((c) => districtNamesOfProvince(c)).map((n) => `%${n}%`);
      if (!patterns.length) return pageOpportunities([], q);
      qb.andWhere('p.district ILIKE ANY(ARRAY[:...patterns])', { patterns });
    }
    if (q.search?.trim()) {
      qb.andWhere(
        '(p.name_th ILIKE :s OR p.name_en ILIKE :s OR p.district ILIKE :s OR p.raw_category ILIKE :s)',
        { s: `%${q.search.trim()}%` },
      );
    }
    const rows = await qb
      .orderBy('p.enriched_at IS NULL', 'ASC')
      .addOrderBy('p.review_count', 'DESC', 'NULLS LAST')
      .addOrderBy('p.id', 'ASC')
      .limit(OPPORTUNITY_CANDIDATE_CAP)
      .getRawMany<OpportunityPlaceRow>();
    const filter = { ...q, province_codes: codes.map(provinceQueryCode) };
    return pageOpportunities(rows.map(placeToOpportunity), filter);
  }

  async detail(id: string) {
    const row = await this.base().where('p.id = :id', { id }).getRawOne<OpportunityPlaceRow>();
    if (!row) throw new NotFoundException('Opportunity not found');
    return placeToOpportunity(row);
  }

  /** Every province with how many open opportunities it has (0 included), most first. */
  async provinces(q: OpportunityProvinceQueryDto) {
    const rows = await this.places
      .createQueryBuilder('p')
      .leftJoin(WinbackAccount, 'a', 'a.restaurant_place_id = p.id')
      .select('p.district', 'district')
      .addSelect('COUNT(*)', 'count')
      .where('a.id IS NULL')
      .groupBy('p.district')
      .getRawMany<{ district: string | null; count: string }>();
    const counts = new Map<number, number>();
    for (const r of rows) {
      const province = provinceForDistrict(r.district);
      if (province) counts.set(province.code, (counts.get(province.code) ?? 0) + Number(r.count));
    }
    const s = q.search?.trim().toLowerCase();
    const items = listProvinces()
      .map((p) => ({ code: provinceQueryCode(p.code), name: p.name_th, name_en: p.name_en, opportunity_count: counts.get(p.code) ?? 0 }))
      .filter((p) => !s || [p.code, p.name, p.name_en].some((v) => v.toLowerCase().includes(s)))
      .sort((a, b) => b.opportunity_count - a.opportunity_count || a.code.localeCompare(b.code));
    return { items };
  }

  /** Idempotent: an opportunity already converted returns its lead. */
  async convert(salesUserId: string, id: string) {
    const existing = await this.accounts.findOne({ where: { restaurant_place_id: id } });
    if (existing) return this.converted(id, existing);
    try {
      return this.converted(id, await this.leads.createTmpFromRestaurantPlace(salesUserId, id));
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        if (error instanceof NotFoundException) throw new NotFoundException('Opportunity not found');
        throw error;
      }
      // Two taps at once: the other request created it.
      const raced = await this.accounts.findOne({ where: { restaurant_place_id: id } });
      if (!raced) throw error;
      return this.converted(id, raced);
    }
  }

  private converted(opportunityId: string, account: WinbackAccount) {
    return {
      opportunity_id: opportunityId,
      winback_account_id: account.id,
      customer_code: account.customer_code,
      stage: account.stage,
      lifecycle: account.lifecycle,
    };
  }
}
