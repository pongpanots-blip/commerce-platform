import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackContact } from './entities/winback-contact.entity';
import { JoshUser as User } from './josh-replica-tables';
import { JoshRestaurantPlace as RestaurantPlace } from './josh-replica-tables';
import { MatchingService } from './matching.service';
import { normalizeCustomerCode } from './winback.helpers';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import {
  WinbackBusinessSize,
  WinbackCustomerType,
  WinbackHealth,
  WinbackLeadSource,
  WinbackSource,
  WinbackStage,
} from './winback.enums';
import { lifecycleAtCapture, promoteBlockerLabel, promoteBlockers, promoteManually } from './lifecycle.helpers';
import { isWinbackManager, WINBACK_ASSIGNABLE_ROLES } from './winback-roles';
import { generateTmpCustomerCode } from './intake.service';
import { toNumberOrNull } from './restaurant-place/restaurant-place.helpers';
import { NotificationService } from './shared/notification.service';
import { maskWinbackAccountPii, rejectMaskedPiiValues } from './winback-pii.helpers';

const maskAccountPii = maskWinbackAccountPii;

// Lead columns a caller may set/patch (contacts are managed via the contact endpoints).
const LEAD_FIELDS = [
  'display_name',
  'phone',
  'register_number',
  'customer_type',
  'lead_source',
  'location',
  'company_registration_num',
  'id_card_number',
  'company_name',
  'restaurant_name',
  'address',
  'lat',
  'lng',
  'cuisine_id',
  'cuisine_name',
  'cuisine_parent_id',
  'cuisine_parent_name',
  'business_size',
  'branch_count',
  'email',
  'line_id',
  'whatsapp',
  'wongnai_url',
  'operation_hours',
  'assigned_sales_user_id',
  'restaurant_place_id',
] as const;

export interface AssignActor {
  salesUserId: string;
  role: string;
}

/**
 * Changing `customer_type` must bring the matching identity fields, either in
 * the same request or already stored — a bare type change would leave the
 * lead half-filled. Plain edits (type not in the request) are never blocked,
 * so a Market Explorer lead (company, no registration number yet) can still
 * have its phone patched. PartialType made every DTO rule optional, so the
 * DTO alone cannot express this.
 */
export function assertIdentityPairOnTypeChange(
  stored: Pick<WinbackAccount, 'customer_type' | 'company_name' | 'company_registration_num' | 'id_card_number'>,
  dto: UpdateLeadDto,
): void {
  if (dto.customer_type === undefined || dto.customer_type === stored.customer_type) return;
  const has = (key: 'company_name' | 'company_registration_num' | 'id_card_number') => {
    const incoming = dto[key];
    if (incoming !== undefined) return typeof incoming === 'string' && incoming.trim() !== '';
    const current = stored[key];
    return typeof current === 'string' && current.trim() !== '';
  };
  const required: Array<'company_name' | 'company_registration_num' | 'id_card_number'> =
    dto.customer_type === WinbackCustomerType.B2B_COMPANY
      ? ['company_name', 'company_registration_num']
      : ['id_card_number'];
  const missing = required.filter((key) => !has(key));
  if (missing.length) {
    throw new BadRequestException(
      `เปลี่ยน customer_type เป็น ${dto.customer_type} ต้องส่ง ${missing.join(', ')} มาด้วย`,
    );
  }
}

@Injectable()
export class LeadService {
  constructor(
    @InjectRepository(WinbackAccount) private readonly accounts: Repository<WinbackAccount>,
    @InjectRepository(WinbackContact) private readonly contacts: Repository<WinbackContact>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(RestaurantPlace) private readonly restaurantPlaces: Repository<RestaurantPlace>,
    private readonly matching: MatchingService,
    private readonly notifications: NotificationService,
  ) {}

  private readonly logger = new Logger(LeadService.name);

