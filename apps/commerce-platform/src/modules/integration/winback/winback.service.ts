// apps/backend/src/app/winback/winback.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackContact } from './entities/winback-contact.entity';
import { WinbackActivity } from './entities/winback-activity.entity';
import { JoshUser as User } from './josh-copies.entity';
import { JoshCompany as Company } from './josh-copies.entity';
import { JoshOrder as Order } from './josh-copies.entity';
import { JoshRestaurantPlace as RestaurantPlace } from './josh-copies.entity';
import { RestaurantPlaceDetailDto } from './restaurant-place/dto/restaurant-place-detail-response.dto';
import { toDetail, toNumberOrNull } from './restaurant-place/restaurant-place.helpers';
import { PoolQueryDto } from './dto/pool-query.dto';
import { deriveLeadStatus } from './lead-status.helper';
import { promoteBlockers, promoteIfRegistered } from './lifecycle.helpers';
import { MatchingService } from './matching.service';
import { deriveTmpProgress, deriveTmpProgressFromAccount } from './tmp-progress.helpers';
import {
  WinbackHealth,
  WinbackLeadSource,
  WinbackLifecycle,
  WinbackSource,
  WinbackStage,
  WINBACK_LIFECYCLES,
} from './winback.enums';
import { poolOrderBy } from './winback.helpers';
import { maskEmail, maskPersonName, maskPhone } from './shared/pii.helper';
import { maskContactFullName, maskWinbackAccountPii } from './winback-pii.helpers';

@Injectable()
export class WinbackService {
  constructor(
    @InjectRepository(WinbackAccount) private readonly accounts: Repository<WinbackAccount>,
    @InjectRepository(WinbackContact) private readonly contacts: Repository<WinbackContact>,
    @InjectRepository(WinbackActivity) private readonly activities: Repository<WinbackActivity>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(RestaurantPlace) private readonly restaurantPlaces: Repository<RestaurantPlace>,
    private readonly matching: MatchingService,
  ) {}

  /**
   * Territories present in the pool, biggest first.
   *
   * Exists so a client never hardcodes a province list: the values come from the
   * ERP and do not all match the official names — Bangkok is stored as
   * `กรุงเทพฯ`, so a hand-typed `กรุงเทพมหานคร` would silently match nothing and
   * hide 59% of the customer base behind an empty screen.
   */
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
    // Exact match: the values come from the ERP, not from free text, so a LIKE
    // would only invite 'กรุงเทพ' to quietly also match 'กรุงเทพมหานคร'.
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

    // See poolOrderBy: unclaimed intake leads pin to the top of the default view,
    // because they arrive at inactive_days = 0 and would otherwise land on the
    // last page of a dormant-first list the UI offers no way to re-sort.
    poolOrderBy(q.sortKey, q.sortOrder).forEach(([expr, dir, nulls], i) =>
      i === 0 ? qb.orderBy(expr, dir, nulls) : qb.addOrderBy(expr, dir, nulls),
    );

    qb.skip((page - 1) * limit).take(limit);

