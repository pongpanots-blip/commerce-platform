// ui-metadata-migration: static labels and UI notices only
import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { MdOutlineClose } from './icons';
import type { MarketingTriggerType } from './shared-api';
import { TriggerTypeChips } from './TriggerRuleBuilder';

/**
 * Agently-style node cards for the marketing workflow canvas. Presentational
 * only — `MarketingFlowCanvas` builds the `data` payload from workflow state.
 * Deliberately standalone: does NOT import from `apps/web-admin/src/app/components/bot/*`.
 */
// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export type MarketingNodeKind = 'trigger' | 'audience' | 'wait' | 'gate' | 'action' | 'condition';

export type MarketingNodeCardData = {
  kind: MarketingNodeKind;
  title: string;
  subtitle: string;
  removable?: boolean;
  onRemove?: () => void;
  /** Trigger card only */
  triggerType?: MarketingTriggerType;
  onUpdateTriggerType?: (type: MarketingTriggerType) => void;
};

export type MarketingFlowNode = Node<MarketingNodeCardData, 'marketingStep' | 'marketingCondition'>;

const KIND_ACCENT: Record<MarketingNodeKind, string> = {
  trigger: 'border-l-amber-400',
  audience: 'border-l-blue-400',
  wait: 'border-l-gray-400',
  gate: 'border-l-violet-400',
  action: 'border-l-emerald-400',
  condition: 'border-l-orange-400',
};

const KIND_LABEL: Record<MarketingNodeKind, string> = {
  get trigger(){return __uiText("TRIGGER");},
  get audience(){return __uiText("AUDIENCE");},
  get wait(){return __uiText("WAIT");},
  get gate(){return __uiText("GATE");},
  get action(){return __uiText("ACTION");},
  get condition(){return __uiText("IF / ELSE");},
};

/**
 * Visible source handle (bottom / left / right). Sized generously (22px) so it
 * is still grabbable when the canvas is zoomed out to ~0.5 (11px on screen) —
 * a 14px dot shrank to 7px and users could not start a connection drag.
 */
const SOURCE_HANDLE_CLASS =
  '!z-[40] !pointer-events-auto !h-[22px] !w-[22px] !min-h-[22px] !min-w-[22px] !rounded-full !border-4 !border-white !bg-primary hover:!bg-primary/80 !cursor-crosshair !shadow-sm';

/**
 * Wide target hit-area at the top of the card so dropping the line on the node
 * body still lands on a real `target` handle (avoids source→source misses).
 */
const TARGET_HANDLE_CLASS =
  '!z-[40] !pointer-events-auto !left-1/2 !top-0 !h-5 !w-[85%] !-translate-x-1/2 !translate-y-[-50%] !rounded-md !border !border-dashed !border-primary/40 !bg-primary/10 hover:!bg-primary/20 !cursor-crosshair';

function MarketingStepNode({ data, selected }: NodeProps<MarketingFlowNode>) {
  __useUiLocale();
  const isTrigger = data.kind === 'trigger';
  return (
    <div
      className={`relative ${isTrigger ? 'w-[320px]' : 'w-[300px]'} rounded-2xl border border-l-4 bg-white p-4 shadow-sm transition-shadow ${KIND_ACCENT[data.kind]} ${
        selected
          ? 'border-primary ring-2 ring-primary/20 shadow-md'
          : 'border-gray-200 hover:shadow-md'
      }`}
    >
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Top}
          isConnectable
          className={TARGET_HANDLE_CLASS}
        />
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold tracking-wide text-gray-400">
            {KIND_LABEL[data.kind]}
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold text-gray-800">
            {data.title}
          </div>
        </div>
        {data.removable && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              data.onRemove?.();
            }}
            className="relative z-10 shrink-0 rounded p-1 text-gray-300 hover:bg-gray-50 hover:text-red-500"
            title={__uiText("ลบขั้นตอนนี้")}
          >
            <MdOutlineClose size={14} />
          </button>
        )}
      </div>
      {isTrigger && data.triggerType && data.onUpdateTriggerType && (
        <div className="mt-2" onMouseDown={(e) => e.stopPropagation()}>
          <TriggerTypeChips
            size="sm"
            value={data.triggerType}
            onChange={data.onUpdateTriggerType}
          />
        </div>
      )}
      <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-gray-500">
        {data.subtitle}
      </p>
      {isTrigger && (
        <p
          className={`mt-2 border-t border-dashed border-gray-100 pt-2 text-[10px] ${
            selected ? 'font-medium text-primary' : 'text-gray-400'
          }`}
        >
          {__uiText("ลากจุดสีด้านล่าง → ปล่อยบนแถบด้านบนของการ์ดปลายทาง")}</p>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable
        className={SOURCE_HANDLE_CLASS}
      />
    </div>
  );
}

/** Diamond (rotated-square) node for `condition` steps — Lumis-style if/else. */
function MarketingConditionNode({ data, selected }: NodeProps<MarketingFlowNode>) {
  __useUiLocale();
  return (
    <div className="relative flex h-[170px] w-[170px] items-center justify-center">
      <Handle type="target" position={Position.Top} isConnectable className={TARGET_HANDLE_CLASS} />
      {/* Decorative only — must not steal pointer events from handles */}
      <div
        className={`pointer-events-none absolute inset-0 rotate-45 rounded-xl border-2 bg-white shadow-sm transition-shadow ${
          selected ? 'border-primary ring-2 ring-primary/20 shadow-md' : 'border-orange-300'
        }`}
      />
      <div className="pointer-events-none relative z-10 flex flex-col items-center gap-1 px-8 text-center">
        <div className="text-[10px] font-semibold tracking-wide text-orange-500">
          {KIND_LABEL.condition}
        </div>
        <div className="line-clamp-3 break-words text-[11px] font-medium leading-snug text-gray-700">
          {data.title}
        </div>
      </div>
      {data.removable && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            data.onRemove?.();
          }}
          className="absolute right-1 top-1 z-50 shrink-0 rounded p-1 text-gray-300 hover:bg-gray-50 hover:text-red-500"
          title={__uiText("ลบขั้นตอนนี้")}
        >
          <MdOutlineClose size={14} />
        </button>
      )}
      <Handle id="yes" type="source" position={Position.Left} isConnectable className={SOURCE_HANDLE_CLASS} />
      <Handle id="no" type="source" position={Position.Right} isConnectable className={SOURCE_HANDLE_CLASS} />
    </div>
  );
}

export const marketingNodeTypes = {
  marketingStep: memo(MarketingStepNode),
  marketingCondition: memo(MarketingConditionNode),
};
