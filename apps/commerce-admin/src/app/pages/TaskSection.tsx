import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Empty, Icon, PageHeader, SearchInput, uiText, useUiLocale, type NavItem } from '@cp/ui';
import { CommercePage } from '../CommercePage';
import { taskSectionsFor } from '../task-navigation';
import { featureGroupOf } from '../navigation';
import { featureMembers } from '../FeatureTabs';
import { commerceText as text } from '../commerce-copy';

interface Card { key: string; label: string; description: string; to: string; members: NavItem[] }

/** One card per feature: a feature group's pages share a card (with a link to each), other pages get their own. */
export function featureCards(links: readonly NavItem[]): Card[] {
  const cards: Card[] = [];
  for (const link of links) {
    const group = featureGroupOf(link.to);
    const members = group ? featureMembers(links, link.to) : [];
    if (group && members.length > 1) {
      if (!cards.some(card => card.key === group.id)) cards.push({ key: group.id, label: group.label, description: group.description, to: members[0].to, members });
    } else cards.push({ key: link.to, label: link.label, description: link.description ?? '', to: link.to, members: [] });
  }
  return cards;
}

export function TaskSection({ role }: { role?: string }) {
  useUiLocale();
  const { sectionId } = useParams();
  const [params, setParams] = useSearchParams();
  const section = taskSectionsFor(role).find(item => item.id === sectionId);
  if (!section) return <CommercePage><PageHeader title={text('งานที่คุณทำได้', 'Your tasks')} /><Alert tone="danger">{uiText('คุณไม่มีสิทธิ์ทำงานนี้')}</Alert><Link to="/home">{uiText('หน้าหลัก')}</Link></CommercePage>;
  const term = (params.get('q') ?? '').trim().toLocaleLowerCase();
  const matches = (item: { label: string; description?: string }) => `${uiText(item.label)} ${uiText(item.description ?? '')}`.toLocaleLowerCase().includes(term);
  const cards = featureCards(section.links).filter(card => matches(card) || card.members.some(matches));
  return <CommercePage>
    <PageHeader title={uiText(section.title)} subtitle={uiText(section.description)} />
    <SearchInput aria-label={text('ค้นหางานในหมวดนี้', 'Find a task in this section')} value={params.get('q') ?? ''} onChange={event => {
      const next = new URLSearchParams(params); event.target.value ? next.set('q', event.target.value) : next.delete('q'); setParams(next, { replace: true });
    }} />
    <section aria-label={uiText(section.title)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map(card => <div key={card.key} className="relative min-w-0 rounded-xl border border-secondary-container bg-white p-5 hover:border-primary focus-within:border-primary">
        <Link to={card.to} className="flex min-h-11 items-center justify-between gap-3 rounded focus-visible:outline-2 focus-visible:outline-primary sm:min-h-0">
          <h2 className="font-semibold text-on-surface">{uiText(card.label)}</h2><Icon name="arrow_forward" size={19} className="shrink-0 text-primary" />
        </Link>
        <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{uiText(card.description)}</p>
        {card.members.length > 0 && <ul aria-label={uiText(card.label)} className="mt-3 flex flex-wrap gap-1.5">
          {card.members.map(member => <li key={member.to}><Link to={member.to} className="inline-flex min-h-11 items-center rounded-full border border-secondary-container px-3 py-2 text-sm font-medium text-on-surface-variant hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-primary sm:min-h-9 sm:text-xs">{uiText(member.label)}</Link></li>)}
        </ul>}
      </div>)}
    </section>
    {!cards.length && <Empty icon="search_off">{text('ไม่พบงานที่ตรงกับคำค้น', 'No tasks match this search.')}<Button variant="secondary" onClick={() => setParams({})}>{text('ล้างตัวกรอง', 'Clear filters')}</Button></Empty>}
  </CommercePage>;
}
