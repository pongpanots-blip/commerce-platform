// Prints the PR body tables from the nav data: `npx jiti docs/admin-redesign/nav-tables.ts > /tmp/tables.md`
import messages from '../../libs/ui/src/locales/ui-messages.json';
import { navFor, NAV_ENTRIES, ROLE_ACCESS, SECTIONS, shortcutsFor } from '../../apps/commerce-admin/src/app/navigation';
import { legacyMapping, legacyNavFor } from '../../apps/commerce-admin/src/app/navigation.legacy';

const en = (k: string) => (messages as Record<string, { en: string }>)[k]?.en ?? k;
const ROLES = ['admin', 'marketing', 'merchandising', 'cs', 'sale', 'sales_manager', 'business_analyst', 'graphic'];
const rolesOf = (to: string) => ['admin', ...(ROLE_ACCESS[to] ?? [])].join(', ');
const out: string[] = [];

out.push('### Old menu item → new place\n', '| # | Old group | Old label | New section | New label (TH / EN) | Roles |', '|---|---|---|---|---|---|');
legacyMapping().forEach((m, i) => {
  const entry = NAV_ENTRIES.find((e) => e.to === m.to)!;
  const place = `${en(m.sectionTitle)}${m.more ? ' · show more' : ''}`;
  out.push(`| ${i + 1} | ${en(m.oldWorkspace)} | ${en(m.oldLabel)} | ${place} | ${entry.label} / ${en(entry.label)} | ${rolesOf(m.to)} |`);
});
out.push('', 'Old workspace overview pages `/workspaces/{catalog,orders,customers,marketing,reports,connections,settings}` redirect to the first page of the replacing section the role can open (connections → Settings › Advanced), else to the role home.');

out.push('', '### Per role\n', '| Role | Items before → after | Sections (items) | Home shortcuts |', '|---|---|---|---|');
for (const role of ROLES) {
  const nav = navFor(role);
  const before = legacyNavFor(role).flatMap((g) => g.links).length;
  const after = nav.flatMap((g) => g.links).length;
  const groups = nav.filter((g) => g.group).map((g) => `${en(g.group!)} (${g.links.length}${g.links.some((l) => l.more) ? `, ${g.links.filter((l) => l.more).length} under show more` : ''})`).join('; ');
  out.push(`| ${role} | ${before} → ${after} | ${groups} | ${shortcutsFor(role).map((s) => en(s.label)).join(' · ')} |`);
}

out.push('', '### Settings › Advanced\n');
out.push(NAV_ENTRIES.filter((e) => e.section === 'advanced').map((e) => `- ${en(e.label)} (\`${e.to}\`) — ${rolesOf(e.to)}`).join('\n'));
out.push('', `Sections: ${SECTIONS.map((s) => en(s.title)).join(' · ')}`);
console.log(out.join('\n'));
