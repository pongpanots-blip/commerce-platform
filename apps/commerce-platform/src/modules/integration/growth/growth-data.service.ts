import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { GrowthEvidence, GrowthMetric, GrowthResults, GrowthTimeline, GrowthWorkspace } from '@cp/growth';
import { JoshActions } from '../connector/josh/josh-actions';
import { joshAdminCall } from '../connector/josh/josh-admin-call.controller';
import { bangkokRange, JOSH_SETTLED_STATUSES, JoshInsights, paidOrderSql } from '../connector/josh/josh-insights';
import { JoshMarketingWorkflows } from '../connector/josh/josh-marketing-workflows';
import { JoshReplica } from '../connector/josh/josh-replica';
import { MarketingResearchService } from '../../platform/marketing-research/application/marketing-research.service';
import { count, experimentResult, finiteNumber, object, workflowPayload } from './growth-data.helpers';

type Actor = { userId: string; email: string; role: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COSTS = ['ต้นทุนสินค้า (COGS)', 'ค่าธรรมเนียมรับเงิน', 'ค่าขนส่งที่ร้านรับภาระ', 'ต้นทุนแคมเปญจริง', 'คืนเงินและเครดิตที่เชื่อมกับออเดอร์'];
const FRESHNESS = 'คำนวณจาก Josh read replica ณ เวลาที่ระบุ; ยังไม่ได้วัด replication lag';
const FRESHNESS_COPIES = 'คำนวณจากสำเนาข้อมูล josh ใน commerce (event) ณ เวลาที่ระบุ; สำเนาอาจช้ากว่า josh เล็กน้อย';

/**
 * GROWTH_SOURCE: replica (default) · copies (stage 5, S5-6): sales through SALES_SOURCE-style copies, reorder-due and contact
 * history from commerce's own winback tables (josh's are stale since 2b), company and orders from the copies. Carts,
 * devices and marketing workflows have no copy yet (S5-12) — reported as such; `results` still needs the replica.
 */
export const growthSource = (): 'replica' | 'copies' => (process.env.GROWTH_SOURCE?.trim().toLowerCase() === 'copies' ? 'copies' : 'replica');
/** A source commerce has no copy of: the workspace says so instead of "check the connection". */
class NotCopied extends Error {}
const notCopied = (what: string) => Promise.reject(new NotCopied(`${what} ยังไม่มีสำเนาใน commerce`));
const REORDER_DUE_SQL = `SELECT count(*)::int AS n, max(update_date) AS updated_at FROM winback_account
        WHERE median_reorder_interval_days > 0 AND delay_ratio >= 1`;

@Injectable()
export class GrowthDataService {
  constructor(
    private readonly replica: JoshReplica,
    private readonly insights: JoshInsights,
    private readonly workflows: JoshMarketingWorkflows,
    private readonly josh: JoshActions,
    private readonly research: MarketingResearchService,
    private readonly db: DataSource,
  ) {}

  private get copies() { return growthSource() === 'copies'; }
  /** Shop data reachable: copies mode, or the replica is set. */
  get available() { return this.copies || this.replica.configured; }

  private id(id: string) {
    if (!UUID.test(id)) throw new BadRequestException('id must be a UUID');
  }
  private staff(actor: Actor) {
    if (!['admin', 'marketing'].includes(actor.role)) throw new ForbiddenException('admin or marketing only');
  }
  private connected(copiesOk = false) {
    if (copiesOk && this.copies) return;
    if (!this.replica.configured) throw new ServiceUnavailableException('ยังไม่ได้เชื่อม Josh read replica');
  }

  async workspace(): Promise<GrowthWorkspace> {
    const now = new Date(), range = bangkokRange('last_30_days', Math.floor(now.getTime() / 3_600_000) * 3_600_000);
    const copies = this.copies;
    const limitations = [copies ? FRESHNESS_COPIES : FRESHNESS, `ยอดขายและตะกร้าใช้ช่วงถึง ${range.current.to.toISOString()} (สิ้นชั่วโมงที่ครบแล้ว)`, 'กำไรและเวลางานที่ลดลงยังไม่มีต้นทุนจริงหรือเวลาฐานให้ตรวจสอบ'];
    const metrics: GrowthMetric[] = [
      { key: 'revenue', label: 'ยอดขายที่รับชำระจริง', value: null, unit: 'THB', note: '30 วันตามเวลาไทย รวม VAT หลังส่วนลด ก่อนหักคืนเงิน' },
      { key: 'orders', label: 'ออเดอร์ที่รับชำระจริง', value: null, unit: 'count', note: 'สถานะ paid/preparing/shipped/delivered และมี payment success ที่ไม่ใช่ test' },
      { key: 'revenue_change', label: 'ยอดขายเทียบช่วงก่อน', value: null, unit: 'percent', note: 'เทียบช่วงเวลาก่อนหน้าที่มีความยาวเท่ากัน' },
      { key: 'idle_carts', label: 'ลูกค้ามีตะกร้าค้าง ≥1 ชม.', value: null, unit: 'count', note: 'snapshot มีสินค้า อัปเดตใน 30 วัน; ยังไม่ใช่รายชื่อที่ผ่านสิทธิ์ส่ง' },
      { key: 'reorder_due', label: 'บัญชีที่เลยรอบซื้อ', value: null, unit: 'count', note: 'Winback snapshot ที่ delay_ratio ≥1 และมีประวัติรอบซื้อ; ไม่ใช่ยอดขายที่รับประกัน' },
      { key: 'workflow_failures', label: 'การรัน workflow ที่ล้มเหลว', value: null, unit: 'count', note: 'scheduled runs ใน 30 วันย้อนหลัง' },
      { key: 'contribution', label: 'Contribution หลังต้นทุน', value: null, unit: 'THB', note: 'ยังไม่มีต้นทุนที่ยืนยันครบ จึงยังคำนวณไม่ได้' },
    ];
    const result: GrowthWorkspace = { generatedAt: now.toISOString(), period: { from: range.current.from.toISOString(), to: range.current.to.toISOString() }, availability: 'unavailable', metrics, opportunities: [], evidence: [], limitations };
    if (!this.available) {
      limitations.push('ยังไม่ได้เชื่อม Josh read replica; ไม่มีข้อมูลตัวอย่างแทนข้อมูลจริง');
      return result;
    }
    const sources = await Promise.allSettled(copies ? [
      this.insights.sales(range, 1, 'copies'),
      notCopied('ตะกร้า (cart_snapshot)'),
      this.db.query(REORDER_DUE_SQL),
      notCopied('marketing workflow'),
    ] : [
      this.insights.sales(range, 1),
      this.replica.query(`SELECT count(DISTINCT COALESCE(cs.user_id, ud.user_id))::int AS n
        FROM cart_snapshot cs LEFT JOIN user_devices ud ON ud.individual_id = cs.cart_id
        WHERE COALESCE(cs.user_id, ud.user_id) IS NOT NULL AND cs.updated_at >= $1 AND cs.updated_at <= $2
          AND jsonb_typeof(cs.payload) = 'object' AND cs.payload <> '{}'::jsonb`, [range.current.from, new Date(range.current.to.getTime() - 3_600_000)]),
      this.replica.query(REORDER_DUE_SQL),
      this.workflows.list(30),
    ]);
    const labels = ['ยอดขาย', 'ตะกร้าค้าง', 'รอบซื้อ', 'workflow'];
    const evidence = (key: string, title: string, excerpt: string) => {
      const id = `${key}:${createHash('sha256').update(JSON.stringify([result.period, title, excerpt])).digest('hex').slice(0, 16)}`;
      result.evidence.push({ id, source: copies ? 'สำเนาข้อมูล josh ใน commerce' : 'Josh read replica', title, url: null, collectedAt: now.toISOString(), excerpt: `${excerpt}; ${copies ? FRESHNESS_COPIES : FRESHNESS}` });
      return id;
    };
    for (const [i, source] of sources.entries()) {
      if (source.status === 'rejected') limitations.push(source.reason instanceof NotCopied ? `ข้อมูล${labels[i]}: ${source.reason.message}` : `ข้อมูล${labels[i]}ไม่พร้อม; กรุณาตรวจการเชื่อมต่อหรือ schema`);
    }
    const [sales, carts, reorder, workflows] = sources;
    if (sales.status === 'fulfilled') {
      const totals = object(sales.value.totals);
      metrics[0].value = finiteNumber(totals.revenue_inc_vat);
      metrics[1].value = finiteNumber(totals.orders);
      metrics[2].value = finiteNumber(sales.value.vsPreviousPeriod.revenue_change_percent);
      const evidenceId = evidence('sales', 'ยอดขาย 30 วัน', `${range.current.label}; ยอด ${metrics[0].value} THB / ${metrics[1].value} ออเดอร์; เทียบช่วงก่อน ${metrics[2].value ?? 'ยังคำนวณไม่ได้'}%; ${sales.value.counted}`);
      const refund = object(sales.value.totals.refunds);
      limitations.push(`คืนเงินที่บันทึกในช่วงนี้ ${finiteNumber(refund.amount) ?? 'ไม่ทราบ'} THB เป็นช่วงวันที่คืนเงิน ไม่ได้หักซ้ำจากยอดขาย`);
      if (metrics[2].value !== null && metrics[2].value < 0) result.opportunities.push({ id: 'sales-decline', title: 'ตรวจกลุ่มลูกค้าที่ซื้อซ้ำลดลง', reason: `ยอดขายลด ${Math.abs(metrics[2].value)}% จากช่วงก่อน ยังไม่ยืนยันสาเหตุ`, template: 'winback', priority: 'high', evidenceIds: [evidenceId], href: '/reports/sales' });
    }
    if (carts.status === 'fulfilled') {
      metrics[3].value = finiteNumber(carts.value[0]?.n);
      const evidenceId = evidence('idle-carts', 'ตะกร้าที่ควรตรวจต่อ', `${metrics[3].value} ลูกค้ามี snapshot ไม่ว่างที่ไม่ขยับ ≥1 ชั่วโมงใน 30 วัน; ต้องตรวจว่ายังไม่ซื้อ สต็อก สิทธิ์ช่องทาง และ cooldown ก่อนส่ง`);
      if (metrics[3].value) result.opportunities.push({ id: 'idle-carts', title: 'เรียกลูกค้าที่มีตะกร้าค้างกลับมา', reason: `${metrics[3].value} ลูกค้ามีตะกร้าที่ควรตรวจต่อ`, template: 'cart_idle', priority: 'high', evidenceIds: [evidenceId], href: null });
    }
    if (reorder.status === 'fulfilled') {
      metrics[4].value = finiteNumber(reorder.value[0]?.n);
      const evidenceId = evidence('reorder-due', 'บัญชีที่เลยรอบซื้อปกติ', `${metrics[4].value} บัญชีตาม Winback baseline; เวลาอัปเดตล่าสุดของบัญชีในกลุ่ม ${String(reorder.value[0]?.updated_at ?? 'ไม่ทราบ')}; snapshot อาจล้าสมัย`);
      if (metrics[4].value) result.opportunities.push({ id: 'reorder-due', title: 'เตรียมแผนซื้อซ้ำ', reason: `${metrics[4].value} บัญชีเลยรอบซื้อของตัวเอง ให้ตรวจออเดอร์ล่าสุดก่อนติดต่อ`, template: 'reorder', priority: 'medium', evidenceIds: [evidenceId], href: '/reports/winback' });
    }
    if (workflows.status === 'fulfilled') {
      metrics[5].value = workflows.value.reduce((sum, workflow) => sum + count(workflow.failed_runs), 0);
      const evidenceId = evidence('workflow-failures', 'งาน scheduled workflow', `${metrics[5].value} การรันล้มเหลวใน 30 วันย้อนหลัง; จำนวน workflow ${workflows.value.length}`);
      if (metrics[5].value) result.opportunities.push({ id: 'workflow-failures', title: 'ตรวจ workflow ที่รันไม่สำเร็จ', reason: `${metrics[5].value} การรันล้มเหลว ควรตรวจ logs ก่อนตั้งแคมเปญใหม่`, template: 'winback', priority: 'high', evidenceIds: [evidenceId], href: '/marketing/workflows' });
    }
    result.availability = sources.every((source) => source.status === 'fulfilled') ? 'ready' : sources.some((source) => source.status === 'fulfilled') ? 'partial' : 'unavailable';
    return result;
  }

  async researchEvidence(topicId: string, runId: string, actor: Actor): Promise<GrowthEvidence[]> {
    this.staff(actor); this.id(topicId); this.id(runId);
    const topic = await this.research.detail(topicId, { sub: actor.userId, role: actor.role });
    const run = await this.research.runDetail(runId);
    if (run.topicId !== topicId) throw new BadRequestException('รายงาน Research ไม่ได้อยู่ในโจทย์ที่เลือก');
    if (topic.archivedAt || !['completed', 'partial'].includes(run.status) || !run.report)
      throw new ConflictException('ต้องเลือกโจทย์ที่ยังใช้งานและรายงาน Research ที่เสร็จแล้ว');
    const coverage = run.report.coverage ?? [];
    const unavailable = coverage.length ? coverage.filter(c => c.status === 'unavailable').map(c => c.source).join(', ') || 'ไม่มีในรายงาน' : 'ไม่ได้ระบุ coverage';
    const context = `ขอบเขตรายงานเดิม: ${run.scope.area} / ${run.scope.sector} / ${run.scope.days} วัน; โจทย์ v${run.topicVersion}${run.topicVersion !== topic.version ? ' เป็นรายงานเวอร์ชันเก่า' : ''}; สถานะ ${run.status}; แหล่งที่ไม่พร้อม: ${unavailable}; ข้อจำกัด: ${run.report.limitations?.join('; ') ?? 'ไม่ได้ระบุ'}`;
    return run.report.evidence.map((item) => ({
      id: `research:${runId}:${item.id}`, source: item.source, title: `${run.scope.title} · โจทย์ v${run.topicVersion}`,
      url: item.url, collectedAt: item.collectedAt,
      excerpt: `${context.slice(0, 600)}; ช่วงแหล่งนี้: ${coverage.find(c => c.source === item.source)?.from ?? 'ไม่ระบุ'} ถึง ${coverage.find(c => c.source === item.source)?.to ?? 'ไม่ระบุ'}\n${item.excerpt}`,
    }));
  }

  async results(workflowId: string, actor: Actor): Promise<GrowthResults> {
    this.staff(actor); this.id(workflowId); this.connected();
    const range = bangkokRange('last_30_days');
    const [workflow, analyticsRaw, conversionRaw] = await Promise.all([
      this.workflows.detail(workflowId),
      joshAdminCall(this.josh, actor, { method: 'GET', path: `/marketing-workflows/${workflowId}/analytics`, query: { from: range.current.from.toISOString(), to: range.current.to.toISOString() } }, 'growth'),
      joshAdminCall(this.josh, actor, { method: 'GET', path: `/marketing-workflows/${workflowId}/conversion-stats` }, 'growth'),
    ]);
    const analytics = workflowPayload(analyticsRaw, workflowId), conversions = workflowPayload(conversionRaw, workflowId);
    const funnel = object(analytics.funnel);
    const limitations = [FRESHNESS, `funnel เป็น event counts ใน ${range.current.label}; conversion groups เป็น enrollment สะสมทั้งหมด จึงไม่ใช่ช่วงเวลาเดียวกัน`, 'Conversion endpoint นับสถานะออเดอร์ ยังไม่ตรวจ payment success, บริษัทที่แบ่งกลุ่มซ้ำ หรือการพ้น conversion window; อย่าตีความเป็นยอดเพิ่มจากแคมเปญ', 'รายได้ที่ให้เครดิตนับออเดอร์ไม่ซ้ำของ enrollment ใน 30 วันนี้ รวม VAT หลังส่วนลด ก่อนหักคืนเงิน; ออเดอร์เดียวอาจถูกให้เครดิตกับหลาย workflow และ conversion window ใช้ค่าปัจจุบัน ไม่มี snapshot ต่อ enrollment'];
    let attributedRevenueThb: number | null = null;
    try {
      // Deduplicate orders before summing: repeated enrollments may credit the same order.
      const [revenue] = await this.replica.query(`SELECT COALESCE(sum(o.total_price), 0)::float AS revenue FROM orders o
        WHERE o.create_date < $4 AND o.status::text = ANY($2) AND ${paidOrderSql('o')} AND EXISTS (
          SELECT 1 FROM marketing_workflow_enrollments e JOIN marketing_workflows w ON w.id = e.workflow_id
          WHERE e.workflow_id = $1 AND NOT e.is_holdout AND e.converted_order_id = o.orders_id
            AND e.user_id = o.user_id AND e.started_at IS NOT NULL AND e.converted_at <= $4
            AND e.started_at >= $3 AND e.started_at < $4
            AND o.create_date >= e.started_at AND o.create_date <= e.started_at + make_interval(days => w.conversion_window_days)
        )`, [workflowId, JOSH_SETTLED_STATUSES, range.current.from, range.current.to]);
      attributedRevenueThb = finiteNumber(revenue?.revenue);
    } catch { limitations.push('ไม่พร้อมอ่านออเดอร์ที่เชื่อมกับ conversion จึงยังไม่มีรายได้ที่ยืนยัน'); }
    const experiment = experimentResult(conversions);
    const operations = (workflow.enrollmentsByStatus as Record<string, unknown>[]).map((row) => ({ label: String(row.status), count: count(row.n) }));
    const failures = operations.find((row) => row.label === 'failed')?.count ?? 0;
    return {
      workflowId, name: String(object(workflow).name), generatedAt: new Date().toISOString(),
      funnel: [['enrolled', 'เข้า workflow'], ['notifySent', 'ส่งข้อความสำเร็จ'], ['offerShown', 'แสดงข้อเสนอ'], ['couponGranted', 'ได้รับคูปอง'], ['couponRedeemed', 'ใช้คูปอง'], ['orderConverted', 'ออเดอร์ที่ให้เครดิต']].map(([key, label]) => ({ label, count: count(funnel[key]) })),
      attributedRevenueThb, contributionThb: null, missingCosts: [...COSTS], experiment, operations, limitations,
      suggestions: [failures ? 'ตรวจ enrollment ที่ failed และ action logs ก่อนรันเพิ่ม' : 'ตรวจต้นทุนจริงก่อนตัดสินใจกำไรของแคมเปญ', experiment.confidence === 'insufficient' ? 'เก็บข้อมูลเพิ่มและรอให้ครบ conversion window ก่อนปรับงบ' : 'ออกแบบการแบ่งกลุ่มคงที่ระดับบริษัทก่อนสรุปผลเพิ่มจากการทดลอง'],
    };
  }

  async timeline(companyId: string, actor: Actor): Promise<GrowthTimeline> {
    if (actor.role !== 'admin') throw new ForbiddenException('admin only');
    this.id(companyId); this.connected(true);
    if (this.copies) return this.timelineFromCopies(companyId);
    const [company] = await this.replica.query(`SELECT id, name FROM company WHERE id = $1`, [companyId]);
    if (!company) throw new NotFoundException('ไม่พบบริษัทใน Josh');
    const from = new Date(Date.now() - 90 * 86_400_000);
    const limitations = [FRESHNESS, 'แสดง 100 เหตุการณ์ล่าสุดใน 90 วัน; การติดต่อเป็น metadata ไม่รวมชื่อบุคคลหรือบันทึกข้อความ', 'เหตุการณ์ workflow ผูกบริษัทจาก membership ปัจจุบัน ไม่มี snapshot บริษัท ณ วันเข้า workflow'];
    const sources = await Promise.allSettled([
      this.replica.query(`SELECT o.orders_id AS id, o.create_date AS at, o.status::text AS status, o.total_price::float AS total_price,
        (o.status::text = ANY($3) AND ${paidOrderSql('o')}) AS paid FROM orders o
        WHERE o.company_id = $1 AND o.create_date >= $2 ORDER BY o.create_date DESC LIMIT 100`, [companyId, from, JOSH_SETTLED_STATUSES]),
      this.replica.query(`SELECT a.id, a.activity_at AS at, a.type, a.outcome, a.status FROM winback_activity a
        JOIN winback_account w ON w.id = a.account_id WHERE w.josh_company_id = $1 AND a.activity_at >= $2
        ORDER BY a.activity_at DESC LIMIT 100`, [companyId, from]),
      this.replica.query(`SELECT e.id, e.started_at AS at, e.workflow_id, e.status::text AS status, e.is_holdout
        FROM marketing_workflow_enrollments e JOIN users u ON u.id = e.user_id
        WHERE u.company_id = $1 AND e.started_at >= $2 ORDER BY e.started_at DESC LIMIT 100`, [companyId, from]),
    ]);
    return this.timelineOf(companyId, String(company.name), sources, limitations);
  }

  /** Timeline from commerce's copies: josh_companies, josh_orders (`paid` from josh's builder), commerce winback_*. */
  private async timelineFromCopies(companyId: string): Promise<GrowthTimeline> {
    const [company] = await this.db.query(`SELECT id, name FROM josh_companies WHERE id = $1`, [companyId]);
    if (!company) throw new NotFoundException('ไม่พบบริษัทใน Josh');
    const from = new Date(Date.now() - 90 * 86_400_000);
    const limitations = [FRESHNESS_COPIES, 'แสดง 100 เหตุการณ์ล่าสุดใน 90 วัน; การติดต่อเป็น metadata ไม่รวมชื่อบุคคลหรือบันทึกข้อความ'];
    const sources = await Promise.allSettled([
      this.db.query(`SELECT o.orders_id AS id, o.create_date AS at, o.status, o.total_price::float AS total_price,
        (o.status = ANY($3) AND o.paid) AS paid FROM josh_orders o
        WHERE o.company_id = $1 AND o.create_date >= $2 ORDER BY o.create_date DESC LIMIT 100`, [companyId, from, JOSH_SETTLED_STATUSES]),
      this.db.query(`SELECT a.id, a.activity_at AS at, a.type, a.outcome, a.status FROM winback_activity a
        JOIN winback_account w ON w.id = a.account_id WHERE w.josh_company_id = $1 AND a.activity_at >= $2
        ORDER BY a.activity_at DESC LIMIT 100`, [companyId, from]),
      notCopied('marketing workflow enrollment'),
    ]);
    return this.timelineOf(companyId, String(company.name), sources, limitations);
  }

  private timelineOf(companyId: string, name: string, sources: PromiseSettledResult<Record<string, unknown>[]>[], limitations: string[]): GrowthTimeline {
    const events: GrowthTimeline['events'] = [];
    const kinds = ['order', 'contact', 'workflow'];
    for (const [index, source] of sources.entries()) {
      if (source.status === 'rejected') { limitations.push(source.reason instanceof NotCopied ? `ข้อมูล ${kinds[index]}: ${source.reason.message}` : `ข้อมูล ${kinds[index]} ไม่พร้อม`); continue; }
      for (const row of source.value) {
        const at = new Date(row.at as string | Date);
        if (Number.isNaN(at.getTime())) continue;
        const title = index === 0 ? `ออเดอร์ ${String(row.status)}${row.paid === true ? ` · รับชำระ ${finiteNumber(row.total_price)} THB` : ' · ยังไม่ยืนยันการชำระ'}`
          : index === 1 ? `การติดต่อ ${String(row.type)} · ${String(row.outcome ?? row.status)}`
          : `Workflow ${String(row.status)}${row.is_holdout === true ? ' · holdout' : ''}`;
        events.push({ id: `${kinds[index]}:${String(row.id)}`, at: at.toISOString(), kind: kinds[index], title, href: null });
      }
    }
    return { companyId, name, generatedAt: new Date().toISOString(), events: events.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, 100), limitations };
  }
}
