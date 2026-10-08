import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackAppRecord } from './entities/winback-app-record.entity';
import { JoshRestaurantPlace as RestaurantPlace } from './josh-copies.entity';
import { LeadService } from './lead.service';
import { WinbackActor } from './app-records.service';
import { OpportunityProvinceQueryDto, OpportunityQueryDto } from './dto/app-gaps.dto';
import { Opportunity, pageOpportunities, placeToOpportunity } from './app-gaps.helpers';
import {
  buildOpportunityMeta,
  OPPORTUNITY_DEFAULT_PURPOSE,
  OPPORTUNITY_DEFAULT_STAGE,
  OpportunityMeta,
  OpportunityMetaGroup,
  OpportunityMetaPlaceRow,
  ownerFilterError,
  RuleError,
  storedMeta,
  summarizeOpportunityMeta,
} from './opportunity-meta.helpers';
import { WinbackAppRecordKind as Kind, WinbackRecommendationReason } from './winback.enums';
import {
  districtNamesOfProvince,
  listProvinces,
  parseProvinceCode,
  provinceForDistrict,
  provinceQueryCode,
} from './winback-geography';

/** Places scored per list call. The list is ranked in memory, so this bounds the work, not the result. */
export const OPPORTUNITY_CANDIDATE_CAP = 3000;

/** A broken rule from opportunity-meta.helpers as its HTTP error. */
export function raiseRule(error: RuleError | null): void {
  if (!error) return;
  if (error.status === 403) throw new ForbiddenException(error.message);
  if (error.status === 409) throw new ConflictException(error.message);
  throw new BadRequestException(error.message);
}

// The §4.11.8 meta as SQL over `p` (place), `a` (converted account) and `m` (stored opportunity_meta), so the
// list filters and the filter-meta counts run before the candidate cap. Same derivation as buildOpportunityMeta.
const META_JOIN = 'm.kind = :metaKind AND m.record_key = CAST(p.id AS text)';
const STAGE_SQL = `COALESCE(m.payload->>'stage', a.stage, '${OPPORTUNITY_DEFAULT_STAGE}')`;
const PURPOSE_SQL = `COALESCE(m.payload->>'purpose', '${OPPORTUNITY_DEFAULT_PURPOSE}')`;
const OWNER_SQL = 'COALESCE(m.sales_user_id, a.assigned_sales_user_id)';
/** = needsEnrich(): not enriched, or no spend range (parseSpendRange finds a number > 0 iff a digit 1–9 is present). */
const RESEARCH_SQL = "(p.enriched_at IS NULL OR p.price_range IS NULL OR p.price_range !~ '[1-9]')";

