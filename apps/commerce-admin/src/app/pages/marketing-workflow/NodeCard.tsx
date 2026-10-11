// ui-copy-migration: only literal UI copy and notification templates
import { memo, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Icon, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';

export interface FlowNodeData extends Record<string, unknown> {
  title: string; subtitle: string; color: string; icon: string; isTrigger: boolean; issue?: string;
  ports: { port?: string; label: string; free: boolean }[];
  onPlus: (port: string | undefined, rect: DOMRect) => void; onRemove?: () => void;
}
export type FlowNode = Node<FlowNodeData, 'flowStep'>;

/** Asked before a step leaves the canvas (card button, Delete key or the side panel). */
export function confirmRemoveStep(): boolean {
  return window.confirm(__uiText('ลบขั้นตอนนี้? เส้นที่ต่อเข้าและออกจากขั้นตอนนี้จะหายไปด้วย'));
}

/** ~240×72 card: coloured icon square, title, one-line summary; in-handle left, one out-handle (+ button) per port on the right. */
function FlowStepNode({ data, selected }: NodeProps<FlowNode>) {
  __useUiLocale();
  const [hover, setHover] = useState(false);
  const many = data.ports.length > 1;
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className={`relative flex w-60 items-center gap-3 rounded-xl border bg-surface-container-lowest px-3 py-3 shadow-card ${selected ? 'border-primary ring-2 ring-primary/20' : data.issue ? 'border-danger' : 'border-outline-variant'}`}
      title={data.issue}>
      {!data.isTrigger && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-outline" />}
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: data.color }}><Icon name={data.icon} /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-on-surface">{data.title}</div>
        <div className="truncate text-xs text-on-surface-variant">{data.subtitle}</div>
      </div>
      {data.onRemove && hover && (
        <button type="button" className="nodrag absolute -right-2 -top-2 rounded-full bg-surface-container-lowest p-0.5 text-on-surface-variant shadow-raised hover:bg-danger-container hover:text-danger"
          title={__uiText('ลบขั้นตอนนี้')} aria-label={__uiText('ลบขั้นตอนนี้')} onClick={(e) => { e.stopPropagation(); if (confirmRemoveStep()) data.onRemove!(); }}>
          <Icon name="close" size={14} />
        </button>
      )}
      {data.ports.map((p, i) => {
        const top = many ? `${((i + 1) / (data.ports.length + 1)) * 100}%` : '50%';
        return (
          <div key={p.port ?? 'out'}>
            <Handle id={p.port} type="source" position={Position.Right} style={{ top }} className="!h-3 !w-3 !border-2 !border-white !bg-primary" />
            {many && <span className="pointer-events-none absolute left-full ml-8 -translate-y-1/2 whitespace-nowrap text-[10px] text-on-surface-variant" style={{ top }}>{p.label}</span>}
            {p.free && (
              <button type="button" aria-label={__uiText('เพิ่มขั้นตอนต่อจากตรงนี้')} title={__uiText('เพิ่มขั้นตอนต่อจากตรงนี้')} style={{ top }}
                className="nodrag absolute left-full ml-2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded border border-outline-variant bg-surface text-xs text-on-surface-variant hover:border-primary hover:text-primary"
                onClick={(e) => { e.stopPropagation(); data.onPlus(p.port, (e.currentTarget as HTMLElement).getBoundingClientRect()); }}>+</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const flowNodeTypes = { flowStep: memo(FlowStepNode) };
