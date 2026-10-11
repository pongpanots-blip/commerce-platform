/* Hallmark · component: tab strip · genre: modern-minimal · theme: project tokens (libs/ui)
 * states: default · hover · focus · active (current page) — links, so no disabled/loading/error/success
 */
import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { currentNavItem, uiText, useNavigation, useUiLocale, type NavItem } from '@cp/ui';
import { featureGroupOf } from './navigation';

/** The member pages of a feature group the role may open, in the group's order (empty when not grouped). */
export function featureMembers(links: readonly NavItem[], to: string): NavItem[] {
  const group = featureGroupOf(to);
  if (!group) return [];
  return group.routes.flatMap((route) => links.filter((link) => link.to === route).slice(0, 1));
}

/** One tab strip on top of every page of a feature group (FEATURE_GROUPS), so related pages read as one feature. */
export function FeatureTabs() {
  useUiLocale();
  const nav = useNavigation();
  const { pathname } = useLocation();
  const current = currentNavItem(nav, pathname);
  const strip = useRef<HTMLElement>(null);
  // On a narrow screen the current tab may sit past the edge: bring it into view (strip only, not the page).
  useEffect(() => {
    const el = strip.current, tab = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && tab) el.scrollLeft = Math.max(0, tab.offsetLeft - (el.clientWidth - tab.offsetWidth) / 2);
  }, [current?.link.to]);
  if (!current) return null;
  const members = featureMembers(nav.flatMap((g) => g.links), current.link.to);
  if (members.length < 2) return null;
  const group = featureGroupOf(current.link.to)!;
  return (
    <nav ref={strip} aria-label={uiText(group.label)} className="mb-4 flex gap-1 overflow-x-auto border-b border-secondary-container">
      {members.map((link) => {
        const active = link.to === current.link.to;
        return (
          <Link
            key={link.to}
            to={link.to}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary ${
              active ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:border-outline hover:text-on-surface'
            }`}
          >
            {uiText(link.label)}
          </Link>
        );
      })}
    </nav>
  );
}
