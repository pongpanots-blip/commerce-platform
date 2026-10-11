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

const KIND_LABEL: Record<MarketingNodeKind, string> = {
  get trigger(){return __uiText("จุดเริ่ม");},
  get audience(){return __uiText("คัดกลุ่ม");},
  get wait(){return __uiText("รอ");},
  get gate(){return __uiText("ตรวจซ้ำ");},
  get action(){return __uiText("สิ่งที่ทำ");},
  get condition(){return __uiText("แยกเส้นทาง");},
};

/** Quiet remove control on a card; the canvas asks to confirm before removing. */
function RemoveStepButton({ onRemove, className }: { onRemove?: () => void; className: string }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onRemove?.();
      }}
      className={`${className} shrink-0 rounded p-1 text-on-surface-variant hover:bg-danger-container hover:text-danger`}
      title={__uiText("ลบขั้นตอนนี้")}
      aria-label={__uiText("ลบขั้นตอนนี้")}
    >
      <MdOutlineClose size={14} />
    </button>
  );
}

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
      className={`relative ${isTrigger ? 'w-[320px]' : 'w-[300px]'} rounded-2xl border bg-surface-container-lowest p-4 shadow-card transition-shadow ${
        selected
          ? 'border-primary ring-2 ring-primary/20'
          : 'border-secondary-container hover:shadow-raised'
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
          <div className={`text-[11px] font-semibold ${isTrigger ? 'text-primary' : 'text-on-surface-variant'}`}>
            {KIND_LABEL[data.kind]}
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold text-on-surface">
            {data.title}
          </div>
        </div>
        {data.removable && <RemoveStepButton onRemove={data.onRemove} className="relative z-10" />}
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
      <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-on-surface-variant">
        {data.subtitle}
      </p>
      {isTrigger && (
        <p
          className={`mt-2 border-t border-dashed border-secondary-container pt-2 text-[11px] ${
            selected ? 'font-medium text-primary' : 'text-on-surface-variant'
          }`}
        >
          {__uiText("ต่อขั้นตอน: ลากจุดด้านล่างไปปล่อยบนแถบด้านบนของการ์ดที่ต้องการ")}</p>
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
        className={`pointer-events-none absolute inset-0 rotate-45 rounded-xl border-2 bg-surface-container-lowest shadow-card transition-shadow ${
          selected ? 'border-primary ring-2 ring-primary/20' : 'border-outline-variant'
        }`}
      />
      <div className="pointer-events-none relative z-10 flex flex-col items-center gap-1 px-8 text-center">
        <div className="text-[11px] font-semibold text-on-surface-variant">
          {KIND_LABEL.condition}
        </div>
        <div className="line-clamp-3 break-words text-[11px] font-medium leading-snug text-on-surface">
          {data.title}
        </div>
      </div>
      {data.removable && <RemoveStepButton onRemove={data.onRemove} className="absolute right-1 top-1 z-50" />}
      <Handle id="yes" type="source" position={Position.Left} isConnectable className={SOURCE_HANDLE_CLASS} />
      <Handle id="no" type="source" position={Position.Right} isConnectable className={SOURCE_HANDLE_CLASS} />
    </div>
  );
}

export const marketingNodeTypes = {
  marketingStep: memo(MarketingStepNode),
  marketingCondition: memo(MarketingConditionNode),
};
