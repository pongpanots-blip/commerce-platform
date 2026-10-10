import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { EVENT_BUS, IEventBus } from '../../../shared-kernel/interfaces/event-bus.interface';
import { CreateUserSegmentDto, UpdateUserSegmentDto } from './dto/user-segment.dto';
import { SegmentDefinition } from './dto/segment-definition.dto';
import { compileLegacyRule } from './legacy-rule.compiler';
import { UserSegmentRuleType } from './rule-type.enum';
import { isDeviceLevelSegment, isLiveSegment, isUuid, LIVE_RULE_TYPES, SEGMENT_BASE_FROM } from './segment-base';
import { SegmentDefinitionCompiler } from './segment-definition.compiler';
import { Segment, SegmentMember } from './segment.entity';
import { SegmentDeleted, SegmentMembers, SegmentUpserted, toSegmentPayload } from './segment-events';

/** Members per segment.members event (josh's DTO caps a part at 5000). */
export const MEMBERS_PART = 5000;

export const ownsSegments = () => process.env.COMMERCE_OWNS_SEGMENTS === 'true';

/**
 * Segments owned by commerce (stage 2a). Port of josh UserSegmentService's write side — create (frozen once, at
 * creation, never recomputed: coupon cost stays fixed), the edit lock, delete — over commerce's copies. Every write
 * publishes segment.* events in the same transaction so josh's user_segments / snapshots follow; reads (lists,
 * preview, members, promotion mappings) stay on josh's copy.
 */
