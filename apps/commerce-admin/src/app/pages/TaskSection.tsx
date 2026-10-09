import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Empty, Icon, PageHeader, SearchInput, uiText, useUiLocale } from '@cp/ui';
import { CommercePage } from '../CommercePage';
import { taskSectionsFor } from '../task-navigation';
import { commerceText as text } from '../commerce-copy';

export function TaskSection({ role }: { role?: string }) {
  useUiLocale();
  const { sectionId } = useParams();
  const [params, setParams] = useSearchParams();
  const section = taskSectionsFor(role).find(item => item.id === sectionId);
  if (!section) return <CommercePage><PageHeader title={text('งานที่คุณทำได้', 'Your tasks')} /><Alert tone="danger">{uiText('คุณไม่มีสิทธิ์ทำงานนี้')}</Alert><Link to="/home">{uiText('หน้าหลัก')}</Link></CommercePage>;
  const term = (params.get('q') ?? '').trim().toLocaleLowerCase();
  const links = section.links.filter(link => `${uiText(link.label)} ${uiText(link.description ?? '')}`.toLocaleLowerCase().includes(term));
  return <CommercePage>
    <PageHeader title={uiText(section.title)} subtitle={uiText(section.description)} />
    <SearchInput aria-label={text('ค้นหางานในหมวดนี้', 'Find a task in this section')} value={params.get('q') ?? ''} onChange={event => {
      const next = new URLSearchParams(params); event.target.value ? next.set('q', event.target.value) : next.delete('q'); setParams(next, { replace: true });
    }} />
    <section aria-label={uiText(section.title)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {links.map(link => <Link key={link.to} to={link.to} className="min-w-0 rounded-xl border border-secondary-container bg-white p-5 hover:border-primary focus-visible:outline-2 focus-visible:outline-primary">
        <span className="flex items-start justify-between gap-3"><h2 className="font-semibold text-on-surface">{uiText(link.label)}</h2><Icon name="arrow_forward" size={19} className="shrink-0 text-primary" /></span>
        <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{uiText(link.description ?? '')}</p>
      </Link>)}
    </section>
    {!links.length && <Empty icon="search_off">{text('ไม่พบงานที่ตรงกับคำค้น', 'No tasks match this search.')}<Button variant="secondary" onClick={() => setParams({})}>{text('ล้างตัวกรอง', 'Clear filters')}</Button></Empty>}
  </CommercePage>;
}
