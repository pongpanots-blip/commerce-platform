import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { uiText, useUiLocale } from './i18n';

/** Navigation follows the page's real sections, including conditionally shown form fields. */
export function TaskPageFrame({ children }: { children: ReactNode }) {
  useUiLocale();
  const { pathname } = useLocation();
  const prefix = useId();
  const content = useRef<HTMLDivElement>(null);
  const [sections, setSections] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    const root = content.current;
    if (!root) return;
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const seen = new Set<string>();
        const headings = Array.from(root.querySelectorAll<HTMLHeadingElement>('h2, h3'))
          .filter(node => node.offsetParent !== null && node.getClientRects().length > 0 && !node.closest('dialog, nav, [role="tablist"], details:not([open])'));
        const next = headings.flatMap((node, index) => {
          const label = node.textContent?.trim();
          if (!label || label.length > 90 || seen.has(label)) return [];
          seen.add(label);
          if (!node.id) node.id = `${prefix}-section-${index}`;
          return [{ id: node.id, label }];
        }).slice(0, 12);
        setSections(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      });
    };
    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class', 'open'] });
    refresh();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [pathname, prefix]);
  return <div className="cp-task-page mx-auto max-w-[1240px] space-y-4">
    {sections.length >= 3 && <nav aria-label={uiText('ส่วนต่าง ๆ ในหน้านี้')} className="cp-section-nav flex gap-2 overflow-x-auto rounded-xl border border-secondary-container bg-white p-2">
      {sections.map(section => <button key={section.id} type="button" className="min-h-10 shrink-0 rounded-lg px-3 text-xs font-medium text-on-surface-variant hover:bg-primary-container hover:text-primary focus-visible:outline-2 focus-visible:outline-primary" onClick={() => {
        const heading = document.getElementById(section.id);
        heading?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      }}>{section.label}</button>)}
    </nav>}
    <div ref={content} className="cp-task-content min-w-0">{children}</div>
  </div>;
}
