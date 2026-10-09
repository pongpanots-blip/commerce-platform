import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AppShell, NavProvider, useUiLocale, type NavGroup } from '@cp/ui';
import { navFor } from './navigation';
import { isProtectedWelcome, taskFeatureNavFor, taskSidebarFor } from './task-navigation';
import './commerce-workspace.css';

export function CommerceWorkspace({ role, sidebar, topbar, children }: {
  role?: string; sidebar: (nav: NavGroup[]) => ReactNode; topbar: ReactNode; children: ReactNode;
}) {
  const { pathname } = useLocation();
  useUiLocale();
  const protectedPage = isProtectedWelcome(pathname);
  const fullNav = protectedPage ? navFor(role) : taskFeatureNavFor(role);
  const shell = <AppShell sidebar={sidebar(protectedPage ? fullNav : taskSidebarFor(role))} topbar={topbar}>
    {protectedPage ? children : <div data-commerce-workspace="fluid">{children}</div>}
  </AppShell>;
  return <NavProvider nav={fullNav}>
    {protectedPage ? shell : <div data-commerce-shell="tasks">{shell}</div>}
  </NavProvider>;
}
