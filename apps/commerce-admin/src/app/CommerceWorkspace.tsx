import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AppShell, NavProvider, useUiLocale, type NavGroup } from '@cp/ui';
import { isProtectedWelcome, taskFeatureNavFor, taskSidebarFor } from './task-navigation';
import { FeatureTabs } from './FeatureTabs';
import './commerce-workspace.css';

/**
 * Every page gets the same sidebar, top bar and theme. The Welcome Lead Email page keeps its own content
 * untouched: no fluid width, no feature tabs, and the theme reaches only the sidebar and top bar.
 */
export function CommerceWorkspace({ role, sidebar, topbar, children }: {
  role?: string; sidebar: (nav: NavGroup[]) => ReactNode; topbar: ReactNode; children: ReactNode;
}) {
  const { pathname } = useLocation();
  useUiLocale();
  const protectedPage = isProtectedWelcome(pathname);
  const chrome = (node: ReactNode) => protectedPage ? <div data-commerce-shell="tasks" className="contents">{node}</div> : node;
  const shell = <AppShell sidebar={chrome(sidebar(taskSidebarFor(role)))} topbar={chrome(topbar)}>
    {protectedPage ? children : <div data-commerce-workspace="fluid"><FeatureTabs />{children}</div>}
  </AppShell>;
  return <NavProvider nav={taskFeatureNavFor(role)}>
    {protectedPage ? shell : <div data-commerce-shell="tasks">{shell}</div>}
  </NavProvider>;
}
