import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Empty, Icon, Page, PageHeader, Panel, SearchInput, useNavigation } from '@cp/ui';
import { taskSectionsFor, WORKSPACES } from '../navigation';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function Workspace() {
  __useUiLocale();
  const { workspaceId } = useParams();
  const workspace = WORKSPACES.find(item => item.id === workspaceId);
  const nav = useNavigation();
  const [query, setQuery] = useState('');
  if (!workspace) return <Navigate to="/" replace />;

  const links = nav.find(group => group.group === workspace.title)?.links.filter(item => !item.to.startsWith('/workspaces/')) ?? [];
  const featured = links.filter(item => workspace.primary.some(path => path === item.to));
  const visible = links.filter(item => `${item.label} ${__uiText(item.label)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const sections = taskSectionsFor(workspace.id, visible);

  return (
    <Page>
      <PageHeader title={__uiText(workspace.title)} subtitle={__uiText(workspace.description)} />
      <Panel className="p-5 md:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-container/60 text-primary"><Icon name={workspace.icon} size={24} /></span>
          <div>
            <h2 className="font-semibold">{__uiText("เริ่มจากงานที่ต้องทำ")}</h2>
            <p className="mt-1 text-sm text-on-surface-variant">{__uiText("เลือกทางลัดด้านล่าง หรือค้นหาหน้าที่ต้องการในหมวดนี้")}</p>
          </div>
        </div>
        <ol className="mt-5 grid gap-3 md:grid-cols-3">
          {workspace.steps.map((step, index) => <li key={__uiText(step)} className="flex items-center gap-2.5 text-sm text-on-surface-variant"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-container-low text-xs font-semibold text-primary">{index + 1}</span>{__uiText(step)}</li>)}
        </ol>
      </Panel>
      {featured.length > 0 && <section aria-label={__uiText("ทางลัดในหมวด")}>
        <h2 className="mb-3 text-sm font-semibold text-on-surface-variant">{__uiText("ใช้งานบ่อย")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {featured.map(item => <Link key={item.to} to={item.to} className="group flex min-h-24 items-center justify-between gap-3 rounded-xl border border-secondary-container bg-white p-4 transition-colors hover:border-primary/50 hover:bg-primary-container/20 focus-visible:outline-2 focus-visible:outline-primary">
            <span className="font-medium">{__uiText(item.label)}</span><Icon name="arrow_forward" size={18} className="shrink-0 text-outline group-hover:text-primary" />
          </Link>)}
        </div>
      </section>}
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-secondary-container p-4 md:p-5">
          <div><h2 className="font-semibold">{__uiText("งานทั้งหมดในหมวดนี้")}</h2><p className="mt-1 text-xs text-on-surface-variant">{visible.length} {__uiText(" จาก ")}{links.length} {__uiText(" เมนู")}</p></div>
          <SearchInput aria-label={__uiText("ค้นหาในหมวด")} placeholder={__uiText("ค้นหาหน้าที่ต้องการ…")} value={query} onChange={event => setQuery(event.target.value)} className="w-full sm:w-72" />
        </div>
        {visible.length ? <div className="grid gap-6 p-4 md:grid-cols-2 md:p-6">
          {sections.map(section => <section key={__uiText(section.title)} aria-label={__uiText(section.title)}>
            <div className="mb-3 flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-container-low text-primary"><Icon name={section.icon} size={20} /></span>
              <div><h3 className="text-sm font-semibold">{__uiText(section.title)}</h3><p className="mt-1 text-xs text-on-surface-variant">{__uiText(section.description)}</p></div>
            </div>
            <div className="space-y-1">
              {section.links.map(item => <Link key={item.to} to={item.to} className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-surface-container-low focus-visible:outline-2 focus-visible:outline-primary">
                <span>{__uiText(item.label)}</span><Icon name="chevron_right" className="shrink-0 text-outline" />
              </Link>)}
            </div>
          </section>)}
        </div> : <Empty icon="search_off">{__uiText("ไม่พบเมนูที่ค้นหา ลองใช้คำอื่น")}</Empty>}
      </Panel>
    </Page>
  );
}