@Injectable()
export class SegmentsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(EVENT_BUS) private readonly events: IEventBus,
    private readonly compiler: SegmentDefinitionCompiler,
  ) {}

  private assertOwned() {
    if (!ownsSegments()) throw new ConflictException('segment ยังเป็นของ josh — เปิด COMMERCE_OWNS_SEGMENTS เมื่อสลับแล้ว');
  }

  async findAll() {
    return { statusCode: 200, message: 'สำเร็จ', data: await this.db.getRepository(Segment).find({ order: { priority: 'DESC', slug: 'ASC' } }) };
  }

  /**
   * One customer against one segment, for commerce-run marketing workflows: frozen → its members; otherwise the
   * compiled rule over SEGMENT_BASE_FROM. Rules only josh can match (live / device-level) → false.
   */
  async userMatchesSegment(segmentId: string, userId: string, m: EntityManager = this.db.manager): Promise<boolean> {
    const segment = await m.getRepository(Segment).findOneBy({ id: segmentId });
    if (!segment || !segment.is_active || isLiveSegment(segment)) return false;
    if (segment.frozen_at) {
      return (await m.query(`SELECT 1 AS ok FROM segment_members WHERE segment_id = $1 AND user_id = $2 LIMIT 1`, [segmentId, userId])).length > 0;
    }
    if (!segment.definition && segment.rule_type === UserSegmentRuleType.MANUAL_USER_LIST) {
      const raw = segment.rule_config?.user_ids;
      if (!Array.isArray(raw) || !raw.includes(userId)) return false;
      return (await m.query(`SELECT 1 AS ok FROM segment_customers WHERE id = $1`, [userId])).length > 0;
    }
    const { where, params } = segment.definition
      ? this.compiler.compile(segment.definition as unknown as SegmentDefinition)
      : compileLegacyRule(segment.rule_type as UserSegmentRuleType, segment.rule_config);
    return (await m.query(`SELECT 1 AS ok ${SEGMENT_BASE_FROM} WHERE (${where}) AND u.id = $${params.length + 1} LIMIT 1`, [...params, userId])).length > 0;
  }

  /** Segments a commerce workflow may use as an audience (active, evaluable here). */
  async evaluableSegments(): Promise<{ id: string; name: string; memberCount: number | null }[]> {
    const rows = await this.db.getRepository(Segment).find({ where: { is_active: true }, order: { priority: 'DESC', name: 'ASC' } });
    return rows.filter((s) => !isLiveSegment(s)).map((s) => ({ id: s.id, name: s.name, memberCount: s.member_count }));
  }

  async findOne(id: string) {
    const segment = await this.db.getRepository(Segment).findOneBy({ id });
    if (!segment) throw new NotFoundException('User segment not found');
    return { statusCode: 200, message: 'สำเร็จ', data: segment };
  }

  async create(dto: CreateUserSegmentDto) {
    this.assertOwned();
    if (await this.db.getRepository(Segment).findOneBy({ slug: dto.slug })) throw new ConflictException(`Segment slug "${dto.slug}" already exists`);
    if (dto.definition) this.compiler.validate(dto.definition);
    const id = await this.db.transaction(async (m) => {
      const saved = await m.save(m.create(Segment, {
        slug: dto.slug, name: dto.name, description: dto.description ?? null, rule_type: dto.rule_type,
        rule_config: dto.rule_config ?? {}, definition: (dto.definition as unknown as Record<string, unknown>) ?? null,
        priority: dto.priority ?? 0, is_active: dto.is_active ?? true,
      }));
      const members = await this.freeze(m, saved);
      const frozen = await m.findOneByOrFail(Segment, { id: saved.id });
      // josh's snapshots reference user_segments: the segment row goes first, then its members.
      await this.events.publish(new SegmentUpserted(toSegmentPayload(frozen)), m);
      const frozenAt = frozen.frozen_at ? new Date(frozen.frozen_at).toISOString() : '';
      for (let i = 0, parts = Math.ceil(members.length / MEMBERS_PART); i < members.length; i += MEMBERS_PART) {
        await this.events.publish(new SegmentMembers({ segmentId: saved.id, frozenAt, part: i / MEMBERS_PART + 1, parts, userIds: members.slice(i, i + MEMBERS_PART) }), m);
      }
      return saved.id;
    });
    return { statusCode: 201, message: 'สำเร็จ', data: await this.db.getRepository(Segment).findOneBy({ id }) };
  }

  /** josh's edit lock: a frozen segment keeps its rules (make a new one); a live one may switch between live rules. */
  async update(id: string, dto: UpdateUserSegmentDto) {
    this.assertOwned();
    return this.db.transaction(async (m) => {
      const segment = await m.findOne(Segment, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!segment) throw new NotFoundException('User segment not found');
      const live = isLiveSegment(segment);
      const violatesLock = live
        ? dto.definition !== undefined || (dto.rule_type !== undefined && !LIVE_RULE_TYPES.includes(dto.rule_type))
        : dto.rule_type !== undefined || dto.rule_config !== undefined || dto.definition !== undefined;
      if (violatesLock) throw new BadRequestException('Segment ถูกล็อกรายชื่อแล้ว แก้เงื่อนไขไม่ได้ — สร้าง segment ใหม่แทน');
      Object.assign(segment, {
        name: dto.name ?? segment.name, description: dto.description ?? segment.description,
        rule_type: dto.rule_type ?? segment.rule_type, rule_config: dto.rule_config ?? segment.rule_config,
        priority: dto.priority ?? segment.priority, is_active: dto.is_active ?? segment.is_active,
      });
      const saved = await m.save(segment);
      await this.events.publish(new SegmentUpserted(toSegmentPayload(saved)), m);
      return { statusCode: 200, message: 'สำเร็จ', data: saved };
    });
  }

  async remove(id: string) {
    this.assertOwned();
    await this.db.transaction(async (m) => {
      const result = await m.delete(Segment, { id });
      if (!result.affected) throw new NotFoundException('User segment not found');
      await this.events.publish(new SegmentDeleted(id), m);
    });
    return { statusCode: 200, message: 'สำเร็จ', data: null };
  }

  /** What the segment would hold if frozen now (segment-parity against josh). Device-level → 0. */
  async countNow(id: string): Promise<number> {
    const segment = await this.db.getRepository(Segment).findOneBy({ id });
    if (!segment || isDeviceLevelSegment(segment)) return 0;
    return (await this.computeUserIds(segment, this.db.manager)).length;
  }

  /** Freeze a non-live segment once: store its members and count. Returns the member ids (empty for live). */
  private async freeze(m: EntityManager, segment: Segment): Promise<string[]> {
    if (segment.frozen_at || isLiveSegment(segment)) return [];
    const ids = await this.computeUserIds(segment, m);
    const frozenAt = new Date();
    for (let i = 0; i < ids.length; i += MEMBERS_PART) {
      await m.createQueryBuilder().insert().into(SegmentMember)
        .values(ids.slice(i, i + MEMBERS_PART).map((userId) => ({ segment_id: segment.id, user_id: userId, matched_at: frozenAt })))
        .orIgnore().execute();
    }
    await m.update(Segment, segment.id, { frozen_at: frozenAt, member_count: ids.length });
    return ids;
  }

  /** josh's computeLiveUserIds over commerce's base relation. */
  private async computeUserIds(segment: Segment, m: EntityManager): Promise<string[]> {
    if (segment.definition) {
      const { where, params } = this.compiler.compile(segment.definition as unknown as SegmentDefinition);
      return (await m.query(`SELECT u.id ${SEGMENT_BASE_FROM} WHERE ${where} ORDER BY u.id`, params)).map((r: { id: string }) => r.id);
    }
    if (segment.rule_type === UserSegmentRuleType.MANUAL_USER_LIST) {
      const raw = segment.rule_config?.user_ids;
      const candidates = (Array.isArray(raw) ? raw : []).filter((id): id is string => typeof id === 'string' && isUuid(id));
      if (!candidates.length) return [];
      const existing = new Set((await m.query(`SELECT id FROM segment_customers WHERE id = ANY($1::uuid[])`, [candidates])).map((r: { id: string }) => r.id));
      return [...new Set(candidates.filter((id) => existing.has(id)))];
    }
    const { where, params } = compileLegacyRule(segment.rule_type as UserSegmentRuleType, segment.rule_config);
    return (await m.query(`SELECT u.id ${SEGMENT_BASE_FROM} WHERE ${where} ORDER BY u.id`, params)).map((r: { id: string }) => r.id);
  }
}