  async listSalesUsers(search?: string): Promise<
    Array<{ id: string; email: string; name: string; role: string }>
  > {
    const qb = this.users
      .createQueryBuilder('u')
      .select(['u.id', 'u.email', 'u.first_name', 'u.last_name', 'u.role'])
      // app_roles is the source of truth for "internal"; the role list alone
      // once let a customer-side role through (see winback-roles.ts).
      .innerJoin('app_roles', 'r', "r.code = u.role AND r.user_type = 'internal'")
      .where('u.role IN (:...roles)', { roles: [...WINBACK_ASSIGNABLE_ROLES] })
      .andWhere('u.is_active = true')
      .orderBy('u.first_name', 'ASC')
      .addOrderBy('u.email', 'ASC')
      .take(100);

    if (search?.trim()) {
      const s = `%${search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(u.email) LIKE :s OR LOWER(u.first_name) LIKE :s OR LOWER(u.last_name) LIKE :s)',
        { s },
      );
    }

    const rows = await qb.getMany();
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email,
      role: u.role,
    }));
  }

  async create(salesUserId: string, dto: CreateLeadDto): Promise<WinbackAccount> {
    const code = normalizeCustomerCode(
      dto.customer_code || `LEAD-${dto.phone || dto.restaurant_name || dto.display_name}`,
    );
    const existing = await this.accounts.findOne({ where: { customer_code: code } });
    if (existing) throw new ConflictException('มี lead รหัสนี้อยู่แล้ว');

    let joshUserId: string | null = null;
    let joshCompanyId: string | null = null;
    if (dto.customer_code) {
      const link = await this.matching.matchByCode(code);
      joshUserId = link.matchCount === 1 ? link.josh_user_id : null;
      joshCompanyId = link.matchCount === 1 ? link.josh_company_id : null;
    }

    const account = await this.accounts.save(
      this.accounts.create({
        customer_code: code,
        display_name: dto.restaurant_name || dto.display_name,
        phone: dto.phone ?? null,
        register_number: dto.register_number ?? null,
        customer_type: dto.customer_type ?? null,
        lead_source: dto.lead_source ?? null,
        location: dto.location ?? null,
        company_registration_num: dto.company_registration_num ?? null,
        id_card_number: dto.id_card_number ?? null,
        company_name: dto.company_name ?? null,
        restaurant_name: dto.restaurant_name ?? dto.display_name ?? null,
        address: dto.address ?? null,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        cuisine_id: dto.cuisine_id ?? null,
        cuisine_name: dto.cuisine_name ?? null,
        cuisine_parent_id: dto.cuisine_parent_id ?? null,
        cuisine_parent_name: dto.cuisine_parent_name ?? null,
        business_size: dto.business_size ?? null,
        branch_count: dto.branch_count ?? null,
        email: dto.email ?? null,
        line_id: dto.line_id ?? null,
        whatsapp: dto.whatsapp ?? null,
        wongnai_url: dto.wongnai_url ?? null,
        operation_hours: dto.operation_hours ?? null,
        source: joshUserId ? WinbackSource.BOTH : WinbackSource.MANUAL,
        josh_user_id: joshUserId,
        josh_company_id: joshCompanyId,
        health: WinbackHealth.DORMANT,
        stage: WinbackStage.PROSPECT,
        lifecycle: lifecycleAtCapture(),
        promoted_to_lead_at: null,
        inactive_days: 0,
        activity_count: 0,
        visit_count: 0,
        created_by_sales_user_id: salesUserId || null,
        assigned_sales_user_id: salesUserId || null,
        assigned_at: salesUserId ? new Date() : null,
      }),
    );

    if (dto.contacts?.length) {
      await this.contacts.save(
        dto.contacts.map((c) =>
          this.contacts.create({
            account_id: account.id,
            team: c.team,
            name: c.name,
            role_label: c.role_label ?? null,
            mobile: c.mobile ?? null,
            email: c.email ?? null,
            line_id: c.line_id ?? null,
            whatsapp: c.whatsapp ?? null,
          }),
        ),
      );
    }

    return maskAccountPii(account);
  }

  /**
   * Create a TMP lead pre-filled from Market Explorer restaurant_place data.
   * Contact fields stay empty — sales completes them on the account screen.
   */
  async createTmpFromRestaurantPlace(
    salesUserId: string,
    placeId: string,
  ): Promise<WinbackAccount> {
    const place = await this.restaurantPlaces.findOne({ where: { id: placeId } });
    if (!place) throw new NotFoundException('ไม่พบร้านใน Market Explorer');

    const existing = await this.accounts.findOne({
      where: { restaurant_place_id: placeId },
    });
    if (existing) {
      throw new ConflictException(
        `มี tmp lead จากร้านนี้แล้ว (${existing.customer_code})`,
      );
    }

    const name = place.name_th ?? place.name_en ?? 'ร้านอาหาร';
    const lat = toNumberOrNull(place.lat);
    const lng = toNumberOrNull(place.lng);

    const saved = await this.accounts.save(
      this.accounts.create({
        customer_code: generateTmpCustomerCode(),
        display_name: name,
        restaurant_name: name,
        phone: null,
        address: place.district ? `เขต${place.district}` : null,
        location: place.district,
        lat,
        lng,
        cuisine_name: place.raw_category,
        lead_source: WinbackLeadSource.MARKET_EXPLORER,
        customer_type: WinbackCustomerType.B2B_COMPANY,
        business_size: WinbackBusinessSize.STANDALONE,
        source: WinbackSource.MANUAL,
        health: WinbackHealth.DORMANT,
        stage: WinbackStage.PROSPECT,
        lifecycle: lifecycleAtCapture(),
        promoted_to_lead_at: null,
        inactive_days: 0,
        activity_count: 0,
        visit_count: 0,
        restaurant_place_id: place.id,
        // Stay unassigned so the lead sits in the unclaimed pool for any rep.
        assigned_sales_user_id: null,
        created_by_sales_user_id: salesUserId || null,
        wongnai_url:
          lat != null && lng != null
            ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
            : null,
      }),
    );
    return maskAccountPii(saved);
  }

  async update(id: string, dto: UpdateLeadDto, actor?: AssignActor): Promise<WinbackAccount> {
    const account = await this.accounts.findOne({ where: { id } });
    if (!account) throw new NotFoundException('winback account not found');

    if (dto.assigned_sales_user_id !== undefined && actor) {
      this.assertCanAssign(actor, dto.assigned_sales_user_id);
    }
    rejectMaskedPiiValues(dto as unknown as Record<string, unknown>);
    assertIdentityPairOnTypeChange(account, dto);

    const previousOwner = account.assigned_sales_user_id;
    const patch = dto as unknown as Record<string, unknown>;
    const target = account as unknown as Record<string, unknown>;
    for (const key of LEAD_FIELDS) {
      if (patch[key] !== undefined) target[key] = patch[key];
    }
    // keep the list label in sync with the restaurant name
    if (dto.restaurant_name !== undefined) account.display_name = dto.restaurant_name || account.display_name;
    // The owner clock restarts whenever the owner changes — a manager assigning,
    // a rep self-claiming from the pool, a reassignment, or a return to the pool
    // (NULL owner, no clock). All four reach this method, so the rule lives here
    // and only here. Reassigning to the same rep is not a change and must not
    // reset it, which is why this compares owners rather than keying off the DTO.
    if (account.assigned_sales_user_id !== previousOwner) {
      account.assigned_at = account.assigned_sales_user_id ? new Date() : null;
    }
    const saved = await this.accounts.save(account);
    await this.notifyAssigned(saved, previousOwner, actor);
    return maskAccountPii(saved);
  }

  /**
   * Tell the new owner a lead landed on their plate. Fires only when the owner
   * actually changed to someone other than the actor — a rep claiming a lead
   * for themselves already knows. Never fails the update.
   */
  private async notifyAssigned(
    account: WinbackAccount,
    previousOwner: string | null,
    actor?: AssignActor,
  ): Promise<void> {
    const owner = account.assigned_sales_user_id;
    if (!owner || owner === previousOwner || owner === actor?.salesUserId) return;
    try {
      await this.notifications.dispatch({
        userId: owner,
        type: 'winback_lead_assigned',
        category: 'winback',
        data: {
          account_id: account.id,
          customer_code: account.customer_code,
          restaurant_name: account.restaurant_name ?? account.display_name,
          assigned_by_sales_user_id: actor?.salesUserId ?? null,
        },
        dedupeKey: `winback_lead_assigned:${account.id}:${owner}`,
      });
    } catch (err) {
      this.logger.warn(`Failed to notify lead assignment ${account.id} → ${owner}: ${String(err)}`);
    }
  }

  /** Manual: ยืนยันสมัครแอปแล้ว → promote TMP → Lead. */
  async promoteToLead(id: string): Promise<WinbackAccount> {
    const account = await this.accounts.findOne({ where: { id } });
    if (!account) throw new NotFoundException('winback account not found');
    const contactCount = await this.contacts.count({ where: { account_id: id } });
    const missing = promoteBlockers(account, contactCount);
    if (missing.length) {
      throw new BadRequestException(
        `ลูกค้ารายนี้ยังกรอกข้อมูลไม่ครบ: ${missing.map(promoteBlockerLabel).join(', ')}`,
      );
    }
    promoteManually(account);
    const saved = await this.accounts.save(account);
    return maskAccountPii(saved);
  }

  private assertCanAssign(actor: AssignActor, targetId: string | null) {
    if (isWinbackManager(actor.role)) return;
    // Sales may only self-claim (or clear is not allowed)
    if (targetId === null || targetId !== actor.salesUserId) {
      throw new ForbiddenException('เฉพาะ manager ที่สามารถมอบหมาย lead ให้คนอื่นได้');
    }
  }

  /** Resolve display info for assigned owner ids (pool / account labels). */
  async mapOwnerLabels(
    ids: string[],
  ): Promise<Map<string, { email: string; name: string }>> {
    const unique = [...new Set(ids.filter(Boolean))];
    const map = new Map<string, { email: string; name: string }>();
    if (!unique.length) return map;
    const users = await this.users.find({ where: { id: In(unique) } });
    for (const u of users) {
      map.set(u.id, {
        email: u.email,
        name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email,
      });
    }
    return map;
  }
}