    const [data, total] = await qb.getManyAndCount();
    const totalPages = Math.ceil(total / limit) || 1;
    // Win-back sales are internal staff, not the data subject or their
    // company owner — always masked here; full values go through the
    // audited POST /api/pii/reveal endpoint.
    const [placeById, photoById] = await Promise.all([
      this.loadRestaurantPlaceMap(
        data.map((a) => a.restaurant_place_id).filter(Boolean) as string[],
      ),
      this.loadLatestPhotoMap(data.map((a) => a.id)),
    ]);
    const enriched = data.map((a) => ({
      ...maskWinbackAccountPii(a),
      tmp_progress:
        a.lifecycle !== 'lead' ? deriveTmpProgressFromAccount(a) : null,
      restaurant_place: this.restaurantPlaceDetail(a, placeById),
      place_candidate: false,
      photo_url: photoById.get(a.id) ?? null,
    }));
    return { data: enriched, meta: { total, page, limit, totalPages } };
  }

  /**
   * Market Explorer places with no winback TMP yet — shown as unclaimed pool
   * rows with full GMap restaurantPlace (same shape as account detail).
   * Claim via POST /winback/leads/from-restaurant-place/:placeId.
   */
  private async findUnassignedPlaceCandidates(
    q: PoolQueryDto,
    page: number,
    limit: number,
  ) {
    const qb = this.placeCandidatesQuery();

    if (q.search?.trim()) {
      qb.andWhere('(p.name_th ILIKE :search OR p.name_en ILIKE :search)', {
        search: `%${q.search.trim()}%`,
      });
    }

    qb.orderBy('p.name_th', 'ASC', 'NULLS LAST').addOrderBy('p.name_en', 'ASC');

    const total = await qb.getCount();
    const rows = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const data = rows.map((place) => this.placeCandidateRow(place));
    const totalPages = Math.ceil(total / limit) || 1;
    return { data, meta: { total, page, limit, totalPages } };
  }

  /**
   * Market Explorer places nobody has turned into a lead yet — the rows the
   * "ยังไม่มีผู้ดูแล" tab shows alongside unassigned accounts (`place_candidate: true`).
   * One definition for the list and for `getCounts`.
   */
  private placeCandidatesQuery() {
    return this.restaurantPlaces.createQueryBuilder('p').where(
      `NOT EXISTS (
        SELECT 1 FROM winback_account wa
        WHERE wa.restaurant_place_id = p.id
      )`,
    );
  }

  private placeCandidateRow(place: RestaurantPlace) {
    const name = place.name_th ?? place.name_en ?? '';
    const lat = toNumberOrNull(place.lat);
    const lng = toNumberOrNull(place.lng);
    const detail = toDetail(place);
    return {
      id: null,
      customer_code: null,
      display_name: name,
      phone: null,
      restaurant_name: name,
      restaurant_place_id: place.id,
      address: place.district ? `เขต${place.district}` : null,
      location: place.district,
      lat,
      lng,
      cuisine_name: place.raw_category,
      lead_source: WinbackLeadSource.MARKET_EXPLORER,
      source: WinbackSource.MANUAL,
      health: WinbackHealth.DORMANT,
      stage: WinbackStage.PROSPECT,
      lifecycle: WinbackLifecycle.TMP,
      assigned_sales_user_id: null,
      photo_url: null,
      inactive_days: 0,
      activity_count: 0,
      visit_count: 0,
      tmp_progress: null,
      restaurant_place: detail,
      place_candidate: true,
    };
  }

  /**
   * Pool tab counts. `mine` = leads assigned to `salesUserId` (the caller), so
   * the "ของฉัน" tab can show a number without a second `GET /pool` round trip.
   * `placeCandidates` / `unassignedIncludingPlaces` back the "ยังไม่มีผู้ดูแล" tab,
   * which lists unassigned accounts plus Market Explorer places with no lead yet
   * (`GET /pool?assigned=unassigned&include_places=true`).
   */
  async getCounts(salesUserId?: string) {
    const placeCandidates = await this.placeCandidatesQuery().getCount();
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
      .getRawMany<{
        health: string;
        stage: string;
        source: string;
        lifecycle: string;
        unassigned: boolean;
        mine: boolean | null;
        count: string;
      }>();

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
    return {
      total,
      unassigned,
      placeCandidates,
      unassignedIncludingPlaces: unassigned + placeCandidates,
      mine,
      byHealth,
      byStage,
      bySource,
      byLifecycle,
    };
  }

  async getAccount(id: string) {
    const account = await this.accounts.findOne({ where: { id } });
    if (!account) throw new NotFoundException('winback account not found');

    let dirty = await this.reconcileJoshLink(account);

    const recentOrders = await this.orders
      .createQueryBuilder('o')
      .where('UPPER(TRIM(o.customer_code)) = :code', { code: account.customer_code })
      .orderBy('o.create_date', 'DESC')
      .limit(10)
      .getMany();

    const orderCount = await this.orders
      .createQueryBuilder('o')
      .where('UPPER(TRIM(o.customer_code)) = :code', { code: account.customer_code })
      .getCount();

    if (recentOrders[0]?.create_date) {
      const latest = new Date(recentOrders[0].create_date);
      if (!account.last_order_at || latest > new Date(account.last_order_at)) {
        account.last_order_at = latest;
        dirty = true;
      }
    }

    const user = account.josh_user_id
      ? await this.users.findOne({ where: { id: account.josh_user_id } })
      : null;
    const lastAppLoginAt = user?.last_app_login_at ?? null;

    if (promoteIfRegistered(account, { lastAppLoginAt })) dirty = true;
    if (dirty) await this.accounts.save(account);

    const company = account.josh_company_id
      ? await this.companies.findOne({ where: { id: account.josh_company_id } })
      : null;

    const contacts = await this.contacts.find({
      where: { account_id: id },
      order: { create_date: 'ASC' },
    });

    const upcoming = await this.activities.findOne({
      where: { account_id: id, status: 'planned' },
      order: { scheduled_at: 'ASC' },
    });

    const contactActs = await this.activities
      .createQueryBuilder('act')
      .where('act.account_id = :id', { id })
      .andWhere("act.status = 'done'")
      .andWhere("act.type IN ('call','cold_call','line','meeting','visit','store_visit')")
      .getCount();

    const ordered =
      orderCount >= 1 ||
      Boolean(account.last_order_at) ||
      ['won', 'reactivated', 'ordering_again', 'signed'].includes(account.stage);

    const appLoaded = account.lifecycle === 'lead' || Boolean(lastAppLoginAt);

    const tmp_progress = deriveTmpProgress({
      lifecycle: account.lifecycle,
      contactCount: contactActs,
      hasAppointment: Boolean(upcoming) || account.stage === 'appointment',
      appLoaded,
    });

    const maskedAccount = maskWinbackAccountPii(account);
    const maskedUserName = user ? maskPersonName(user.first_name, user.last_name) : null;
    const maskedContacts = contacts.map((c) => ({
      ...c,
      name: maskContactFullName(c.name),
      mobile: maskPhone(c.mobile),
      email: maskEmail(c.email),
    }));

    const placeById = account.restaurant_place_id
      ? await this.loadRestaurantPlaceMap([account.restaurant_place_id])
      : new Map<string, RestaurantPlace>();

    return {
      account: maskedAccount,
      restaurant_place: this.restaurantPlaceDetail(account, placeById),
      user: user
        ? {
            id: user.id,
            email: maskEmail(user.email),
            first_name: maskedUserName!.first_name,
            last_name: maskedUserName!.last_name,
            is_active: user.is_active,
            onboarding_completed: user.onboarding_completed,
            created_at: user.created_at,
          }
        : null,
      company: company ? { id: company.id, name: company.name } : null,
      recentOrders: recentOrders.map((o) => ({
        id: o.orders_id,
        customer_code: o.customer_code,
        create_date: o.create_date,
        status: o.status ?? null,
        total_price: o.total_price ?? null,
      })),
      contacts: maskedContacts,
      lead_status: deriveLeadStatus(account.stage),
      next_appointment: upcoming ?? null,
      contact_count: contactActs,
      tmp_progress,
      // manual promote: the same rule LeadService.promoteToLead enforces, so the
      // button can show what is missing before it is pressed
      can_promote: account.lifecycle !== 'lead' && promoteBlockers(account, contacts.length).length === 0,
      promote_blockers: account.lifecycle !== 'lead' ? promoteBlockers(account, contacts.length) : [],
      progress: {
        visited: (account.visit_count ?? 0) > 0,
        app_loaded: appLoaded,
        ordered,
        reordered: orderCount >= 2 || account.stage === 'ordering_again',
      },
    };
  }

  /** Pool row avatar: the last photo of the account's most recent activity that has one. */
  private async loadLatestPhotoMap(accountIds: string[]): Promise<Map<string, string>> {
    if (!accountIds.length) return new Map();
    const rows = await this.activities
      .createQueryBuilder('act')
      .select('DISTINCT ON (act.account_id) act.account_id', 'account_id')
      .addSelect('act.photo_urls ->> (jsonb_array_length(act.photo_urls) - 1)', 'photo_url')
      .where('act.account_id IN (:...ids)', { ids: accountIds })
      .andWhere("jsonb_typeof(act.photo_urls) = 'array' AND jsonb_array_length(act.photo_urls) > 0")
      .orderBy('act.account_id')
      .addOrderBy('act.activity_at', 'DESC')
      .getRawMany<{ account_id: string; photo_url: string | null }>();
    return new Map(rows.filter((r) => r.photo_url).map((r) => [r.account_id, r.photo_url!]));
  }

  private async loadRestaurantPlaceMap(ids: string[]): Promise<Map<string, RestaurantPlace>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await this.restaurantPlaces.find({ where: { id: In(unique) } });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private restaurantPlaceDetail(
    account: Pick<WinbackAccount, 'id' | 'customer_code' | 'restaurant_place_id'>,
    placeById: Map<string, RestaurantPlace>,
  ): RestaurantPlaceDetailDto | null {
    if (!account.restaurant_place_id) return null;
    const row = placeById.get(account.restaurant_place_id);
    if (!row) return null;
    return toDetail(row, {
      winbackLink: {
        id: account.id,
        restaurant_place_id: account.restaurant_place_id,
        customer_code: account.customer_code,
      },
    });
  }

  /**
   * Link Josh user/company when custcode or tax id (register_number) matches.
   * Returns true when the account row was mutated.
   */
  private async reconcileJoshLink(account: WinbackAccount): Promise<boolean> {
    let dirty = false;
    if (!account.josh_user_id) {
      const byCode = await this.matching.matchByCode(account.customer_code);
      if (byCode.josh_user_id || byCode.josh_company_id) {
        if (byCode.josh_user_id) account.josh_user_id = byCode.josh_user_id;
        if (byCode.josh_company_id) account.josh_company_id = byCode.josh_company_id;
        dirty = true;
      }
    }
    if (!account.josh_user_id && !account.josh_company_id) {
      const tax = account.register_number || account.company_registration_num;
      if (tax) {
        const byTax = await this.matching.matchByRegisterNumber(tax);
        if (byTax.josh_user_id || byTax.josh_company_id) {
          if (byTax.josh_user_id) account.josh_user_id = byTax.josh_user_id;
          if (byTax.josh_company_id) account.josh_company_id = byTax.josh_company_id;
          dirty = true;
        }
      }
    }
    return dirty;
  }

  /**
   * Open leads nobody has touched since they were created (`activity_count = 0`)
   * for at least `days`. One definition shared by the manager aging view and
   * the `winback_lead_aging` reminder so they can never disagree.
   */
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
}
