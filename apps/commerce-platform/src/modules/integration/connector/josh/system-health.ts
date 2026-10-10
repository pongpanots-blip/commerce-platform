import { eventStoreHealth } from '../../marketing-events/infrastructure/event-partitions';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DeliveryMonitor } from '../../webhook-subscription/application/delivery-monitor';
import { JoshInsights, Range } from './josh-insights';
import { JoshErpLogs } from './josh-erp-logs';

const COMMERCE_FAILURES_SQL = `
  SELECT (SELECT count(*) FROM webhook_deliveries WHERE status = 'failed' AND updated_at >= $1 AND updated_at < $2)::int AS deliveries_dead_lettered,
         (SELECT count(*) FROM webhook_deliveries WHERE status = 'success' AND updated_at >= $1 AND updated_at < $2)::int AS deliveries_succeeded,
         (SELECT count(*) FROM erp_ingest_records WHERE status = 'failed' AND created_at >= $1 AND created_at < $2)::int AS erp_intake_failed,
         (SELECT count(*) FROM erp_ingest_records WHERE created_at >= $1 AND created_at < $2)::int AS erp_intake_total`;

/** josh's ERP-send failures from commerce's copy of `jagota_order_sync` — same filters as josh-insights' replica SQL. */
const JAGOTA_COPY_FAILED_SQL = `SELECT count(*)::int AS n, max(imported_at) AS copied_up_to FROM jagota_order_sync_history
  WHERE sync_status = 'failed' AND created_at >= $1 AND created_at < $2`;
const JAGOTA_COPY_ERRORS_SQL = `SELECT left(error_message, 200) AS error, count(*)::int AS n, max(created_at) AS last_at FROM jagota_order_sync_history
  WHERE sync_status = 'failed' AND created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY 2 DESC LIMIT 5`;
/** Rows with source_version > 0 came from jagota_sync.snapshot events (S5-11; imported_at = when applied); 0 = replica import. */
const JAGOTA_COPY_FRESHNESS_SQL = `SELECT max(imported_at) AS copied_up_to, max(imported_at) FILTER (WHERE source_version > 0) AS last_event_at,
  max(imported_at) FILTER (WHERE source_version = 0) AS last_import_at FROM jagota_order_sync_history`;

/**
 * Why a page is not served without josh's replica (stage 5, S5-14) — shown instead of the bare "not configured":
 * josh-admin keeps it, it is a cutover tool, or commerce has no copy yet. Thai: the people reading it are staff.
 */
export const JOSH_ONLY = {
  backoffice: 'ข้อมูลหลังบ้านของ josh (KYC, เครดิต, CN/CB, ใบแจ้งหนี้, การจัดส่ง, การชำระเงิน, คูปอง…) ดูและจัดการที่ josh-admin — commerce ไม่เก็บสำเนา',
  promotions: 'โปรโมชันยังเป็นของ josh จนกว่า commerce จะรับเป็นเจ้าของ (G9) — ดูและแก้ที่ josh-admin',
  prices: 'ราคาตามสาขา / สัญญา / โปรโมชันยังอ่านจาก josh จนกว่าจะย้ายโปรโมชัน (G9) — ดูที่ josh-admin; ราคาลูกค้าที่ commerce ตั้งอยู่ที่หน้า ราคาพนักงาน',
  priceShadow: 'Price shadow เป็นเครื่องมือตรวจช่วงสลับราคา ต้องเทียบกับ josh โดยตรง จึงรันได้เฉพาะเซิร์ฟเวอร์ที่ต่อ replica ของ josh — ผลที่ตรวจไว้แล้วยังดูได้',
  jagotaShadow: 'Jagota shadow เป็นเครื่องมือตรวจช่วงสลับ ERP gateway ต้องอ่าน josh โดยตรง — ผลที่ตรวจไว้แล้วยังดูได้',
  copier: 'การดึงสำเนาจาก replica ของ josh เป็นเครื่องมือช่วงย้ายระบบ — ข้อมูลใหม่มาทาง event ของ josh แทน (ประวัติที่ดึงไว้แล้วยังดูได้)',
  staffPricesImport: 'การนำเข้าราคาจาก josh เป็นเครื่องมือช่วงย้ายระบบ — ราคาที่ commerce ตั้งยังสร้าง / แก้ได้ตามปกติ',
  traffic: 'สถิติการเข้าชมยังไม่มีสำเนาใน commerce (รอตัดสินใจ: สรุปรายวัน หรือเลิกใช้) — ดูที่ josh-admin',
  orderTargetgroup: 'Order target group อ่านไฟล์นำเข้าและปฏิทินส่งของของ josh ซึ่ง commerce ยังไม่มีสำเนา — ดูที่ josh-admin',
  products: 'รายงานสินค้าอ่านจากสำเนาใน commerce ได้เมื่อตั้ง PRODUCTS_SOURCE=copies (หลัง backfill catalog จน missing_report_fields = 0) — ระหว่างนี้ดูที่ josh-admin',
  customers: 'รายงานลูกค้าเป็นข้อมูล KYC / เครดิต / สาขา ซึ่งยังอยู่ที่ josh — ดูที่ josh-admin',
  pushCampaigns: 'Push campaign อ่านจากสำเนาใน commerce ได้เมื่อตั้ง PUSH_CAMPAIGNS_SOURCE=copies (หลัง backfill push_campaign) — ระหว่างนี้ดูที่ josh-admin',
  marketingWorkflows: 'Marketing workflow อ่านจากสำเนาใน commerce ได้เมื่อตั้ง MARKETING_WORKFLOWS_SOURCE=copies (หลัง backfill marketing_workflow) — ระหว่างนี้ดูที่ josh-admin',
} as const;
export const joshOnly = (why: keyof typeof JOSH_ONLY) => new ServiceUnavailableException(`${JOSH_ONLY[why]} (JOSH_DATABASE_URL ไม่ได้ตั้งบนเซิร์ฟเวอร์นี้)`);