/** A place row plus the columns the meta is derived from. */
export interface OpportunityMetaRow extends OpportunityMetaPlaceRow {
  meta_id?: string | null;
  meta_payload?: Record<string, unknown> | null;
  meta_owner_id?: string | null;
  meta_version?: number | string | null;
  meta_updated_at?: Date | string | null;
}

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

  private joined(): SelectQueryBuilder<RestaurantPlace> {
    return this.places
      .createQueryBuilder('p')
      .leftJoin(WinbackAccount, 'a', 'a.restaurant_place_id = p.id')
      .leftJoin(WinbackAppRecord, 'm', META_JOIN, { metaKind: Kind.OPPORTUNITY_META });
  }

  private base(): SelectQueryBuilder<RestaurantPlace> {
    return this.joined().select([
      'p.id AS id',
      'p.name_th AS name_th',
      'p.name_en AS name_en',
      'p.district AS district',
      'p.raw_category AS raw_category',
      'p.rating AS rating',
      'p.review_count AS review_count',
      'p.price_range AS price_range',
      'p.enriched_at AS enriched_at',
      'p.created_at AS created_at',
      'p.updated_at AS updated_at',
      'a.id AS winback_account_id',
      'a.stage AS account_stage',
      'a.assigned_sales_user_id AS account_owner_id',
      'a.cuisine_id AS account_cuisine_id',
      'm.id AS meta_id',
      'm.payload AS meta_payload',
      'm.sales_user_id AS meta_owner_id',
      'm.version AS meta_version',
      'm.update_date AS meta_updated_at',
    ]);
  }

  /** Sales-user id → display name (the `/sales-users` roster). */
  async rosterNames(): Promise<Map<string, string>> {
    const users = (await this.leads.listSalesUsers()) as Array<{ id: string; name: string }>;
    return new Map(users.map((u) => [u.id, u.name]));
  }

  /** The stored meta a joined row carries (null when nothing is stored). */
  static storedOf(row: OpportunityMetaRow) {
    return row.meta_id ? storedMeta(row.meta_payload, row.meta_owner_id, row.meta_version, row.meta_updated_at) : null;
  }

  /** Meta from the place row and a stored record (the row's own join, or a fresher locked read). */
  metaOf(row: OpportunityMetaRow, stored: WinbackAppRecord | null | undefined, names: ReadonlyMap<string, string>): OpportunityMeta {
    const s = stored === undefined
      ? OpportunityService.storedOf(row)
      : stored && storedMeta(stored.payload, stored.sales_user_id, stored.version, stored.update_date);
    return buildOpportunityMeta(row, placeToOpportunity(row), s || null, names);
  }

  /** The place behind an opportunity (open or converted) with its meta columns; 404 when there is none. */
  async placeRow(id: string): Promise<OpportunityMetaRow> {
    const row = await this.base().where('p.id = :id', { id }).getRawOne<OpportunityMetaRow>();
    if (!row) throw new NotFoundException('Opportunity not found');
    return row;
  }

  private applyMetaFilters(qb: SelectQueryBuilder<RestaurantPlace>, q: OpportunityQueryDto) {
    if (q.stage) qb.andWhere(`${STAGE_SQL} = :metaStage`, { metaStage: q.stage });
    if (q.purpose) qb.andWhere(`${PURPOSE_SQL} = :metaPurpose`, { metaPurpose: q.purpose });
    // Only `needs_research` is ever derived; any other reason matches nothing (never invented).
    if (q.recommendation) qb.andWhere(q.recommendation === WinbackRecommendationReason.NEEDS_RESEARCH ? RESEARCH_SQL : '1 = 0');
    if (q.owner_sales_user_id) qb.andWhere(`${OWNER_SQL} = :metaOwner`, { metaOwner: q.owner_sales_user_id });
    if (q.unassigned_only) qb.andWhere(`${OWNER_SQL} IS NULL`);
  }

  private async withMeta(items: Opportunity[], rows: OpportunityMetaRow[]) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const owned = items.some((o) => {
      const r = byId.get(o.id);
      return !!(r?.meta_owner_id || r?.account_owner_id);
    });
    const names = owned ? await this.rosterNames() : new Map<string, string>();
    return items.map((o) => ({ ...o, meta: this.metaOf(byId.get(o.id)!, undefined, names) }));
  }

  async list(actor: WinbackActor, q: OpportunityQueryDto) {
    raiseRule(ownerFilterError(actor, q));
    const qb = this.base().where('a.id IS NULL');
    const codes = (q.province_codes ?? []).map(parseProvinceCode).filter((c): c is number => c !== null);
    if (q.province_codes?.length) {
      // Prefilter by district text; the exact province is checked again per row (pageOpportunities).
      const patterns = codes.flatMap((c) => districtNamesOfProvince(c)).map((n) => `%${n}%`);
      if (!patterns.length) return { ...pageOpportunities([], q), items: await this.withMeta([], []) };
      qb.andWhere('p.district ILIKE ANY(ARRAY[:...patterns])', { patterns });
    }
    if (q.search?.trim()) {
      qb.andWhere(
        '(p.name_th ILIKE :s OR p.name_en ILIKE :s OR p.district ILIKE :s OR p.raw_category ILIKE :s)',
        { s: `%${q.search.trim()}%` },
      );
    }
    this.applyMetaFilters(qb, q);
    const rows = await qb
      .orderBy('p.enriched_at IS NULL', 'ASC')
      .addOrderBy('p.review_count', 'DESC', 'NULLS LAST')
      .addOrderBy('p.id', 'ASC')
      .limit(OPPORTUNITY_CANDIDATE_CAP)
      .getRawMany<OpportunityMetaRow>();
    const filter = { ...q, province_codes: codes.map(provinceQueryCode) };
    const page = pageOpportunities(rows.map(placeToOpportunity), filter);
    return { ...page, items: await this.withMeta(page.items, rows) };
  }

  async detail(id: string) {
    return placeToOpportunity(await this.placeRow(id));
  }

  async meta(id: string): Promise<OpportunityMeta> {
    const row = await this.placeRow(id);
    const owned = !!(row.meta_owner_id || row.account_owner_id);
    return this.metaOf(row, undefined, owned ? await this.rosterNames() : new Map());
  }

  /**
   * Counts for the filter chips over every open opportunity (no lead yet — the list's universe), uncapped like
   * `/opportunities/provinces`: one GROUP BY over places + stored meta. A sales user counts what they own and
   * what nobody owns; a manager counts everything.
   */
  async filterMeta(actor: WinbackActor) {
    const qb = this.joined()
      .select(STAGE_SQL, 'stage')
      .addSelect(PURPOSE_SQL, 'purpose')
      .addSelect(OWNER_SQL, 'owner')
      .addSelect(RESEARCH_SQL, 'research')
      .addSelect('COUNT(*)', 'count')
      .where('a.id IS NULL')
      .groupBy(STAGE_SQL)
      .addGroupBy(PURPOSE_SQL)
      .addGroupBy(OWNER_SQL)
      .addGroupBy(RESEARCH_SQL);
    if (!actor.isManager) {
      if (actor.id) qb.andWhere(`(${OWNER_SQL} IS NULL OR ${OWNER_SQL} = :me)`, { me: actor.id });
      else qb.andWhere(`${OWNER_SQL} IS NULL`);
    }
    const groups = await qb.getRawMany<OpportunityMetaGroup>();
    const names = groups.some((g) => g.owner) ? await this.rosterNames() : new Map<string, string>();
    return summarizeOpportunityMeta(groups, names);
  }

  /** The opportunity (restaurant place) ids converted into an account — `winback_account.restaurant_place_id`. */
  async accountOpportunities(accountId: string): Promise<string[]> {
    const account = await this.accounts.findOne({ where: { id: accountId } });
    if (!account) throw new NotFoundException('winback account not found');
    return account.restaurant_place_id ? [account.restaurant_place_id] : [];
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
