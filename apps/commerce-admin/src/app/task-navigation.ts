import type { NavGroup } from '@cp/ui';
import { DASHBOARD, HOME, SECTIONS, navFor } from './navigation';
import { normalizeRole } from '../lib/role-home';
import { commerceText as text } from './commerce-copy';

/** Admin-only proposal/review homes; the legacy navigation used by welcome is unchanged. */
export function taskFeatureNavFor(role?: string): NavGroup[] {
  const existing = navFor(role);
  if (normalizeRole(role) !== 'admin') return existing;
  return existing.map(group => {
    const section = SECTIONS.find(s => s.title === group.group);
    const link = section?.id === 'marketing' ? { to: '/planning/promotions', label: text('ทดลองและเก็บร่างโปรโมชัน', 'Rehearse and save promotion drafts'), icon: 'science', description: text('ตรวจส่วนลดและหลักฐานก่อนเก็บร่าง', 'Review discounts and evidence before saving a draft.') }
      : section?.id === 'orders' ? { to: '/review/orders', label: text('ตรวจออเดอร์และหลักฐานส่งข้อมูล', 'Review orders and send evidence'), icon: 'fact_check', description: text('เทียบสองแหล่งและอ่านประเด็นที่ต้องตรวจ', 'Compare sources and inspect findings.') } : null;
    return link ? { ...group, links: [...group.links, link] } : group;
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
  const home = navFor(role)[0]?.links.filter(link => link.to === HOME.to) ?? [];
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
