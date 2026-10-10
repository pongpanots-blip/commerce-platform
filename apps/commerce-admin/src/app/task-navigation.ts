import type { NavGroup } from '@cp/ui';
import { DASHBOARD, HOME, SECTIONS, navFor } from './navigation';
import { normalizeRole } from '../lib/role-home';
import { commerceText as text } from './commerce-copy';

/** Canonical authorized task homes; the legacy navigation used by welcome is unchanged. */
export function taskFeatureNavFor(role?: string): NavGroup[] {
  const existing = navFor(role).map(group => ({ ...group, links: group.links.map(link => link.to === HOME.to ? {
    ...link, to: '/today', label: text('งานที่ทบทวนวันนี้', 'Today work inbox'), icon: 'checklist',
    description: text('เลือกสิ่งที่จะตรวจจากหลักฐานที่อ่านได้', 'Choose work from readable evidence.'), activeFor: [HOME.to],
  } : link) }));
  const normalized = normalizeRole(role);
  return existing.map(group => {
    const section = SECTIONS.find(s => s.title === group.group);
    // Admin's legacy own link used these same team readers. Keep the deep link, expose one team home.
    const links = group.links.filter(link => normalized !== 'admin' || link.to !== '/reports/winback/my').map(link => normalized === 'admin' && link.to === '/reports/winback/opportunities' ? { ...link, activeFor: [...(link.activeFor ?? []), '/reports/winback/my'] } : link);
    if(section?.id==='reports'&&['admin','sale','sales_manager'].includes(normalized))links.push({to:'/planning/sales-work',label:text('ทบทวนงานติดตามและสั่งซ้ำ','Review follow-up and reorder work'),icon:'assignment',description:text('ตรวจบริษัทและประวัติออเดอร์ก่อนเก็บร่างงาน','Inspect assigned companies and recorded orders before planning work.')});
    if(section?.id==='marketing'&&['admin','marketing'].includes(normalized))links.push({to:'/planning/marketing-readiness',label:text('ทบทวนความพร้อมแคมเปญ','Review campaign readiness'),icon:'fact_check',description:text('ตรวจสินค้าที่บันทึกไว้และข้อมูลที่ยังขาด','Review recorded catalog evidence and missing source contracts.')});
    if(section?.id==='reports'&&['admin','sales_manager','business_analyst'].includes(normalized))links.push({to:'/analysis/financial',label:text('ตรวจฐานการเงินและเทียบยอดที่บันทึก','Review financial coverage and recorded differences'),icon:'fact_check',description:text('ตรวจยอดออเดอร์ คืนเงิน และฐานที่ยังขาดก่อนใช้ผลการเงินจริง','Inspect orders, refunds and missing financial contracts before using actual results.')});
    if (section?.id === 'reports' && ['admin', 'sales_manager', 'business_analyst'].includes(normalized)) links.push({ to: '/planning/profit-goals', label: text('ตั้งเป้ากำไรและต้นทุน', 'Plan profit and cost goals'), icon: 'flag', description: text('แยกเป้าและสมมติฐานจากผลจริงที่ยังไม่มีข้อมูลครบ', 'Separate targets and assumptions from incomplete actuals.') });
    if (section?.id === 'marketing' && ['admin', 'marketing', 'business_analyst'].includes(normalized)) links.push({ to: '/planning/pack-prices', label: text('วางแผนแพ็กและราคาขาย', 'Plan packs and sale prices'), icon: 'compare', description: text('เทียบหลายแพ็กที่บันทึกไว้แล้วเก็บทางเลือกเพื่อทบทวน', 'Compare recorded packs and retain sale options for review.') });
    if (normalized === 'admin' && section?.id === 'marketing') links.push({ to: '/planning/promotions', label: text('ทดลองและเก็บร่างโปรโมชัน', 'Rehearse and save promotion drafts'), icon: 'science', description: text('ตรวจส่วนลดและหลักฐานก่อนเก็บร่าง', 'Review discounts and evidence before saving a draft.') });
    if (normalized === 'admin' && section?.id === 'orders') links.push({ to: '/review/orders', label: text('ตรวจออเดอร์และหลักฐานส่งข้อมูล', 'Review orders and send evidence'), icon: 'fact_check', description: text('เทียบสองแหล่งและอ่านประเด็นที่ต้องตรวจ', 'Compare sources and inspect findings.') });
    return { ...group, links };
  });
}

/** The task index contains existing feature homes; it does not confer feature permissions. */
export function taskSectionsFor(role?: string) {
  const existing = taskFeatureNavFor(role);
  return SECTIONS.flatMap(section => {
    const group = existing.find(item => item.group === section.title);
    return group ? [{ ...section, to: `/tasks/${section.id}`, links: group.links }] : [];
  });
}

/** A short sidebar; every authorized feature remains in its task index and command search. */
export function taskSidebarFor(role?: string): NavGroup[] {
  const home = taskFeatureNavFor(role)[0]?.links.filter(link => link.to === '/today') ?? [];
  return [{ links: [
    ...home,
    ...(normalizeRole(role) === 'admin' ? [DASHBOARD] : []),
    ...taskSectionsFor(role).map(section => ({
      to: section.to, label: section.title, icon: section.icon, description: section.description,
      activeFor: section.links.flatMap(link => [link.to, ...(link.activeFor ?? [])]),
    })),
  ] }].filter(group => group.links.length > 0);
}

export const protectedWelcomePath = '/j/marketing/welcome-lead-email';
export function isProtectedWelcome(pathname: string) {
  return pathname === protectedWelcomePath || pathname.startsWith(`${protectedWelcomePath}/`);
}
