// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasUiText, NavProvider } from '@cp/ui';
import { FEATURE_GROUPS } from './navigation';
import { taskFeatureNavFor, taskSectionsFor } from './task-navigation';
import { FeatureTabs } from './FeatureTabs';
import { featureCards } from './pages/TaskSection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('feature groups', () => {
  const sections = taskSectionsFor('admin');
  const roles = ['admin', 'marketing', 'merchandising', 'cs', 'sale', 'sales_manager', 'business_analyst', 'graphic'];
  const sectionOf = (to: string) => [...new Set(roles.flatMap(r => taskSectionsFor(r)).filter(s => s.links.some(l => l.to === to)).map(s => s.id))];

  it('group real pages, each page in one group, all of a group in one section, in both languages', () => {
    const seen = new Set<string>();
    for (const g of FEATURE_GROUPS) {
      expect(g.routes.length, g.id).toBeGreaterThan(1);
      for (const to of g.routes) {
        expect(seen.has(to), to).toBe(false);
        seen.add(to);
        expect(sectionOf(to), `${g.id} › ${to}`).toHaveLength(1);
      }
      expect(new Set(g.routes.map(to => sectionOf(to)[0])).size, g.id).toBe(1);
      for (const copy of [g.label, g.description]) expect(hasUiText(copy), copy).toBe(true);
    }
  });

  it('the section index shows one card per feature and still links every page', () => {
    for (const section of sections) {
      const cards = featureCards(section.links);
      const linked = cards.flatMap(c => c.members.length ? c.members.map(m => m.to) : [c.to]);
      expect(linked.sort(), section.id).toEqual(section.links.map(l => l.to).sort());
    }
    const total = sections.reduce((n, s) => n + s.links.length, 0);
    const cards = sections.reduce((n, s) => n + featureCards(s.links).length, 0);
    expect(cards).toBeLessThan(total / 2);
  });

  it('a role sees only the members it may open (cs: orders alone is not a group)', () => {
    const cs = taskSectionsFor('cs').find(s => s.id === 'orders')!;
    const orders = featureCards(cs.links).find(c => c.to === '/j/order')!;
    expect(orders.members).toEqual([]);
  });
});

describe('FeatureTabs', () => {
  let container: HTMLDivElement, root: Root;
  beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const render = (path: string, role: string) => act(async () => root.render(
    <MemoryRouter initialEntries={[path]}><NavProvider nav={taskFeatureNavFor(role)}><FeatureTabs /></NavProvider></MemoryRouter>,
  ));
  const tabs = () => [...container.querySelectorAll('nav a')].map(a => a.getAttribute('href'));

  it('links the pages of the current feature and marks the current one, sub-pages included', async () => {
    await render('/j/coupon/123', 'admin');
    expect(tabs()).toEqual(['/j/promotions/campaigns', '/j/coupons', '/j/promotions-mechanic', '/j/promotion-product-sets', '/j/promotion-pages', '/planning/promotions']);
    expect(container.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/j/coupons');
  });

  it('shows nothing for a page outside any group or with one permitted member', async () => {
    await render('/livechat', 'admin');
    expect(tabs()).toEqual([]);
    await render('/j/order', 'cs');
    expect(tabs()).toEqual([]);
  });
});