export const NO_REPLICA = { available: false, reason: 'Shop data is read from josh\'s read replica, which is not configured on this server (JOSH_DATABASE_URL).' };

/** "Is anything broken now, and what failed in a period" — one answer for the MCP tool and the admin report page. */
@Injectable()
export class SystemHealthReport {
  constructor(private readonly db: DataSource, private readonly monitor: DeliveryMonitor, private readonly insights: JoshInsights, private readonly erpLogs: JoshErpLogs) {}

  async report(range: Range) {
    const [problemsNow, [commerce]] = await Promise.all([
      this.monitor.check(),
      this.db.query(COMMERCE_FAILURES_SQL, [range.from, range.to]),
    ]);
    let josh: unknown = NO_REPLICA;
    if (this.insights.available) {
      try { josh = await this.insights.failures(range); } catch (error) { josh = { available: false, reason: `josh replica query failed: ${error instanceof Error ? error.message : error}` }; }
    } else {
      josh = await this.joshFromCopies(range).catch((error) => ({ ...NO_REPLICA, reason: `${NO_REPLICA.reason} commerce's ERP-send copy failed too: ${error instanceof Error ? error.message : error}` }));
    }
    let joshErpInbound: unknown = { available: false, reason: 'josh\'s log database is not connected (JOSH_MONGO_URL).' };
    if (this.erpLogs.configured) {
      try { joshErpInbound = await this.erpLogs.summary(range.from, range.to); } catch (error) { joshErpInbound = { available: false, reason: `josh log query failed: ${error instanceof Error ? error.message : error}` }; }
    }
    const marketingEvents = await eventStoreHealth(this.db).catch((error) => ({ available: false, reason: String(error instanceof Error ? error.message : error) }));
    const problems = problemsNow.map((p) => p.message);
    if ('defaultPartitionRows' in marketingEvents && marketingEvents.defaultPartitionRows > 0)
      problems.push(`marketing_events: ${marketingEvents.defaultPartitionRows} แถวอยู่ใน default partition (job สร้าง partition พลาด — รอบถัดไปย้ายให้)`);
    return { period: range.label, now: { ok: problems.length === 0, problems }, commerce, josh, joshErpInbound, marketingEvents };
  }

  /**
   * Without the replica (stage 5, S5-9): the ERP-send part from `jagota_order_sync_history`, kept current by josh's
   * jagota_sync.snapshot events (S5-11) — or, before those flow, only as fresh as the last replica import. A quiet event
   * stream means no new ERP sends, not lag; lag shows as josh's commerce_outbox backlog. Payments, workflow runs and
   * push campaigns are josh's own health: josh-admin shows them.
   */
  private async joshFromCopies(range: Range) {
    const [[failed], errors, [fresh]] = await Promise.all([
      this.db.query(JAGOTA_COPY_FAILED_SQL, [range.from, range.to]),
      this.db.query(JAGOTA_COPY_ERRORS_SQL, [range.from, range.to]),
      this.db.query(JAGOTA_COPY_FRESHNESS_SQL),
    ]);
    const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
    const upTo = iso(fresh?.copied_up_to), lastEventAt = iso(fresh?.last_event_at), lastImportAt = iso(fresh?.last_import_at);
    const how = lastEventAt
      ? `fed by josh events, last ERP send received ${lastEventAt} (no newer row = no newer send; a delay shows as josh's commerce_outbox backlog)`
      : `not fed by josh events yet — imported from the replica up to ${lastImportAt ?? 'never'} (backfill jagota_sync)`;
    return {
      source: 'commerce copy (jagota_order_sync_history)',
      copiedUpTo: upTo,
      fedBy: lastEventAt ? 'events' : lastImportAt ? 'import' : 'none',
      lastEventAt,
      lastImportAt,
      counts: { jagota_order_sync_failed: failed?.n ?? 0 },
      jagotaOrderSyncErrors: errors,
      notAvailable: `ERP sends from commerce's copy, ${how}. Failed payments, marketing workflow runs and push campaigns are josh's own health — see josh-admin (JOSH_DATABASE_URL is not set here).`,
    };
  }
}
