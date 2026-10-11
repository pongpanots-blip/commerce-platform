// ui-copy-migration: only literal UI copy and notification templates
import { useState } from 'react';
import { Icon, SearchInput, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { TriggerType, WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';
import { disabledReason, PALETTE, type PaletteItem } from './palette-items';

export const DRAG_TYPE = 'application/x-flow-item';

/** Left toolbar: searchable, collapsible categories; drag an item onto the canvas, or click / Enter to append. */
export function Palette({ steps, triggerType, limits, onPick, compact = false }: {
  steps: WorkflowStep[]; triggerType: TriggerType; limits: WorkflowMeta['limits']; onPick: (item: PaletteItem) => void; compact?: boolean;
}) {
  __useUiLocale();
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();
  return (
    <div className={compact ? 'w-64' : 'flex h-full w-60 shrink-0 flex-col overflow-y-auto rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-card'}>
      <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder={__uiText('ค้นหาขั้นตอน')} aria-label={__uiText('ค้นหาขั้นตอน')}
        className="mb-3 w-full" />
      {PALETTE.filter((c) => !compact || c.category !== 'entry').map((cat) => {
        const items = cat.items.filter((i) => !q || i.label.toLowerCase().includes(q));
        if (!items.length) return null;
        const open = !closed[cat.category] || !!q;
        return (
          <section key={cat.category} className="mb-3">
            <button type="button" className="flex w-full items-center justify-between py-1 text-xs font-semibold text-on-surface-variant"
              aria-expanded={open} onClick={() => setClosed((c) => ({ ...c, [cat.category]: open }))}>
              {cat.title}<Icon name="expand_more" className={open ? 'rotate-180' : undefined} />
            </button>
            {open && items.map((item) => {
              const reason = disabledReason(item, steps, triggerType, limits);
              return (
                <button key={item.id} type="button" disabled={!!reason} title={reason ?? undefined}
                  draggable={!reason && !item.trigger} onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, item.id); e.dataTransfer.effectAllowed = 'copy'; }}
                  onClick={() => onPick(item)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-on-surface hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-40">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white" style={{ background: cat.color }}><Icon name={item.icon} /></span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
