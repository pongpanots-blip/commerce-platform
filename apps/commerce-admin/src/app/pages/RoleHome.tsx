import { Link } from 'react-router-dom';
import { Icon, Page, PageHeader } from '@cp/ui';
import { shortcutsFor } from '../navigation';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, useUiLocale as __useUiLocale } from "@cp/ui";

/**
 * Every role's landing (/home): "What do you want to do today?" with big shortcuts to the role's main tasks.
 * Same cards as the Dashboard's section picker (Stitch admin-overview); no API calls, so it never 403s.
 */
export function RoleHome({ role }: { role?: string }) {
  __useUiLocale();
  const shortcuts = shortcutsFor(role);
  return (
    <Page>
      <PageHeader title={__uiText("วันนี้ต้องการทำอะไร")} subtitle={__uiText("เลือกงานด้านล่าง หรือใช้เมนูด้านซ้ายเพื่อไปหน้าอื่น")} />
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
