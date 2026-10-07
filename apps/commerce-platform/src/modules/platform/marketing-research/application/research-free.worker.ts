import { Injectable, Logger, Optional } from '@nestjs/common';
import { MarketingResearchService } from './marketing-research.service';
import {
  CatalogUnavailable,
  ResearchCatalogService,
} from './research-catalog.service';
import {
  FREE_RESEARCH_SOURCES,
  freeResearchEnabled,
  researchSourceStatus,
  type ResearchReport,
} from '../research.types';
import { ResearchSocialService } from './research-social.service';
import { SOCIAL_LABELS, type SocialSource } from './research-social.config';

/** In-process consumer uses the existing DB lease. External worker HTTP remains separately guarded. */
@Injectable()
export class ResearchFreeWorker {
  private readonly logger = new Logger(ResearchFreeWorker.name);
  private running = false;
  constructor(
    private readonly service: MarketingResearchService,
    private readonly catalogs: ResearchCatalogService,
    @Optional() private readonly social?: ResearchSocialService,
  ) {}

  async tick() {
    if (this.running) return;
    const supported = researchSourceStatus()
      .filter(
        (source) =>
          source.ready &&
          (FREE_RESEARCH_SOURCES.includes(source.id)
            ? freeResearchEnabled()
            : Boolean(this.social) && source.provider !== 'external-worker'),
      )
      .map((source) => source.id);
    if (!supported.length) return;
    this.running = true;
    try {
      // Bound each sweep; topic backlogs remain in the durable queue for the next minute.
      for (let count = 0; count < 2; count++) {
        const run = await this.service.claim(new Date(), supported);
        if (!run?.leaseToken) return;
        const report: Omit<ResearchReport, 'analysis'> = {
          summary: '',
          evidence: [],
          findings: [],
          suggestions: [
            'ตรวจหลักฐานและวันเผยแพร่ก่อนกดสรุปด้วย AI หรือส่งต่อทีมทำคอนเทนต์/ฝ่ายขาย',
          ],
          limitations: [
            'ค้นตามโจทย์และแหล่งที่เปิดใช้งาน ผลตัวอย่างไม่ยืนยันความต้องการซื้อ ราคา สต็อก หรือประกาศจัดซื้อ',
            'ข้อมูลเปิดเป็นฐานรายชื่อ ส่วน social/ข่าวเป็นตัวอย่างคอนเทนต์ ไม่รับรองว่าครอบคลุมเหตุการณ์ย้อนหลังทั้งหมด',
            'ข้อมูลแต่ละกลุ่มมีความครบต่างกัน จึงยังสรุปแนวโน้มหรือให้คะแนนถ่วงน้ำหนักเท่ากันทุกกลุ่มไม่ได้',
          ],
          coverage: [],
        };
        const summaries: string[] = [];
        const perSource = Math.max(
          1,
          Math.floor(
            50 /
              Math.max(
                1,
                run.scope.sources.filter((source) => supported.includes(source))
                  .length,
              ),
          ),
        );
        for (const source of run.scope.sources) {
          if (
            !supported.includes(source) ||
            !run.availableSources.includes(source)
          ) {
            report.coverage.push({
              source,
              status: 'unavailable',
              reason:
                researchSourceStatus().find((item) => item.id === source)
                  ?.reason || 'ตัวเชื่อมแหล่งนี้ไม่พร้อมใน worker ปัจจุบัน',
            });
            continue;
          }
          try {
            const result =
              source === 'tat' || source === 'osm'
                ? await this.catalogs.collect(source, run.scope)
                : await this.social!.collect(
                    source as SocialSource,
                    run.scope,
                    run.id,
                  );
            report.coverage.push({
              source,
              status: 'searched',
              from: result.observedAt,
              to: result.observedAt,
              ...(result.via ? { reason: result.via } : {}),
            });
            report.limitations.push(...result.limitations);
            const totals = result.groups
              .map(
                (group) =>
                  `${group.label} ${group.count} ${source === 'osm' ? 'elements' : 'รายการ'}`,
              )
              .join(', ');
            summaries.push(`${SOCIAL_LABELS[source]}: ${totals}`);
            // Each listed business cites the actual dataset record or OSM element; no model invents rows.
            for (const item of result.items.slice(0, perSource)) {
              if (report.findings.length >= 50) break;
              const id = `${source}:${item.id}`.slice(0, 80);
              report.evidence.push({
                id,
                source,
                url: item.url,
                excerpt: item.detail,
                collectedAt: result.observedAt,
                ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
              });
              report.findings.push({
                text: `${SOCIAL_LABELS[source]} · ${item.detail}`,
                evidenceIds: [id],
              });
            }
          } catch (error) {
            const reason =
              error instanceof CatalogUnavailable
                ? error.message
                : 'แหล่งข้อมูลไม่ตอบ กรุณาลองใหม่ภายหลัง';
            report.coverage.push({ source, status: 'unavailable', reason });
            report.limitations.push(`${source}: ${reason}`);
          }
        }
        try {
          if (!report.coverage.some((source) => source.status === 'searched')) {
            await this.service.fail(
              run.id,
              run.leaseToken,
              report.coverage
                .map((source) => `${source.source}: ${source.reason}`)
                .join(' · ')
                .slice(0, 1800),
            );
          } else {
            report.summary = `ผลค้นข้อมูลใน${run.scope.area}: ${summaries.join(' · ')} แสดง ${report.findings.length} รายการพร้อมหลักฐาน รายงานนี้เป็นข้อมูลตั้งต้นให้ทีมตรวจสอบและกดสรุปด้วย AI ไม่ยืนยันความต้องการซื้อหรือความนิยมของทั้งตลาด`;
            await this.service.finish(run.id, {
              ...report,
              leaseToken: run.leaseToken,
            });
          }
        } catch {
          this.logger.warn(
            'Research result was not saved; lease may have been cancelled or database is unavailable',
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
