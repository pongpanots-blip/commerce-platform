import { Link, useLocation } from 'react-router-dom';
import { currentNavItem, uiText, useUiLocale } from '@cp/ui';
import { isRouteAllowed } from '../lib/landing';
import { FEATURE_ACTIONS, FEATURE_HOMES } from './features';
import { navFor } from './navigation';

/** Contextual navigation in the existing top-bar action region; no new page strip. */
export function FeatureActions({ role }: { role?: string }) {
  useUiLocale();
  const { pathname } = useLocation();
  const home = currentNavItem(navFor(role), pathname)?.link.to;
  const actions = FEATURE_HOMES[pathname]
    ? [{ to: FEATURE_HOMES[pathname], label: 'กลับหน้ารายการ' }]
    : home === pathname && !['/j/allproducts', '/j/order'].includes(home) ? FEATURE_ACTIONS[home] ?? [] : [];
  const permitted = actions.filter(action => isRouteAllowed(role, action.to));
  if (!permitted.length) return null;
  return <details key={pathname} className="relative">
    <summary className="inline-flex min-h-10 cursor-pointer list-none items-center rounded-lg border border-secondary-container px-3 text-[13px] font-medium text-on-surface focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">{uiText('การทำงานอื่น')}</summary>
    <nav aria-label={uiText('การทำงานอื่น')} className="absolute left-0 sm:left-auto sm:right-0 z-30 mt-1 w-max max-w-[calc(100vw-2rem)] rounded-lg border border-secondary-container bg-white py-1 shadow-lg">
      {permitted.map(action => <Link key={action.to} to={action.to} className="block min-h-10 px-3 py-2 text-sm text-primary hover:bg-surface-container-low focus-visible:outline-2 focus-visible:outline-primary">{uiText(action.label)}</Link>)}
    </nav>
  </details>;
}
