import { Link } from 'react-router-dom';
import { Icon, PageHeader } from '@cp/ui';
import { CommercePage as Page } from '../CommercePage';
import { shortcutsFor } from '../navigation';
import { RoleOverview } from './RoleOverview';
import { normalizeRole } from '../../lib/role-home';
import { Dashboard } from './Dashboard';
import { commerceText as text } from '../commerce-copy';
const ROLE_TITLES: Record<string, [string, string]> = {
  merchandising: ['สินค้า ราคา และสต็อก', 'Catalog, prices and stock'],
  marketing: ['งานการตลาด', 'Marketing work'], business_analyst: ['ข้อมูลสำหรับตัดสินใจ', 'Decision support'],
  sale: ['งานขายของฉัน', 'My sales work'], sales_manager: ['งานขายของทีม', 'Team sales work'],
  cs: ['งานบริการลูกค้า', 'Customer service work'], graphic: ['รูปภาพและสื่อสินค้า', 'Product images and assets'],
};

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, useUiLocale as __useUiLocale } from "@cp/ui";

/**
 * Every role's landing (/home): "What do you want to do today?" with big shortcuts to the role's main tasks.
 * Reviewed Stitch specification adapted to authorized report contracts.
 */
export function RoleHome({ role }: { role?: string }) {
  __useUiLocale();
  if (normalizeRole(role) === 'admin') return <Dashboard />;
  const shortcuts = shortcutsFor(role);
  return (
    <Page>
      <PageHeader title={text(...(ROLE_TITLES[normalizeRole(role)] ?? ['งานของคุณวันนี้', 'Your work today']))} subtitle={text('ตรวจข้อมูลที่มี แล้วเปิดงานที่ต้องดูแล', 'Review available data, then open work that needs attention.')} />
      <RoleOverview role={normalizeRole(role)} />
      <section aria-label={__uiText("วันนี้ต้องการทำอะไร")}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shortcuts.map(shortcut => <Link key={shortcut.to} to={shortcut.to} className="group rounded-xl border border-secondary-container bg-white p-4 transition-colors hover:border-primary/50 hover:bg-primary-container/20 focus-visible:outline-2 focus-visible:outline-primary">
            <div className="flex items-center justify-between"><span className="flex size-9 items-center justify-center rounded-lg bg-surface-container-low text-primary"><Icon name={shortcut.icon} size={21} /></span><Icon name="arrow_forward" size={17} className="text-outline group-hover:text-primary" /></div>
            <h3 className="mt-3 text-sm font-semibold">{__uiText(shortcut.label)}</h3>{shortcut.description && <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{__uiText(shortcut.description)}</p>}
          </Link>)}
        </div>
      </section>
    </Page>
  );
}
