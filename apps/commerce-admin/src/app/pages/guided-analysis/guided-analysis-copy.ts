import { commerceText as text } from '../../commerce-copy';
import type { GuidedCriterion, GuidedQuery } from '../../../../../commerce-platform/src/modules/integration/guided-analysis/guided-analysis.contracts';

export const templateTitle = (id: GuidedQuery['template']) => id === 'approved_without_order'
  ? text('ตรวจสาขาที่อนุมัติแล้วและยังไม่มีออเดอร์แรก', 'Check approved branches waiting for their first order')
  : text('ตรวจผู้ซื้อซ้ำที่เว้นช่วงสั่งซื้อ', 'Check repeat buyers with recorded inactivity');
export const inputLabel = (key: string) => text(...({
  approvalAgeDays: ['อนุมัติแล้วอย่างน้อยกี่วัน?', 'Approved at least how many days ago?'],
  historyLimitDays: ['ตรวจประวัติสาขาที่ครบถ้วนได้สูงสุดกี่วัน?', 'How many days of complete branch history can be checked?'],
  minimumOrders: ['เคยมีออเดอร์ที่ยืนยันแล้วอย่างน้อยกี่ครั้ง?', 'At least how many confirmed orders?'],
  purchaseWindowDays: ['นับออเดอร์ย้อนหลังในกี่วัน?', 'Over how many days?'],
  inactiveDays: ['ไม่มีออเดอร์ที่ยืนยันแล้วในกี่วันล่าสุด?', 'No confirmed orders in the last how many days?'],
} as Record<string, [string, string]>)[key]);
export function criterionLabel(c: GuidedCriterion) {
  switch (c.kind) {
    case 'eligible_branch': return text('สาขามีหลักฐานว่าเข้าเกณฑ์ที่กำหนด', 'The branch has verified eligibility evidence.');
    case 'approval_age': return text(`มีหลักฐานว่าอนุมัติแล้วอย่างน้อย ${c.days} วัน`, `Approval evidence is at least ${c.days} days old.`);
    case 'no_lifetime_order': return text(`ไม่มีออเดอร์ที่ยืนยันตลอดประวัติสาขาตั้งแต่เริ่ม โดยประวัติต้องครบและไม่เกิน ${c.maxDays} วัน รวมช่วงก่อนอนุมัติ`, `No confirmed orders over complete branch history from its creation, within ${c.maxDays} days, including history before approval.`);
    case 'confirmed_order_count': return text(`มีออเดอร์ที่ยืนยันแล้วอย่างน้อย ${c.minimum} ครั้งใน ${c.days} วัน`, `At least ${c.minimum} confirmed orders over ${c.days} days.`);
    case 'no_recent_order': return text(`ไม่มีออเดอร์ที่ยืนยันแล้วใน ${c.days} วันล่าสุด โดยต้องมีประวัติครบ`, `No confirmed orders in the last ${c.days} days, with complete history.`);
  }
}
export const contractLabel = (id: string) => text(...({
  branch_approval_and_eligibility: ['หลักฐานการอนุมัติสาขาและนโยบายว่าเข้าเกณฑ์', 'Authoritative branch approval and eligibility policy'],
  branch_birth: ['วันเริ่มสาขาที่ใช้ตรวจประวัติทั้งหมด', 'Authoritative branch creation time'],
  canonical_order_acceptance: ['ออเดอร์ที่ยืนยันตามนิยามเดียว พร้อมรหัสออเดอร์ที่ไม่ซ้ำ', 'Canonical confirmed-order acceptance and deduplication'],
  occurrence_identity: ['บริษัทและสาขา ณ เวลาเกิดเหตุการณ์ แยกลูกค้าจากผู้ดำเนินการ', 'Occurrence company/branch identity; customer separate from actor'],
  server_branch_grants: ['สิทธิ์บริษัทและสาขาที่เซิร์ฟเวอร์ยืนยันสำหรับบัญชีนี้', 'Server-derived tenant and branch authorization'],
  complete_history_watermarks: ['หลักฐานว่าประวัติครบช่วง รวมข้อมูลมาช้าและการระบุตัวตน', 'Complete interval and identity watermarks, including late data'],
  consent_and_retention: ['ขอบเขตการใช้ข้อมูล ความยินยอม การเก็บและลบข้อมูล', 'Analytics purpose, consent, retention and deletion contracts'],
  live_projection: ['แหล่งข้อมูลจริงที่ผ่านการตรวจและรองรับการประเมินซ้ำ', 'Verified live projection and reevaluation adapter'],
  daily_trends: ['สัญญาแหล่งข้อมูลเทรนด์รายวันที่รองรับบทบาทนี้', 'Authorized daily-trend source contract'],
  personalization: ['สัญญาการปรับเนื้อหาตามกลุ่มและการวัดผลที่ตรวจสอบได้', 'Verified personalization and measurement contracts'],
} as Record<string, [string, string]>)[id]);
export const membershipLabel = (value: string) => text(...({ included: ['เข้าเกณฑ์', 'Included'], excluded: ['ไม่เข้าเกณฑ์', 'Excluded'], unknown: ['ยังยืนยันไม่ได้', 'Unknown'] } as Record<string, [string, string]>)[value]);
