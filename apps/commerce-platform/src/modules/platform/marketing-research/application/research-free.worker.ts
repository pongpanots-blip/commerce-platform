import { Injectable, Logger } from '@nestjs/common';
import { MarketingResearchService } from './marketing-research.service';
import {
  CatalogUnavailable,
  ResearchCatalogService,
} from './research-catalog.service';
import {
  FREE_RESEARCH_SOURCES,
  freeResearchEnabled,
  type ResearchReport,
} from '../research.types';

/** In-process consumer uses the existing DB lease. External worker HTTP remains separately guarded. */
@Injectable()
export class ResearchFreeWorker {
  private readonly logger = new Logger(ResearchFreeWorker.name);
  private running = false;
  constructor(
    private readonly service: MarketingResearchService,
    private readonly catalogs: ResearchCatalogService,
  ) {}

  async tick() {
    if (this.running || !freeResearchEnabled()) return;
    this.running = true;
    try {
      // Bound each sweep; topic backlogs remain in the durable queue for the next minute.
      for (let count = 0; count < 2; count++) {
        const run = await this.service.claim(new Date(), FREE_RESEARCH_SOURCES);
        if (!run?.leaseToken) return;
        const report: ResearchReport = {
          summary: '',
          evidence: [],
          findings: [],
          suggestions: [
            'ตรวจชื่อ ที่ตั้งและช่องทางติดต่อกับธุรกิจก่อนส่งต่อฝ่ายขาย',
          ],
          limitations: [
            'ค้นตามพื้นที่และกลุ่มลูกค้าที่เลือก ยังไม่วิเคราะห์คำถามอิสระด้วย AI และไม่ยืนยันความต้องการซื้อ ราคา สต็อก หรือประกาศจัดซื้อ',
            'ฐานรายชื่อไม่ครอบคลุมเหตุการณ์ย้อนหลังตามจำนวนวันที่ขอ จำนวนจากต่างแหล่งอาจมีธุรกิจซ้ำกัน',
            'ข้อมูลแต่ละกลุ่มมีความครบต่างกัน จึงยังสรุปแนวโน้มหรือให้คะแนนถ่วงน้ำหนักเท่ากันทุกกลุ่มไม่ได้',
          ],
          coverage: [],
        };
        const summaries: string[] = [];
        for (const source of run.scope.sources) {
          if (
            (source !== 'tat' && source !== 'osm') ||
            !run.availableSources.includes(source)
          ) {
            report.coverage.push({
              source,
              status: 'unavailable',
              reason: 'แหล่งนี้ยังไม่เชื่อมในระบบค้นข้อมูลฟรี',
            });
            continue;
          }
          try {
            const result = await this.catalogs.collect(source, run.scope);
            report.coverage.push({
              source,
              status: 'searched',
              from: result.observedAt,
              to: result.observedAt,
            });
            report.limitations.push(...result.limitations);
            const totals = result.groups
              .map(
                (group) =>
                  `${group.label} ${group.count} ${source === 'osm' ? 'elements' : 'รายการ'}`,
              )
              .join(', ');
            summaries.push(
              `${source === 'tat' ? 'ททท.' : 'OpenStreetMap'}: ${totals}`,
            );
            // Each listed business cites the actual dataset record or OSM element; no model invents rows.
            for (const item of result.items) {
              if (report.findings.length >= 50) break;
              const id = `${source}:${item.id}`.slice(0, 80);
              report.evidence.push({
                id,
                source,
                url: item.url,
                excerpt: item.detail,
                collectedAt: result.observedAt,
              });
              report.findings.push({
                text: `${source === 'tat' ? 'ททท.' : 'OSM'} · ${item.detail}`,
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
            report.summary = `ผลค้นฐานรายชื่อฟรีใน${run.scope.area}: ${summaries.join(' · ')} แสดง ${report.findings.length} รายการพร้อมหลักฐาน รายงานนี้เป็นข้อมูลตั้งต้นให้ทีมตรวจสอบ ไม่ยืนยันว่าธุรกิจกำลังหาซัพพลายเออร์`;
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
