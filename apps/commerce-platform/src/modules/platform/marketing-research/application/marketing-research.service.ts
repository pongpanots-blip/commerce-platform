import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { MarketingResearchTopic as Topic } from '../infrastructure/marketing-research-topic.entity';
import { MarketingResearchRun as Run } from '../infrastructure/marketing-research-run.entity';
import {
  CompleteResearchRunDto,
  CreateResearchTopicDto,
  ResearchListDto,
  UpdateResearchTopicDto,
} from '../dto/research.dto';
import {
  researchSourceStatus,
  type ResearchActor,
  type ResearchReport,
  type ResearchScope,
  type ResearchSource,
} from '../research.types';

const HOUR = 60 * 60 * 1000;
const LEASE = 15 * 60 * 1000;
const ADMIN_ROLES = new Set(['admin']);

@Injectable()
export class MarketingResearchService {
  constructor(private readonly db: DataSource) {}

  sources() {
    return researchSourceStatus();
  }
  private canManage(topic: Topic, actor: ResearchActor) {
    return topic.createdBy === actor.sub || ADMIN_ROLES.has(actor.role);
  }
  private assertManage(topic: Topic, actor: ResearchActor) {
    if (!this.canManage(topic, actor))
      throw new ForbiddenException(
        'เฉพาะเจ้าของโจทย์หรือ admin เท่านั้นที่แก้ไขหรือรันโจทย์นี้ได้',
      );
  }
  private async topic(manager: EntityManager, id: string, lock = false) {
    const topic = await manager.findOne(Topic, {
      where: { id },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!topic) throw new NotFoundException('ไม่พบโจทย์ Research');
    return topic;
  }
  private snapshot(topic: Topic): ResearchScope {
    const { title, kind, area, days, sector, sources } = topic;
    return { title, kind, area, days, sector, sources };
  }
  async list(query: ResearchListDto, actor: ResearchActor) {
    const [items, totalCount] = await this.db.manager.findAndCount(Topic, {
      where: {
        archivedAt: IsNull(),
        ...(query.kind ? { kind: query.kind } : {}),
      },
      order: { updatedAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return {
      items: items.map((topic) => ({
        ...topic,
        canManage: this.canManage(topic, actor),
      })),
      totalCount,
      page: query.page,
      limit: query.limit,
    };
  }
  async detail(id: string, actor: ResearchActor) {
    const topic = await this.topic(this.db.manager, id);
    return {
      ...topic,
      canManage: this.canManage(topic, actor),
      sourceStatus: this.sources().filter((source) =>
        topic.sources.includes(source.id),
      ),
    };
  }
  async create(dto: CreateResearchTopicDto, actor: ResearchActor) {
    const { requestId, ...fields } = dto;
    const values = {
      ...fields,
      createdBy: actor.sub,
      nextRunAt: dto.followHourly ? new Date() : null,
    };
    if (!requestId)
      return this.db.manager.save(Topic, this.db.manager.create(Topic, values));
    return this.db.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .insert()
        .into(Topic)
        .values({ ...values, id: requestId })
        .orIgnore()
        .execute();
      const topic = await this.topic(manager, requestId);
      if (
        topic.createdBy !== actor.sub ||
        topic.archivedAt ||
        !isDeepStrictEqual(
          { ...this.snapshot(topic), followHourly: topic.followHourly },
          fields,
        )
      ) {
        throw new ConflictException(
          'requestId นี้ถูกใช้งานแล้ว กรุณาโหลดคลังใหม่ก่อนบันทึก',
        );
      }
      return topic;
    });
  }
  async update(id: string, dto: UpdateResearchTopicDto, actor: ResearchActor) {
    return this.db.transaction(async (manager) => {
      const topic = await this.topic(manager, id, true);
      this.assertManage(topic, actor);
      if (topic.archivedAt)
        throw new ConflictException('โจทย์นี้ถูกเก็บเข้าประวัติแล้ว');
      if (topic.version !== dto.version)
        throw new ConflictException(
          'โจทย์ถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่ก่อนบันทึก',
        );
      await this.cancelActive(
        manager,
        id,
        'ยกเลิกเพราะโจทย์หรือความถี่ถูกแก้ไข',
      );
      Object.assign(topic, dto, {
        version: topic.version + 1,
        nextRunAt: dto.followHourly ? new Date() : null,
      });
      return manager.save(topic);
    });
  }
  async archive(id: string, version: number, actor: ResearchActor) {
    return this.db.transaction(async (manager) => {
      const topic = await this.topic(manager, id, true);
      this.assertManage(topic, actor);
      if (topic.archivedAt) return topic;
      if (topic.version !== version)
        throw new ConflictException('โจทย์ถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่');
      await this.cancelActive(manager, id, 'โจทย์ถูกเก็บเข้าประวัติ');
      Object.assign(topic, {
        archivedAt: new Date(),
        followHourly: false,
        nextRunAt: null,
        version: topic.version + 1,
      });
      return manager.save(topic);
    });
  }
  private async cancelActive(
    manager: EntityManager,
    topicId: string,
    message: string,
  ) {
    await manager.update(
      Run,
      { topicId, status: In(['queued', 'running']) },
      {
        status: 'cancelled',
        message,
        finishedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
      },
    );
  }
  private async enqueue(
    manager: EntityManager,
    topic: Topic,
    requestKey: string,
    requestedBy: string | null,
  ) {
    const previous = await manager.findOneBy(Run, {
      topicId: topic.id,
      requestKey,
    });
    if (previous) return previous;
    const active = await manager.findOneBy(Run, {
      topicId: topic.id,
      status: In(['queued', 'running']),
    });
    if (active)
      throw new ConflictException('โจทย์นี้มีงานรอหรือกำลังทำงานอยู่แล้ว');
    const availableSources = this.sources()
      .filter((source) => source.ready && topic.sources.includes(source.id))
      .map((source) => source.id);
    const ready = availableSources.length > 0;
    return manager.save(
      Run,
      manager.create(Run, {
        topicId: topic.id,
        requestKey,
        requestedBy,
        topicVersion: topic.version,
        scope: this.snapshot(topic),
        availableSources,
        status: ready ? 'queued' : 'waiting_configuration',
        message: ready
          ? ''
          : 'แหล่งข้อมูลที่เลือกยังไม่เชื่อม เพิ่ม ททท. หรือ OpenStreetMap ให้โจทย์แล้วรันใหม่เพื่อค้นจากฐานข้อมูลฟรี',
        finishedAt: ready ? null : new Date(),
      }),
    );
  }
  async requestRun(id: string, requestId: string, actor: ResearchActor) {
    return this.db.transaction(async (manager) => {
      const topic = await this.topic(manager, id, true);
      this.assertManage(topic, actor);
      if (topic.archivedAt)
        throw new ConflictException('ไม่สามารถรันโจทย์ที่ถูกเก็บเข้าประวัติ');
      return this.enqueue(manager, topic, `manual-${requestId}`, actor.sub);
    });
  }
  async runs(id: string, query: ResearchListDto) {
    await this.topic(this.db.manager, id);
    const [items, totalCount] = await this.db.manager.findAndCount(Run, {
      where: { topicId: id },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: [
        'id',
        'topicId',
        'topicVersion',
        'status',
        'message',
        'attempts',
        'findingsCount',
        'keptBy',
        'keptAt',
        'createdAt',
        'finishedAt',
      ],
    });
    return { items, totalCount, page: query.page, limit: query.limit };
  }
  async runDetail(id: string) {
    const run = await this.db.manager.findOneBy(Run, { id });
    if (!run) throw new NotFoundException('ไม่พบงาน Research');
    return run;
  }
  async keep(id: string, actor: ResearchActor) {
    await this.db.manager
      .createQueryBuilder()
      .update(Run)
      .set({ keptBy: actor.sub, keptAt: new Date() })
      .where('id = :id AND report IS NOT NULL AND "keptAt" IS NULL', { id })
      .execute();
    const run = await this.runDetail(id);
    if (!run.report) throw new ConflictException('ยังไม่มีรายงานให้เก็บ');
    return run;
  }

  /** ponytail: single-instance queue; add distributed lock if scales to multi-instance. */
  async queueDue(now = new Date()) {
    return this.db.transaction(async (manager) => {
      const topics = await manager
        .createQueryBuilder(Topic, 'topic')
        .where(
          'topic."followHourly" = true AND topic."archivedAt" IS NULL AND topic."nextRunAt" <= :now',
          { now },
        )
        .orderBy('topic."nextRunAt"', 'ASC')
        .take(100)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();
      for (const topic of topics) {
        const ready = this.sources().some(
          (source) => source.ready && topic.sources.includes(source.id),
        );
        const blocked =
          !ready &&
          (await manager.findOneBy(Run, {
            topicId: topic.id,
            topicVersion: topic.version,
            status: 'waiting_configuration',
          }));
        const active = await manager.findOneBy(Run, {
          topicId: topic.id,
          status: In(['queued', 'running']),
        });
        if (!blocked && !active)
          await this.enqueue(
            manager,
            topic,
            `hour-${topic.version}-${Math.floor(now.getTime() / HOUR)}`,
            null,
          );
        topic.nextRunAt = new Date(now.getTime() + HOUR);
        await manager.save(topic);
      }
      return topics.length;
    });
  }

  async claim(now = new Date(), supportedSources?: ResearchSource[]) {
    return this.db.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .update(Run)
        .set({
          status: 'failed',
          message: 'worker หมดเวลาครบ 3 ครั้ง กรุณารันใหม่',
          finishedAt: now,
          leaseToken: null,
          leaseExpiresAt: null,
        })
        .where(
          'status = :status AND "leaseExpiresAt" <= :now AND attempts >= 3',
          { status: 'running', now },
        )
        .execute();
      const query = manager
        .createQueryBuilder(Run, 'run')
        .addSelect('run.leaseToken')
        .where(
          '(run.status = :queued OR (run.status = :running AND run."leaseExpiresAt" <= :now AND run.attempts < 3))',
          { queued: 'queued', running: 'running', now },
        )
        .orderBy('run."createdAt"', 'ASC')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked');
      if (supportedSources) {
        query.andWhere(
          'run."availableSources" ?| CAST(:supportedSources AS text[])',
          { supportedSources },
        );
      }
      const run = await query.getOne();
      if (!run) return null;
      const ready = new Set(
        this.sources()
          .filter((source) => source.ready)
          .map((source) => source.id),
      );
      run.availableSources = run.availableSources.filter((source) =>
        ready.has(source),
      );
      if (!run.availableSources.length) {
        Object.assign(run, {
          status: 'waiting_configuration',
          message: 'worker หรือ connector ถูกปิดใช้งาน',
          finishedAt: now,
          leaseToken: null,
          leaseExpiresAt: null,
        });
        await manager.save(run);
        return null;
      }
      const leaseToken = randomUUID();
      Object.assign(run, {
        status: 'running',
        attempts: run.attempts + 1,
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + LEASE),
      });
      const saved = await manager.save(run);
      return { ...saved, leaseToken };
    });
  }
  private async leased(
    manager: EntityManager,
    id: string,
    token: string,
    allowCompleted = false,
  ) {
    const run = await manager
      .createQueryBuilder(Run, 'run')
      .addSelect('run.leaseToken')
      .where('run.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
    if (!run) throw new NotFoundException('ไม่พบงาน Research');
    if (
      allowCompleted &&
      (run.status === 'completed' || run.status === 'partial') &&
      run.leaseToken === token
    )
      return run;
    if (
      run.status !== 'running' ||
      run.leaseToken !== token ||
      !run.leaseExpiresAt ||
      run.leaseExpiresAt.getTime() <= Date.now()
    ) {
      throw new ConflictException('สิทธิ์ worker หมดอายุหรืองานถูกยกเลิกแล้ว');
    }
    return run;
  }
  async heartbeat(id: string, token: string) {
    return this.db.transaction(async (manager) => {
      const run = await this.leased(manager, id, token);
      run.leaseExpiresAt = new Date(Date.now() + LEASE);
      await manager.save(run);
      return { id: run.id, leaseExpiresAt: run.leaseExpiresAt };
    });
  }
  async finish(id: string, dto: CompleteResearchRunDto) {
    return this.db.transaction(async (manager) => {
      const run = await this.leased(manager, id, dto.leaseToken, true);
      if (run.status === 'completed' || run.status === 'partial')
        return { id: run.id, status: run.status };
      const { leaseToken: _token, ...report } = dto;
      const status = this.validateReport(run, report);
      Object.assign(run, {
        report,
        status,
        findingsCount: report.findings.length,
        finishedAt: new Date(),
        leaseExpiresAt: null,
        message: '',
      });
      await manager.save(run);
      return { id: run.id, status: run.status };
    });
  }
  async fail(id: string, token: string, message: string) {
    return this.db.transaction(async (manager) => {
      const run = await this.leased(manager, id, token);
      Object.assign(run, {
        status: 'failed',
        message,
        finishedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
      });
      await manager.save(run);
      return { id: run.id, status: run.status };
    });
  }
  private validateReport(
    run: Run,
    report: ResearchReport,
  ): 'completed' | 'partial' {
    const coverage = new Map(
      report.coverage.map((item) => [item.source, item]),
    );
    if (
      coverage.size !== report.coverage.length ||
      coverage.size !== run.scope.sources.length ||
      run.scope.sources.some((source) => !coverage.has(source))
    ) {
      throw new BadRequestException(
        'ต้องระบุ coverage ทุกแหล่งที่ร้องขอโดยไม่ซ้ำ',
      );
    }
    const searched = report.coverage.filter(
      (item) => item.status === 'searched',
    );
    if (!searched.length)
      throw new BadRequestException(
        'ไม่มีแหล่งที่ค้นจริง ให้ส่งสถานะ failed แทนรายงาน',
      );
    let partial = false;
    const periodStart = run.createdAt.getTime() - run.scope.days * 24 * HOUR;
    for (const item of report.coverage) {
      if (item.status === 'unavailable') {
        if (!item.reason?.trim())
          throw new BadRequestException('แหล่งที่เข้าไม่ถึงต้องระบุเหตุผล');
        partial = true;
        continue;
      }
      const from = Date.parse(item.from ?? '');
      const to = Date.parse(item.to ?? '');
      if (
        !run.availableSources.includes(item.source) ||
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        from > to ||
        to > Date.now() + 60_000
      ) {
        throw new BadRequestException(
          'coverage ต้องมีช่วงเวลาที่ถูกต้องและเป็นแหล่งที่เปิดใช้งาน',
        );
      }
      if (from > periodStart || to < run.createdAt.getTime()) partial = true;
    }
    const ids = new Set(report.evidence.map((item) => item.id));
    if (ids.size !== report.evidence.length)
      throw new BadRequestException('รหัสหลักฐานต้องไม่ซ้ำ');
    for (const item of report.evidence) {
      if (
        coverage.get(item.source)?.status !== 'searched' ||
        Date.parse(item.collectedAt) > Date.now() + 60_000
      )
        throw new BadRequestException(
          'หลักฐานต้องมาจากแหล่งที่ค้นจริงและระบุเวลาเก็บที่ถูกต้อง',
        );
    }
    if (
      report.findings.some(
        (item) =>
          !item.evidenceIds.length ||
          item.evidenceIds.some((id) => !ids.has(id)),
      )
    ) {
      throw new BadRequestException(
        'ข้อค้นพบทุกข้อจำเป็นต้องอ้างอิงหลักฐานที่มีอยู่จริง',
      );
    }
    if (partial && !report.limitations.some((item) => item.trim()))
      throw new BadRequestException('รายงานที่ข้อมูลไม่ครบต้องระบุข้อจำกัด');
    return partial ? 'partial' : 'completed';
  }
}
